// 画像OCR（/image-ocr）のE2E。実際のTesseract Worker・言語データ（同一オリジン固定ファイル）で認識する。
// 精度・EXIF・透過・上限・キャンセル・失敗系・設定・UIを確認する。
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';
import {
	animatedWebpHeader,
	asApng,
	cer,
	fixtureImage,
	fixtureManifest,
	fixtureTruth,
	synthImage,
	withExifOrientation,
} from './helpers/ocr';

const URL_PATH = '/image-ocr/';
const MODEL_ROUTE = '**/models/ocr/**';

const input = (page: Page) => page.getByTestId('image-ocr-input');
const runButton = (page: Page) => page.getByTestId('image-ocr-run');
const output = (page: Page) => page.getByTestId('image-ocr-output');
const errorBox = (page: Page) => page.getByTestId('image-ocr-error');

/** 起動した Worker と、終了（close）済みの数を追跡する */
function trackWorkers(page: Page) {
	const state = { started: 0, closed: 0 };
	page.on('worker', (worker) => {
		state.started++;
		worker.on('close', () => {
			state.closed++;
		});
	});
	return state;
}

async function open(page: Page) {
	await page.goto(URL_PATH);
}

async function pick(
	page: Page,
	file: string | { name: string; mimeType: string; buffer: Buffer },
) {
	await input(page).setInputFiles(file);
}

async function recognize(page: Page, timeout = 60_000) {
	await runButton(page).click();
	await expect(output(page)).toBeVisible({ timeout });
}

