import { execFile } from 'node:child_process';
import { appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
	MODEL_ASSETS,
	modelFile,
} from '../../src/lib/model-assets/manifest.ts';
import { UPSCALE_RUNTIME } from '../../src/lib/model-assets/runtime-manifest.ts';
import { RUNTIME_ARTIFACT } from '../../src/lib/transcribe/model-manifest.ts';
import { expect, test } from './fixtures/base';
import { modelAssetServer } from './helpers/model-asset-server';
import { startMemoryProfile } from './helpers/model-memory-profile';

test.use({
	serviceWorkers: 'allow',
	launchOptions: {
		args: [
			'--js-flags=--max-old-space-size=256 --max-semi-space-size=8',
			'--enable-precise-memory-info',
		],
	},
});

test.describe('固定モデルと自前ランタイムの実Worker検証', () => {
	test.describe.configure({ mode: 'serial', timeout: 480_000 });
	let server: Awaited<ReturnType<typeof modelAssetServer>>;
	test.beforeAll(async () => {
		await promisify(execFile)(
			process.execPath,
			['scripts/fetch-model-assets.mjs'],
			{ timeout: 300_000, maxBuffer: 1024 * 1024 },
		);
		server = await modelAssetServer();
	});
	test.afterAll(async () => {
		await server?.close();
	});

	async function infer(
		page: import('@playwright/test').Page,
		name: 'upscale' | 'bg-remove',
		mode: string,
		keepAlive = false,
	) {
		const assets = await readdir('dist/_astro');
		const worker = assets.find(
			(file) => file.startsWith(`${name}.worker-`) && file.endsWith('.js'),
		);
		if (!worker) throw Error('Production Worker missing');
		return page.evaluate(
			async ({ path, name, mode, keepAlive }) => {
				const canvas = document.createElement('canvas');
				canvas.width = 32;
				canvas.height = 32;
				const ctx = canvas.getContext('2d');
				if (!ctx) throw Error('No canvas');
				if (name === 'bg-remove' && mode === 'high') {
					ctx.fillStyle = '#fff';
					ctx.fillRect(0, 0, 32, 32);
				}
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
					digest?: string;
					foregroundAlpha?: number;
					backgroundAlpha?: number;
					runtimeExecuted?: boolean;
					ms: number;
				}>((resolve) => {
					let runtimeExecuted = false;
					const worker = new Worker(
						keepAlive ? `${path}?observe-cache-writes=1` : path,
						{ type: 'module' },
					);
					const timeout = setTimeout(() => {
						worker.terminate();
						resolve({ type: 'timeout', ms: performance.now() - start });
					}, 450_000);
					worker.onerror = (event) => {
						clearTimeout(timeout);
						worker.terminate();
						resolve({
							type: 'error',
							message: event.message,
							ms: performance.now() - start,
						});
					};
					worker.onmessage = async ({ data }) => {
						if (data.type === 'runtime-executed') {
							runtimeExecuted = true;
							return;
						}
						if (data.type === 'model-cache-write') {
							const scope = globalThis as typeof globalThis & {
								modelTestCacheWrites?: {
									key: string;
									success: boolean;
									message?: string;
								}[];
							};
							scope.modelTestCacheWrites ??= [];
							scope.modelTestCacheWrites.push(data);
							return;
						}
						if (data.type !== 'result' && data.type !== 'error') return;
						clearTimeout(timeout);
						if (keepAlive && data.type === 'result') {
							const scope = globalThis as typeof globalThis & {
								modelTestWorkers?: Worker[];
							};
							scope.modelTestWorkers ??= [];
							scope.modelTestWorkers.push(worker);
						} else worker.terminate();
						const pixels = data.data ? new Uint8Array(data.data) : null;
						const alpha = (inside: boolean) => {
							if (!pixels) return undefined;
							let sum = 0;
							let count = 0;
							for (let y = 0; y < data.height; y++)
								for (let x = 0; x < data.width; x++) {
									const selected = inside
										? x >= 12 && x < 20 && y >= 12 && y < 20
										: x < 4 || x >= 28 || y < 4 || y >= 28;
									if (selected) {
										sum += pixels[(y * data.width + x) * 4 + 3];
										count++;
									}
								}
							return sum / count / 255;
						};
						resolve({
							runtimeExecuted,
							foregroundAlpha: alpha(true),
							backgroundAlpha: alpha(false),
							type: data.type,
							message: data.message,
							width: data.width,
							height: data.height,
							bytes: data.data?.byteLength,
							digest: data.data
								? Array.from(
										new Uint8Array(
											await crypto.subtle.digest('SHA-256', data.data),
										),
									)
										.map((x) => x.toString(16).padStart(2, '0'))
										.join('')
								: undefined,
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
			{ path: `/_astro/${worker}`, name, mode, keepAlive },
		);
	}
	function expectForegroundSeparation(result: {
		foregroundAlpha?: number;
		backgroundAlpha?: number;
	}) {
		// 不透明な赤い前景を保持し、白背景を除去する。echo/all-zeroを拒否。
		expect(result.foregroundAlpha).toBeGreaterThan(0.9);
		expect(result.backgroundAlpha).toBeLessThan(0.05);
	}
	async function finishCacheWrites(
		page: import('@playwright/test').Page,
		keys: string[],
	) {
		await page.waitForFunction(
			(keys) => {
				const events =
					(
						globalThis as typeof globalThis & {
							modelTestCacheWrites?: {
								key: string;
								success: boolean;
								message?: string;
							}[];
						}
					).modelTestCacheWrites ?? [];
				const failed = events.find((event) => !event.success);
				if (failed) throw Error(`Cache write failed: ${failed.message}`);
				return keys.every((key) =>
					events.some((event) => event.key === key && event.success),
				);
			},
			keys,
			{ timeout: 30000 },
		);
		await page.evaluate(() => {
			const scope = globalThis as typeof globalThis & {
				modelTestWorkers?: Worker[];
			};
			for (const worker of scope.modelTestWorkers ?? []) worker.terminate();
			scope.modelTestWorkers = [];
		});
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
			const result = await infer(page, 'upscale', 'fast', attempt === 0);
			expect(result, JSON.stringify(result)).toMatchObject({
				type: 'result',
				width: 64,
				height: 64,
				bytes: 64 * 64 * 4,
			});
			if (attempt === 0) {
				const model = modelFile(
					'realesr-general-x4v3',
					'realesr-general-x4v3.onnx',
				);
				const files = [
					model,
					...UPSCALE_RUNTIME.files
						.filter(
							(file) =>
								file.path === 'ort-wasm-simd-threaded.mjs' ||
								file.path === 'ort-wasm-simd-threaded.wasm',
						)
						.map((file) => ({
							...file,
							url: `/vendor/onnx-wasm/${UPSCALE_RUNTIME.onnxRuntimeVersion}/${file.path}`,
						})),
				];
				await finishCacheWrites(
					page,
					files.map((file) => {
						const key = new URL(file.url, server.base);
						key.searchParams.set('verified-sha256', file.sha256);
						return key.href;
					}),
				);
			}
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
	test('背景削除の同時要求を直列化し、初期化は1回だけ行う', async ({
		page,
	}) => {
		await open(page, 'bg-remove');
		const workerFile = (await readdir('dist/_astro')).find(
			(file) => file.startsWith('bg-remove.worker-') && file.endsWith('.js'),
		);
		if (!workerFile) throw Error('Production Worker missing');
		const results = await page.evaluate(async (path) => {
			const canvas = document.createElement('canvas');
			canvas.width = 32;
			canvas.height = 32;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw Error('No canvas');
			ctx.fillRect(8, 8, 16, 16);
			const blob = await new Promise<Blob>((resolve) =>
				canvas.toBlob((x) => {
					if (x) resolve(x);
				}, 'image/png'),
			);
			const imageData = await blob.arrayBuffer();
			return new Promise<{ id: string; type: string }[]>((resolve, reject) => {
				const worker = new Worker(path, { type: 'module' });
				const messages: { id: string; type: string }[] = [];
				const timeout = setTimeout(() => {
					worker.terminate();
					reject(Error('timeout'));
				}, 30000);
				worker.onerror = (event) => {
					clearTimeout(timeout);
					worker.terminate();
					reject(Error(event.message));
				};
				worker.onmessage = ({ data }) => {
					if (data.type !== 'result' && data.type !== 'error') return;
					messages.push({ id: data.id, type: data.type });
					if (messages.length === 2) {
						clearTimeout(timeout);
						worker.terminate();
						resolve(messages);
					}
				};
				for (const id of ['first', 'second'])
					worker.postMessage({
						id,
						mode: 'fast',
						imageData,
						mimeType: 'image/png',
					});
			});
		}, `/_astro/${workerFile}`);
		expect(results).toEqual([
			{ id: 'first', type: 'result' },
			{ id: 'second', type: 'result' },
		]);
		expect(
			server.requests.filter(
				(request) =>
					request.path === modelFile('modnet', 'onnx/model.onnx').url,
			),
		).toHaveLength(1);
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

	for (const file of [
		'config.json',
		'preprocessor_config.json',
		'onnx/model_fp16.onnx',
	]) {
		for (const fault of ['corrupt', 'missing'] as const) {
			test(`Lite高精度の${file} ${fault}を拒否する`, async ({ page }) => {
				await open(page, 'bg-remove');
				const url = modelFile('birefnet-lite-512', file).url;
				server.faults.set(url, fault);
				const result = await infer(page, 'bg-remove', 'high');
				expect(result.type, JSON.stringify(result)).toBe('error');
				if (fault === 'corrupt') expect(result.message).toContain('ハッシュ');
				expect(
					server.requests.filter((request) => request.path === url),
				).toHaveLength(1);
				expect(
					server.requests.some((request) => request.path.includes('/ben2/')),
				).toBe(false);
			});
		}
	}
	test('Lite高精度は実SWと検証済cacheでoffline再推論し同じRGBAを返す', async ({
		page,
		context,
	}) => {
		await open(page, 'bg-remove');
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
		const originalWorker = (await readdir('dist/_astro')).find(
			(file) => file.startsWith('bg-remove.worker-') && file.endsWith('.js'),
		);
		if (!originalWorker) throw Error('Missing Worker');
		await page.evaluate(async (path) => {
			const response = await fetch(path);
			if (!response.ok) throw Error('Worker fetch failed');
			await response.arrayBuffer();
		}, `/_astro/${originalWorker}`);
		const first = await infer(page, 'bg-remove', 'high', true);
		expect(first).toMatchObject({
			type: 'result',
			width: 32,
			height: 32,
			bytes: 4096,
		});
		expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
		expectForegroundSeparation(first);

		// 通常UIと同様にWorkerを維持し、非同期cache.putの完了後に終了する。
		// 結果直後のterminateは未完了のstream書込みを中断する。
		const cacheKeys = MODEL_ASSETS.find(
			(model) => model.name === 'birefnet-lite-512',
		)
			?.files.filter((file) => file.path !== 'LICENSE')
			.map((file) => {
				const key = new URL(file.url, server.base);
				key.searchParams.set('verified-sha256', file.sha256);
				return key.href;
			});
		if (!cacheKeys) throw Error('Missing Lite manifest');

		// Cache.matchのmetadataや本文が読めてもput完了前のことがある。
		// テスト配信だけでCache.putを観測し、promise解決を待ってからWorkerを終了。
		await finishCacheWrites(page, cacheKeys);
		await context.setOffline(true);
		try {
			const cached = await infer(page, 'bg-remove', 'high');
			expect(cached, JSON.stringify(cached)).toMatchObject({
				type: 'result',
				width: 32,
				height: 32,
				digest: first.digest,
			});
			expectForegroundSeparation(cached);
		} finally {
			await context.setOffline(false);
		}
		expect(
			server.requests.filter(
				(request) =>
					request.path ===
					modelFile('birefnet-lite-512', 'onnx/model_fp16.onnx').url,
			),
		).toHaveLength(1);
		expect(
			server.requests.some((request) => request.path.includes('/ben2/')),
		).toBe(false);
	});

	for (const [tool, mode, runtime, base] of [
		['bg-remove', 'high', RUNTIME_ARTIFACT, 'ort-wasm-simd-threaded.asyncify'],
		['upscale', 'fast', UPSCALE_RUNTIME, 'ort-wasm-simd-threaded'],
	] as const) {
		for (const extension of ['mjs', 'wasm']) {
			test(`${tool}は同長改変された実行資産${extension}を実行前に拒否する`, async ({
				page,
			}) => {
				await open(page, tool);
				const path = `/vendor/onnx-wasm/${runtime.onnxRuntimeVersion}/${base}.${extension}`;
				server.faults.set(path, 'corrupt');
				const result = await infer(page, tool, mode);
				expect(result).toMatchObject({ type: 'error', runtimeExecuted: false });
				expect(result.message).toContain('実行資産の検証に失敗');
				expect(result.message).toContain('ハッシュが一致しません');
				if (extension === 'wasm')
					expect(server.wasmMutations.at(-1)).toMatchObject({
						path,
						originalValid: true,
						mutatedValid: true,
						bytes: runtime.files.find((file) => file.path === `${base}.wasm`)
							?.bytes,
					});
				expect(
					server.requests.filter(
						(request) => request.path === path && request.method === 'GET',
					),
				).toHaveLength(1);
			});
		}
	}
	for (const [tool, mode, model] of [
		['bg-remove', 'fast', 'modnet'],
		['bg-remove', 'high', 'birefnet-lite-512'],
		['upscale', 'max', 'realesrgan-x4plus'],
	] as const) {
		test(`実モデル推論・通信: ${model}`, async ({ page, context }) => {
			await open(page, tool);
			const external: string[] = [];
			context.on('request', (request) => {
				if (/huggingface|jsdelivr|hf.co/.test(request.url()))
					external.push(request.url());
			});
			const stopProfile =
				model === 'birefnet-lite-512'
					? await startMemoryProfile(context)
					: null;
			const result = await infer(page, tool, mode);
			const memory = await stopProfile?.();
			const observedJsHeapLimitBytes = await page.evaluate(
				() =>
					(
						performance as Performance & {
							memory?: { jsHeapSizeLimit: number };
						}
					).memory?.jsHeapSizeLimit ?? null,
			);

			expect(result, JSON.stringify(result)).toMatchObject({ type: 'result' });
			expect(external).toEqual([]);
			if (tool === 'bg-remove')
				expect(
					server.requests.some((request) => request.path.includes('/ben2/')),
				).toBe(false);
			const asset = MODEL_ASSETS.find((item) => item.name === model);
			expect(
				server.requests.some(
					(request) =>
						request.path ===
						asset?.files.find((file) => file.path.endsWith('.onnx'))?.url,
				),
			).toBe(true);
			if (model === 'birefnet-lite-512') expectForegroundSeparation(result);
			if (memory) {
				expect(memory.samples).toBeGreaterThan(0);
				expect(observedJsHeapLimitBytes).toBeLessThan(320 * 1024 * 1024);
			}
			await appendFile(
				join('test-results', 'model-performance.jsonl'),
				`${JSON.stringify({
					project: test.info().project.name,
					model,
					memory,
					observedJsHeapLimitBytes,
					...result,
				})}\n`,
			);
		});
	}
});
