import { appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
	MODEL_ASSETS,
	modelFile,
} from '../../src/lib/model-assets/manifest.ts';
import { expect, test } from './fixtures/base';
import { modelAssetServer } from './helpers/model-asset-server';

test.describe('固定モデルと自前ランタイムの実Worker検証', () => {
	test.use({ serviceWorkers: 'allow' });
	test.describe.configure({ mode: 'serial', timeout: 240_000 });
	let server: Awaited<ReturnType<typeof modelAssetServer>>;
	test.beforeAll(async () => {
		server = await modelAssetServer();
	});
	test.afterAll(async () => {
		await server.close();
	});

	async function infer(
		page: import('@playwright/test').Page,
		name: 'upscale' | 'bg-remove',
		mode: string,
	) {
		const assets = await readdir('dist/_astro');
		const worker = assets.find(
			(file) => file.startsWith(`${name}.worker-`) && file.endsWith('.js'),
		);
		if (!worker) throw Error('Production Worker missing');
		return page.evaluate(
			async ({ path, name, mode }) => {
				const canvas = document.createElement('canvas');
				canvas.width = 32;
				canvas.height = 32;
				const ctx = canvas.getContext('2d');
				if (!ctx) throw Error('No canvas');
				ctx.fillStyle = '#f00';
				ctx.fillRect(8, 8, 16, 16);
				const blob = await new Promise<Blob>((resolve, reject) =>
					canvas.toBlob(
						(value) => (value ? resolve(value) : reject(Error('No image'))),
						'image/png',
					),
				);
				const imageData = await blob.arrayBuffer();
				const start = performance.now();
				return new Promise<{
					type: string;
					message?: string;
					width?: number;
					height?: number;
					bytes?: number;
					ms: number;
				}>((resolve) => {
					const worker = new Worker(path, { type: 'module' });
					const timeout = setTimeout(() => {
						worker.terminate();
						resolve({ type: 'timeout', ms: performance.now() - start });
					}, 220_000);
					worker.onerror = (event) => {
						clearTimeout(timeout);
						worker.terminate();
						resolve({
							type: 'error',
							message: event.message,
							ms: performance.now() - start,
						});
					};
					worker.onmessage = ({ data }) => {
						if (data.type !== 'result' && data.type !== 'error') return;
						clearTimeout(timeout);
						worker.terminate();
						resolve({
							type: data.type,
							message: data.message,
							width: data.width,
							height: data.height,
							bytes: data.data?.byteLength,
							ms: performance.now() - start,
						});
					};
					worker.postMessage(
						name === 'upscale'
							? {
									id: 'real-test',
									imageData,
									mimeType: 'image/png',
									options: {
										scale: 2,
										denoise: true,
										output: 'png',
										quality: mode,
									},
								}
							: { id: 'real-test', imageData, mimeType: 'image/png', mode },
					);
				});
			},
			{ path: `/_astro/${worker}`, name, mode },
		);
	}
	async function open(page: import('@playwright/test').Page, tool: string) {
		server.faults.clear();
		server.requests.length = 0;
		await page.goto(`${server.base}/${tool}/`);
	}
	test('fast拡大は実モデルで成功し、初回と検証済cacheの双方が同一originのみ', async ({
		page,
		context,
	}) => {
		await open(page, 'upscale');
		const external: string[] = [];
		context.on('request', (request) => {
			const url = request.url();
			if (/huggingface|jsdelivr|hf.co|xethub/.test(url)) external.push(url);
		});
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await infer(page, 'upscale', 'fast');
			expect(result, JSON.stringify(result)).toMatchObject({
				type: 'result',
				width: 64,
				height: 64,
				bytes: 64 * 64 * 4,
			});
			await appendFile(
				join('test-results', 'model-performance.jsonl'),
				`${JSON.stringify({
					project: test.info().project.name,
					model: 'upscale-fast',
					attempt,
					...result,
				})}\n`,
			);
		}
		await page.evaluate(async () => {
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller)
				await new Promise<void>((resolve) =>
					navigator.serviceWorker.addEventListener(
						'controllerchange',
						() => resolve(),
						{ once: true },
					),
				);
		});
		expect(
			await page.evaluate(() => !!navigator.serviceWorker.controller),
		).toBe(true);
		expect(await infer(page, 'upscale', 'fast')).toMatchObject({
			type: 'result',
			width: 64,
			height: 64,
		});
		expect(external).toEqual([]);
		expect(
			server.requests.filter((request) =>
				request.path.endsWith('realesr-general-x4v3.onnx'),
			),
		).toHaveLength(1);
		expect(
			server.requests.some((request) =>
				request.path.startsWith('/vendor/onnx-wasm/1.27.0/'),
			),
		).toBe(true);
	});
	test('ONNXが1byte改変された場合は推論結果を返さず停止', async ({ page }) => {
		await open(page, 'upscale');
		server.faults.set(
			modelFile('realesr-general-x4v3', 'realesr-general-x4v3.onnx').url,
			'corrupt',
		);
		const result = await infer(page, 'upscale', 'fast');
		expect(result.type).toBe('error');
		expect(result.message).toContain('ハッシュ');
	});
	test('背景削除のconfig改変をパース/推論前に拒否し外部へfallbackしない', async ({
		page,
		context,
	}) => {
		await open(page, 'bg-remove');
		const external: string[] = [];
		context.on('request', (request) => {
			if (/huggingface|jsdelivr|hf.co/.test(request.url()))
				external.push(request.url());
		});
		server.faults.set(modelFile('modnet', 'config.json').url, 'corrupt');
		const result = await infer(page, 'bg-remove', 'fast');
		expect(result.type).toBe('error');
		expect(result.message).toContain('ハッシュ');
		expect(external).toEqual([]);
	});
	test('背景削除の配信欠落は外部へfallbackせず停止', async ({ page }) => {
		await open(page, 'bg-remove');
		server.faults.set(modelFile('modnet', 'config.json').url, 'missing');
		const result = await infer(page, 'bg-remove', 'fast');
		expect(result.type).toBe('error');
	});
	for (const [tool, mode, model] of [
		['bg-remove', 'fast', 'modnet'],
		['bg-remove', 'high', 'ben2'],
		['upscale', 'max', 'realesrgan-x4plus'],
	] as const) {
		test(`実モデル推論・通信: ${model}`, async ({ page, context }) => {
			test.skip(
				process.env.MODEL_ASSET_REAL_TESTS !== '1',
				'大容量実モデルはローカル取得後に明示実行する',
			);
			await open(page, tool);
			const external: string[] = [];
			context.on('request', (request) => {
				if (/huggingface|jsdelivr|hf.co/.test(request.url()))
					external.push(request.url());
			});
			const result = await infer(page, tool, mode);
			expect(result, JSON.stringify(result)).toMatchObject({ type: 'result' });
			expect(external).toEqual([]);
			const asset = MODEL_ASSETS.find((item) => item.name === model);
			expect(
				server.requests.some(
					(request) =>
						request.path ===
						asset?.files.find((file) => file.path.endsWith('.onnx'))?.url,
				),
			).toBe(true);
			await appendFile(
				join('test-results', 'model-performance.jsonl'),
				`${JSON.stringify({
					project: test.info().project.name,
					model,
					...result,
				})}\n`,
			);
		});
	}
});