test.describe('画像OCR: 入力と手動実行', () => {
	test('ページが表示され、ファイル選択だけでは言語データを取得せず、実行ボタンで初めて取得する', async ({
		page,
	}) => {
		const workers = trackWorkers(page);
		const modelRequests: string[] = [];
		page.on('request', (r) => {
			if (/\/(models|vendor)\/ocr\//.test(r.url())) modelRequests.push(r.url());
		});
		await open(page);
		await expect(
			page.getByRole('heading', { level: 1, name: /画像文字起こし/ }),
		).toBeVisible();
		await pick(page, fixtureImage('clear/01-meiryo-prose.png'));
		await expect(page.getByTestId('image-ocr-preview')).toBeVisible();
		await expect(page.getByTestId('image-ocr-info')).toContainText(
			'01-meiryo-prose.png',
		);
		await expect(runButton(page)).toBeEnabled();
		await page.waitForTimeout(500);
		expect(modelRequests).toEqual([]);
		await recognize(page);
		expect(modelRequests.some((u) => u.includes('jpn.traineddata'))).toBe(true);
		expect(modelRequests.some((u) => u.includes('eng.traineddata'))).toBe(true);
		expect(modelRequests.some((u) => u.includes('worker.min.js'))).toBe(true);
		// 認識が終わったら Worker は終了している
		expect(workers.started).toBe(1);
		await expect.poll(() => workers.closed).toBe(1);
	});

	test('手書き・縦書き等が非保証であることと誤認識の注意を入力前に表示する', async ({
		page,
	}) => {
		await open(page);
		await expect(
			page.getByText(/手書き・縦書き・段組み・表/).first(),
		).toBeVisible();
		await expect(
			page.getByText(/誤りが含まれることがあります/).first(),
		).toBeVisible();
	});

	test('複数ファイルは受け付けず、1枚だけ選ぶよう案内する', async ({
		page,
	}) => {
		await open(page);
		await pick(page, [
			fixtureImage('clear/01-meiryo-prose.png'),
			fixtureImage('clear/07-meiryo-english.png'),
		] as unknown as string);
		await expect(errorBox(page)).toContainText('1枚だけ');
		await expect(page.getByTestId('image-ocr-preview')).toHaveCount(0);
	});

	test('画像の貼り付けで読み込め、テキスト入力欄への貼り付けには干渉しない', async ({
		page,
	}) => {
		await open(page);
		const png = fs.readFileSync(fixtureImage('clear/07-meiryo-english.png'));
		// ハイドレーション直後はリスナー登録前の可能性があるため、読み込めるまで貼り付けを繰り返す
		await expect(async () => {
			await page.evaluate((b64) => {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				const dt = new DataTransfer();
				dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
				document.body.dispatchEvent(
					new ClipboardEvent('paste', {
						clipboardData: dt,
						bubbles: true,
						cancelable: true,
					}),
				);
			}, png.toString('base64'));
			await expect(page.getByTestId('image-ocr-info')).toContainText(
				'pasted.png',
				{
					timeout: 1000,
				},
			);
		}).toPass({ timeout: 10_000 });
		await recognize(page);
		// 出力欄（textarea）にフォーカスして画像を貼り付けても、読み込み済み画像は差し替わらない
		await output(page).focus();
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.items.add(
				new File([new Uint8Array([1])], 'other.png', { type: 'image/png' }),
			);
			document.activeElement?.dispatchEvent(
				new ClipboardEvent('paste', {
					clipboardData: dt,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await expect(page.getByTestId('image-ocr-info')).toContainText(
			'pasted.png',
		);
	});
});

test.describe('画像OCR: 実認識と精度', () => {
	test('固定fixture（清明な活字12枚）の認識結果のCER合計が5%以下', async ({
		page,
	}) => {
		test.setTimeout(180_000);
		await open(page);
		const clear = fixtureManifest().filter((m) => m.group === 'clear');
		expect(clear).toHaveLength(12);
		let dist = 0;
		let chars = 0;
		const perImage: string[] = [];
		for (const entry of clear) {
			await pick(page, fixtureImage(entry.file));
			await recognize(page);
			const text = await output(page).inputValue();
			const r = cer(fixtureTruth(entry.id), text);
			dist += r.dist;
			chars += r.chars;
			perImage.push(`${entry.id}: ${r.dist}/${r.chars}`);
		}
		console.log(`CER ${dist}/${chars} = ${(dist / chars).toFixed(4)}`);
		console.log(perImage.join('\n'));
		expect(chars).toBeGreaterThanOrEqual(1000);
		expect(dist / chars).toBeLessThanOrEqual(0.05);
	});

	test('日本語＋英語の結果が編集でき、英語のみモードでも英語を読み取れる', async ({
		page,
	}) => {
		await open(page);
		await pick(page, fixtureImage('clear/01-meiryo-prose.png'));
		await recognize(page);
		await expect(output(page)).toHaveValue(/本日の会議は午後三時から/);
		await page.getByRole('radio', { name: '英語のみ' }).click();
		await expect(output(page)).toHaveCount(0);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await recognize(page);
		await expect(output(page)).toHaveValue(
			/quick brown fox jumps over the lazy dog/,
		);
	});

	test('JPEG・PNG・WebPのいずれも読み取れる', async ({ page }) => {
		await open(page);
		const text = 'Release Notes version 2026';
		for (const mime of ['image/png', 'image/jpeg', 'image/webp'] as const) {
			const buffer = await synthImage(page, {
				width: 900,
				height: 120,
				text,
				mime,
			});
			await pick(page, {
				name: `synth.${mime.split('/')[1]}`,
				mimeType: mime,
				buffer,
			});
			await expect(page.getByTestId('image-ocr-preview')).toBeVisible();
			await recognize(page);
			await expect(output(page)).toHaveValue(/Release Notes version 2026/);
		}
	});

	test('透過PNGは白背景に合成して読み取る', async ({ page }) => {
		await open(page);
		const buffer = await synthImage(page, {
			width: 900,
			height: 120,
			text: 'Transparent Background 123',
			transparent: true,
		});
		await pick(page, { name: 'alpha.png', mimeType: 'image/png', buffer });
		await recognize(page);
		await expect(output(page)).toHaveValue(/Transparent Background 123/);
	});

	test('EXIFの向き（6）を反映して読み取る', async ({ page }) => {
		await open(page);
		const sideways = await synthImage(page, {
			width: 900,
			height: 120,
			text: 'Orientation Check 456',
			mime: 'image/jpeg',
			rotateCcw: true,
		});
		await pick(page, {
			name: 'exif6.jpg',
			mimeType: 'image/jpeg',
			buffer: withExifOrientation(sideways, 6),
		});
		await recognize(page);
		await expect(output(page)).toHaveValue(/Orientation Check 456/);
	});
});

test.describe('画像OCR: 入力の拒否と上限', () => {
	test('アニメーション（APNG・アニメーションWebP・GIF）、空・破損・非対応形式は日本語エラーで拒否する', async ({
		page,
	}) => {
		await open(page);
		const still = await synthImage(page, { width: 100, height: 60, text: 'A' });
		const cases: Array<{
			file: { name: string; mimeType: string; buffer: Buffer };
			message: RegExp;
		}> = [
			{
				file: {
					name: 'anim.png',
					mimeType: 'image/png',
					buffer: asApng(still),
				},
				message: /アニメーション/,
			},
			{
				file: {
					name: 'anim.webp',
					mimeType: 'image/webp',
					buffer: animatedWebpHeader(),
				},
				message: /アニメーション/,
			},
			{
				file: {
					name: 'anim.gif',
					mimeType: 'image/gif',
					buffer: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'),
				},
				message: /GIF/,
			},
			{
				file: {
					name: 'empty.png',
					mimeType: 'image/png',
					buffer: Buffer.alloc(0),
				},
				message: /空です/,
			},
			{
				file: {
					name: 'broken.png',
					mimeType: 'image/png',
					buffer: still.subarray(0, 24),
				},
				message: /破損/,
			},
			{
				file: {
					name: 'fake.png',
					mimeType: 'image/png',
					buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
				},
				message: /対応していない形式/,
			},
		];
		for (const c of cases) {
			await pick(page, c.file);
			await expect(errorBox(page)).toContainText(c.message);
			await expect(page.getByTestId('image-ocr-preview')).toHaveCount(0);
			await expect(runButton(page)).toHaveCount(0);
		}
		// 拒否のあとも、正しい画像を読み込める
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await expect(page.getByTestId('image-ocr-preview')).toBeVisible();
		await expect(errorBox(page)).toHaveCount(0);
	});

	test('1辺8192px超・画素数12,000,000超は拒否し、12,000,000ちょうどは受け付ける', async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await open(page);
		const wide = await synthImage(page, { width: 8193, height: 10, text: 'W' });
		await pick(page, { name: 'wide.png', mimeType: 'image/png', buffer: wide });
		await expect(errorBox(page)).toContainText('8192px');
		const over = await synthImage(page, { width: 4001, height: 3000 });
		await pick(page, { name: 'over.png', mimeType: 'image/png', buffer: over });
		await expect(errorBox(page)).toContainText('12,000,000');
		const exact = await synthImage(page, { width: 4000, height: 3000 });
		await pick(page, {
			name: 'exact.png',
			mimeType: 'image/png',
			buffer: exact,
		});
		await expect(errorBox(page)).toHaveCount(0);
		await expect(page.getByTestId('image-ocr-info')).toContainText(
			'4000×3000px',
		);
	});

	test('文字のない画像は「読み取れませんでした」と案内し、コピー・保存を無効にする', async ({
		page,
	}) => {
		await open(page);
		const blank = await synthImage(page, { width: 600, height: 200 });
		await pick(page, {
			name: 'blank.png',
			mimeType: 'image/png',
			buffer: blank,
		});
		await recognize(page);
		await expect(page.getByTestId('image-ocr-empty')).toContainText(
			'文字を読み取れませんでした',
		);
		await expect(page.getByTestId('image-ocr-copy')).toBeDisabled();
		await expect(page.getByTestId('image-ocr-save')).toBeDisabled();
	});
});

test.describe('画像OCR: 編集・コピー・保存', () => {
	test('編集した内容がコピー・TXT保存（UTF-8・BOMなし・LF、元名_ocr.txt）に反映される', async ({
		page,
		context,
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await open(page);
		await pick(page, {
			name: 'スクショ 1.png',
			mimeType: 'image/png',
			buffer: fs.readFileSync(fixtureImage('clear/07-meiryo-english.png')),
		});
		await recognize(page);
		const edited = '編集後の本文\nSecond line　全角';
		await output(page).fill(edited);
		await expect(page.getByTestId('image-ocr-count')).toContainText('文字');
		await page.getByTestId('image-ocr-copy').click();
		await expect(page.getByText('コピーしました')).toBeVisible();
		// OSのクリップボードは改行をCRLFで返すことがあるため、改行コードだけ揃えて比較する
		const clipboard = await page.evaluate(() => navigator.clipboard.readText());
		expect(
			clipboard.replaceAll(
				String.fromCharCode(13, 10),
				String.fromCharCode(10),
			),
		).toBe(edited);
		const download = page.waitForEvent('download');
		await page.getByTestId('image-ocr-save').click();
		const d = await download;
		expect(d.suggestedFilename()).toBe('スクショ 1_ocr.txt');
		const bytes = fs.readFileSync((await d.path()) as string);
		expect(Array.from(bytes.subarray(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
		expect(bytes.toString('utf8')).toBe(edited);
		expect(bytes.includes(0x0d)).toBe(false);
	});

	test('編集後のテキストは10万UTF-16コード単位ちょうどまで許可し、超過はコピー・保存を無効にする', async ({
		page,
	}) => {
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await recognize(page);
		await output(page).fill('a'.repeat(100_000));
		await expect(page.getByTestId('image-ocr-copy')).toBeEnabled();
		await expect(page.getByTestId('image-ocr-save')).toBeEnabled();
		await output(page).fill('a'.repeat(100_001));
		await expect(page.getByTestId('image-ocr-copy')).toBeDisabled();
		await expect(page.getByTestId('image-ocr-save')).toBeDisabled();
		await expect(
			page.getByRole('alert').filter({ hasText: '長すぎます' }),
		).toBeVisible();
	});

	test('HTMLやMarkdownとして解釈せず、文字列のまま表示する', async ({
		page,
	}) => {
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await recognize(page);
		await output(page).fill(
			'<img src=x onerror=window.__xss=1> **bold** [a](b)',
		);
		await expect(output(page)).toHaveValue(
			'<img src=x onerror=window.__xss=1> **bold** [a](b)',
		);
		expect(
			await page.evaluate(() => (window as { __xss?: number }).__xss),
		).toBeUndefined();
		await expect(page.locator('img[src="x"]')).toHaveCount(0);
	});
});

test.describe('画像OCR: キャンセル・中断・失敗', () => {
	test('言語データ取得中にキャンセルすると結果もエラーも出ず、再実行できる', async ({
		page,
	}) => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(MODEL_ROUTE, async (route) => {
			await gate;
			await route.continue();
		});
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await runButton(page).click();
		await expect(page.getByTestId('image-ocr-progress')).toContainText(
			'言語データを準備中',
		);
		await page.getByTestId('image-ocr-cancel').click();
		await expect(page.getByText('キャンセルしました')).toBeVisible();
		release?.();
		await page.waitForTimeout(1500);
		await expect(output(page)).toHaveCount(0);
		await expect(errorBox(page)).toHaveCount(0);
		await expect(page.getByTestId('image-ocr-progress')).toHaveCount(0);
		await page.unroute(MODEL_ROUTE);
		await recognize(page);
		await expect(output(page)).toHaveValue(/quick brown fox/);
	});

	test('認識中にキャンセルすると古い結果が表示されず、再実行できる', async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const workers = trackWorkers(page);
		await open(page);
		await pick(page, fixtureImage('perf/p1-3mp.png'));
		await runButton(page).click();
		await expect(page.getByTestId('image-ocr-progress')).toContainText(
			'文字を読み取り中',
			{
				timeout: 30_000,
			},
		);
		await page.getByTestId('image-ocr-cancel').click();
		await expect(page.getByText('キャンセルしました')).toBeVisible();
		// キャンセルでエンジンのWorkerが終了する
		await expect.poll(() => workers.closed).toBe(1);
		await page.waitForTimeout(4000);
		await expect(output(page)).toHaveCount(0);
		await expect(errorBox(page)).toHaveCount(0);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await recognize(page);
		await expect(output(page)).toHaveValue(/quick brown fox/);
	});

	test('取得中に画像をクリアしても、遅れて届いた結果・エラーが画面に出ない', async ({
		page,
	}) => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(MODEL_ROUTE, async (route) => {
			await gate;
			await route.continue();
		});
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await runButton(page).click();
		await expect(page.getByTestId('image-ocr-progress')).toBeVisible();
		await page.getByRole('button', { name: '選択をクリア' }).click();
		await expect(page.getByTestId('image-ocr-preview')).toHaveCount(0);
		release?.();
		await page.waitForTimeout(2000);
		await expect(output(page)).toHaveCount(0);
		await expect(errorBox(page)).toHaveCount(0);
		await expect(page.getByTestId('image-ocr-progress')).toHaveCount(0);
	});

	test('言語データが404でも日本語で案内し、復旧後に再試行できる（Workerは起動しない）', async ({
		page,
	}) => {
		const workerStarts: string[] = [];
		page.on('worker', (w) => workerStarts.push(w.url()));
		await page.route(MODEL_ROUTE, (route) =>
			route.fulfill({ status: 404, body: 'nf' }),
		);
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await runButton(page).click();
		await expect(errorBox(page)).toContainText('取得できませんでした');
		await expect(output(page)).toHaveCount(0);
		expect(workerStarts).toEqual([]);
		await page.unroute(MODEL_ROUTE);
		await recognize(page);
		await expect(output(page)).toHaveValue(/quick brown fox/);
	});

	test('言語データが破損（SHA-256不一致）していたら使わず、保存もしない', async ({
		page,
	}) => {
		await page.route('**/models/ocr/**/eng.traineddata', async (route) => {
			const response = await route.fetch();
			const body = Buffer.from(await response.body());
			body[1000] ^= 0xff;
			await route.fulfill({ response, body });
		});
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await page.getByRole('radio', { name: '英語のみ' }).click();
		await runButton(page).click();
		await expect(errorBox(page)).toContainText('一致しません');
		const keys = await page.evaluate(async () => {
			const out: string[] = [];
			for (const name of await caches.keys()) {
				out.push(...(await (await caches.open(name)).keys()).map((r) => r.url));
			}
			return out;
		});
		expect(keys.filter((u) => u.includes('/models/ocr/'))).toEqual([]);
	});

	test('エンジンのWorkerスクリプトを取得できない場合も日本語エラーで、再試行できる', async ({
		page,
	}) => {
		await page.route('**/vendor/ocr/**/worker.min.js', (route) =>
			route.fulfill({ status: 404, body: 'nf' }),
		);
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await runButton(page).click();
		await expect(errorBox(page)).toContainText(
			'文字認識エンジンの実行に失敗しました',
		);
		await page.unroute('**/vendor/ocr/**/worker.min.js');
		await recognize(page);
		await expect(output(page)).toHaveValue(/quick brown fox/);
	});
});

test.describe('画像OCR: core（SIMD・非SIMD）', () => {
	// V8でSIMDを無効にする手段がないため、SIMD判定そのものは検証できない。
	// 既定で選ばれる relaxed-SIMD 版のリクエストへ別経路のcoreを返し、実ページ・実Workerで動くことを確認する。
	for (const variant of ['tesseract-core-simd-lstm', 'tesseract-core-lstm']) {
		test(`${variant} でも認識できる`, async ({ page }) => {
			const core = fs.readFileSync(
				`public/vendor/ocr/7.0.0/core/${variant}.wasm.js`,
			);
			let served = 0;
			await page.route(
				'**/core/tesseract-core-relaxedsimd-lstm.wasm.js',
				(route) => {
					served++;
					return route.fulfill({
						status: 200,
						contentType: 'text/javascript',
						body: core,
					});
				},
			);
			await open(page);
			await pick(page, fixtureImage('clear/07-meiryo-english.png'));
			await recognize(page);
			await expect(output(page)).toHaveValue(
				/quick brown fox jumps over the lazy dog/,
			);
			expect(served).toBe(1);
		});
	}
});

test.describe('画像OCR: 言語データのキャッシュ', () => {
	test('CacheStorageを使えなくてもオンラインで認識でき、保存できない旨を日本語で案内する', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, 'caches', {
				value: {
					open: () => Promise.reject(new Error('disabled')),
					keys: () => Promise.resolve([]),
				},
			});
		});
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await recognize(page);
		await expect(output(page)).toHaveValue(/quick brown fox/);
		await expect(page.getByTestId('image-ocr-model-note')).toContainText(
			'保存できませんでした',
		);
	});

	test('容量不足（保存の失敗）でもオンラインで認識でき、案内を表示する', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Cache.prototype.put = () =>
				Promise.reject(new DOMException('quota', 'QuotaExceededError'));
		});
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await recognize(page);
		await expect(output(page)).toHaveValue(/quick brown fox/);
		await expect(page.getByTestId('image-ocr-model-note')).toBeVisible();
	});

	test('取得済みのモデルは専用キャッシュだけに保存され、2回目はモデルを再取得しない', async ({
		page,
	}) => {
		const modelFetches: string[] = [];
		page.on('request', (r) => {
			if (r.url().includes('/models/ocr/')) modelFetches.push(r.url());
		});
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await recognize(page);
		const firstCount = modelFetches.length;
		expect(firstCount).toBe(2);
		const cached = await page.evaluate(async () => {
			const cache = await caches.open('ocr-models-v1');
			return (await cache.keys()).map((r) => new URL(r.url).pathname);
		});
		expect(cached.sort()).toEqual([
			expect.stringMatching(/\/models\/ocr\/[0-9a-f]{40}\/eng\.traineddata$/),
			expect.stringMatching(/\/models\/ocr\/[0-9a-f]{40}\/jpn\.traineddata$/),
		]);
		await pick(page, fixtureImage('clear/01-meiryo-prose.png'));
		await recognize(page);
		expect(modelFetches).toHaveLength(firstCount);
		await expect(output(page)).toHaveValue(/本日の会議/);
	});
});

