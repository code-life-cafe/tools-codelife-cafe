// ローカルR2実体で本物のPages配信ハンドラを実行。モデル/推論をモックしない。

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { onRequest as bg } from '../../../functions/models/bg-remove/[[path]].ts';
import { onRequest as up } from '../../../functions/models/upscale/[[path]].ts';
import { onRequest as runtime } from '../../../functions/vendor/onnx-wasm/[[path]].ts';
import { MODEL_ASSETS } from '../../../src/lib/model-assets/manifest.ts';
import { RUNTIMES } from '../../../src/lib/model-assets/runtime-manifest.ts';

export async function modelAssetServer() {
	const headers = await readFile('public/_headers', 'utf8');
	const csp = headers.match(/Content-Security-Policy: (.+)/)?.[1]?.trim();
	if (!csp) throw Error('Common CSP missing');
	const objects = new Map<string, string>();
	for (const model of MODEL_ASSETS.filter(
		(item) => item.name !== 'realesr-general-x4v3',
	))
		for (const file of model.files)
			objects.set(
				`${model.tool}/${model.name}/${model.revision}/${file.sha256}/${file.path}`,
				resolve('public', file.url.slice(1)),
			);
	for (const version of RUNTIMES)
		for (const file of version.files)
			objects.set(
				`onnx-wasm/${version.onnxRuntimeVersion}/${file.sha256}/${file.path}`,
				resolve(
					'public/vendor/onnx-wasm',
					version.onnxRuntimeVersion,
					file.path,
				),
			);
	const faults = new Map<string, 'corrupt' | 'missing'>();
	const requests: { path: string; method: string }[] = [];
	async function object(key: string, head: boolean) {
		let path = objects.get(key);
		if (!path) return null;
		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(path);
		} catch {
			if (!key.startsWith('bg-remove/modnet/') || !key.endsWith('.json'))
				return null;
			path = resolve(
				'tests/e2e/fixtures/model-assets',
				`modnet-${key
					.split('/')
					.at(-1)
					?.replace(/\.json$/, '.fixture')}`,
			);
			try {
				info = await stat(path);
			} catch {
				return null;
			}
		}
		return {
			size: info.size,
			httpEtag: '"local-test"',
			body: head
				? null
				: (Readable.toWeb(createReadStream(path)) as ReadableStream),
		};
	}
	const bucket = {
		get: (key: string) => object(key, false),
		head: (key: string) => object(key, true),
	};
	const server: Server = createServer(async (req, res) => {
		try {
			res.setHeader('Content-Security-Policy', csp);
			res.setHeader('X-Content-Type-Options', 'nosniff');
			res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
			const path = new URL(req.url ?? '/', 'http://localhost').pathname;
			requests.push({ path, method: req.method ?? 'GET' });
			if (faults.get(path) === 'missing') {
				res.writeHead(404);
				res.end();
				return;
			}
			const handler = path.startsWith('/models/bg-remove/')
				? bg
				: path.startsWith('/models/upscale/')
					? up
					: path.startsWith('/vendor/onnx-wasm/')
						? runtime
						: null;
			if (handler) {
				const response = await handler({
					request: new Request(`http://localhost${req.url ?? '/'}`, {
						method: req.method,
					}),
					env: { TRANSCRIBE_MODELS: bucket },
				});
				res.writeHead(response.status, Object.fromEntries(response.headers));
				if (!response.body) {
					res.end();
					return;
				}
				const input = Readable.fromWeb(
					response.body as import('node:stream/web').ReadableStream,
				);
				if (faults.get(path) === 'corrupt') {
					let first = true;
					input
						.pipe(
							new Transform({
								transform(chunk, _encoding, callback) {
									if (first) {
										chunk[0] ^= 1;
										first = false;
									}
									callback(null, chunk);
								},
							}),
						)
						.pipe(res);
				} else input.pipe(res);
				return;
			}
			const root = resolve('dist');
			const target = resolve(
				root,
				`.${path.endsWith('/') ? `${path}index.html` : path}`,
			);
			if (
				!target.startsWith(
					root + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'),
				)
			) {
				res.writeHead(404);
				res.end();
				return;
			}
			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(target);
			} catch {
				res.writeHead(404);
				res.end();
				return;
			}
			if (!info.isFile()) {
				res.writeHead(404);
				res.end();
				return;
			}
			const mime: Record<string, string> = {
				'.html': 'text/html',
				'.js': 'text/javascript',
				'.mjs': 'text/javascript',
				'.css': 'text/css',
				'.json': 'application/json',
				'.wasm': 'application/wasm',
				'.png': 'image/png',
				'.svg': 'image/svg+xml',
			};
			res.writeHead(200, {
				'content-type': mime[extname(target)] ?? 'application/octet-stream',
				'content-length': info.size,
			});
			const input = createReadStream(target);
			if (faults.get(path) === 'corrupt') {
				let first = true;
				input
					.pipe(
						new Transform({
							transform(chunk, _encoding, callback) {
								if (first) {
									chunk[0] ^= 1;
									first = false;
								}
								callback(null, chunk);
							},
						}),
					)
					.pipe(res);
			} else input.pipe(res);
		} catch {
			if (!res.headersSent) res.writeHead(500);
			res.end();
		}
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	if (!address || typeof address === 'string')
		throw Error('Missing server address');
	return {
		base: `http://127.0.0.1:${address.port}`,
		faults,
		requests,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
		},
	};
}