test.describe('画像OCR: 設定', () => {
	test('保存される設定は言語モードだけで、読み込んだ画像・結果は保存されない', async ({
		page,
	}) => {
		await open(page);
		await pick(page, {
			name: 'private-name-marker.png',
			mimeType: 'image/png',
			buffer: fs.readFileSync(fixtureImage('clear/07-meiryo-english.png')),
		});
		await page.getByRole('radio', { name: '英語のみ' }).click();
		await recognize(page);
		const stored = await page.evaluate(() => ({
			local: { ...localStorage },
			session: { ...sessionStorage },
			href: location.href,
		}));
		expect(stored.local['tool_settings_image-ocr']).toBe(
			JSON.stringify({ mode: 'eng' }),
		);
		expect(JSON.stringify(stored)).not.toContain('private-name-marker');
		expect(JSON.stringify(stored)).not.toContain('quick brown fox');
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await expect(page.getByRole('radio', { name: '英語のみ' })).toBeChecked();
	});

	test('共有URLの設定（言語モード）を復元し、不正値は既定に戻す', async ({
		page,
	}) => {
		const encode = (v: unknown) =>
			Buffer.from(JSON.stringify(v), 'utf8').toString('base64');
		await page.goto(
			`${URL_PATH}?settings=${encodeURIComponent(encode({ mode: 'eng' }))}`,
		);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await expect(page.getByRole('radio', { name: '英語のみ' })).toBeChecked();
		await page.evaluate(() => localStorage.clear());
		await page.goto(
			`${URL_PATH}?settings=${encodeURIComponent(encode({ mode: 'xx' }))}`,
		);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await expect(
			page.getByRole('radio', { name: '日本語＋英語' }),
		).toBeChecked();
	});
});

test.describe('画像OCR: UI・アクセシビリティ', () => {
	test('キーボードで操作でき、ラベル・進捗・結果の領域に名前がある', async ({
		page,
	}) => {
		await open(page);
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await runButton(page).focus();
		await page.keyboard.press('Enter');
		await expect(output(page)).toBeVisible({ timeout: 60_000 });
		await expect(page.getByLabel('認識結果（編集できます）')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'すべてコピー' }),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'TXTで保存' })).toBeVisible();
		await expect(page.getByRole('img', { name: /プレビュー/ })).toBeVisible();
	});

	test('長い出力・長いファイル名でも横にはみ出さない', async ({ page }) => {
		await open(page);
		const longName = `${'long-file-name-'.repeat(12)}.png`;
		await pick(page, {
			name: longName,
			mimeType: 'image/png',
			buffer: fs.readFileSync(fixtureImage('clear/07-meiryo-english.png')),
		});
		await recognize(page);
		await output(page).fill(`${'あいうえお'.repeat(400)}\n${'x'.repeat(2000)}`);
		const overflow = await page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			client: document.documentElement.clientWidth,
		}));
		expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
	});
});

test.describe('画像OCR: 入力検査の順序と確認中表示（pre-PR修正）', () => {
	test('空・20MiB超のファイルは、全体を読み込む前にサイズで拒否する', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const w = window as unknown as { __readCount: number };
			w.__readCount = 0;
			const original = Blob.prototype.arrayBuffer;
			Blob.prototype.arrayBuffer = function () {
				w.__readCount++;
				return original.call(this);
			};
		});
		const reads = () =>
			page.evaluate(
				() => (window as unknown as { __readCount: number }).__readCount,
			);
		await open(page);
		await pick(page, {
			name: 'huge.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
		});
		await expect(errorBox(page)).toContainText('20MiB');
		await expect(page.getByText('画像を確認中')).toHaveCount(0);
		expect(await reads()).toBe(0);
		await pick(page, {
			name: 'empty.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(0),
		});
		await expect(errorBox(page)).toContainText('空です');
		expect(await reads()).toBe(0);
		// 20MiBちょうどは上限内なので、内容を読んで形式を判定する
		await pick(page, {
			name: 'exact.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(20 * 1024 * 1024),
		});
		await expect(errorBox(page)).toContainText('対応していない形式');
		expect(await reads()).toBe(1);
	});

	test('読み込み遅延中に複数ファイルを投入すると、確認中表示が消えエラーが出て、遅れて完了した古い画像は反映されない', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const w = window as unknown as { __releaseSlow: () => void };
			const gate = new Promise<void>((resolve) => {
				w.__releaseSlow = resolve;
			});
			const original = Blob.prototype.arrayBuffer;
			Blob.prototype.arrayBuffer = function () {
				if ((this as File).name === 'slow-a.png') {
					return gate.then(() => original.call(this));
				}
				return original.call(this);
			};
		});
		await open(page);
		const png = fs.readFileSync(fixtureImage('clear/07-meiryo-english.png'));
		await pick(page, {
			name: 'slow-a.png',
			mimeType: 'image/png',
			buffer: png,
		});
		await expect(page.getByText('画像を確認中')).toBeVisible();
		await pick(page, [
			{ name: 'b1.png', mimeType: 'image/png', buffer: png },
			{ name: 'b2.png', mimeType: 'image/png', buffer: png },
		] as unknown as string);
		await expect(errorBox(page)).toContainText('1枚だけ');
		await expect(page.getByText('画像を確認中')).toHaveCount(0);
		await page.evaluate(() =>
			(window as unknown as { __releaseSlow: () => void }).__releaseSlow(),
		);
		await page.waitForTimeout(1000);
		await expect(page.getByTestId('image-ocr-preview')).toHaveCount(0);
		await expect(page.getByTestId('image-ocr-info')).toHaveCount(0);
		await expect(errorBox(page)).toContainText('1枚だけ');
		await expect(page.getByText('画像を確認中')).toHaveCount(0);
		// その後、単一画像を読み込める
		await pick(page, fixtureImage('clear/07-meiryo-english.png'));
		await expect(page.getByTestId('image-ocr-preview')).toBeVisible();
		await expect(errorBox(page)).toHaveCount(0);
		await expect(page.getByText('画像を確認中')).toHaveCount(0);
	});
});

test('遅延読込中のサイズ拒否でも確認中表示を解除し、古い画像を表示しない', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const w = window as unknown as { __releaseSlowSize: () => void };
		const gate = new Promise<void>((resolve) => {
			w.__releaseSlowSize = resolve;
		});
		const original = Blob.prototype.arrayBuffer;
		Blob.prototype.arrayBuffer = function () {
			return (this as File).name === 'slow-size.png'
				? gate.then(() => original.call(this))
				: original.call(this);
		};
	});
	await open(page);
	await pick(page, {
		name: 'slow-size.png',
		mimeType: 'image/png',
		buffer: fs.readFileSync(fixtureImage('clear/01-meiryo-prose.png')),
	});
	await expect(page.getByText('画像を確認中')).toBeVisible();
	await pick(page, {
		name: 'too-large.png',
		mimeType: 'image/png',
		buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
	});
	await expect(errorBox(page)).toContainText('20MiB');
	await expect(page.getByText('画像を確認中')).toHaveCount(0);
	await page.evaluate(() =>
		(
			window as unknown as { __releaseSlowSize: () => void }
		).__releaseSlowSize(),
	);
	await expect(page.getByTestId('image-ocr-preview')).toHaveCount(0);
	await expect(errorBox(page)).toContainText('20MiB');
	await pick(page, fixtureImage('clear/01-meiryo-prose.png'));
	await expect(page.getByTestId('image-ocr-preview')).toBeVisible();
	await expect(page.getByText('画像を確認中')).toHaveCount(0);
});
