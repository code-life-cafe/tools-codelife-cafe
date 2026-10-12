import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

const landscape = resolve('tests/e2e/fixtures/video-compress.mp4');
const portrait = resolve('tests/e2e/fixtures/video-compress-portrait.mp4');
async function open(page: Page) {
	await page.goto('/video-compress');
	await expect(page.locator('astro-island[ssr][client="load"]')).toHaveCount(0);
}
async function load(page: Page, file = landscape) {
	await page.getByLabel('動画を選択、またはここにドロップ').setInputFiles(file);
	await expect(
		page.getByRole('button', { name: '圧縮する', exact: true }),
	).toBeEnabled({ timeout: 20_000 });
}
async function output(page: Page, path: string) {
	await expect(page.getByRole('status')).toHaveText('圧縮が完了しました。', {
		timeout: 45_000,
	});
	const pending = page.waitForEvent('download');
	await page.getByRole('link', { name: 'MP4をダウンロード' }).click();
	const download = await pending;
	await download.saveAs(path);
	const data = await readFile(path);
	return new Input({
		formats: ALL_FORMATS,
		source: new BlobSource(new Blob([data])),
	});
}
test('実動画をオフラインで圧縮し映像・音声・トリミングを保持、送信なし', async ({
	page,
	context,
}, testInfo) => {
	const requests: { url: string; method: string }[] = [];
	page.on('request', (request) =>
		requests.push({ url: request.url(), method: request.method() }),
	);
	await open(page);
	await load(page);
	await page.getByLabel('品質', { exact: true }).selectOption('low');
	await page.getByLabel('解像度（長辺の上限）').selectOption('854');
	await page.getByLabel('開始秒').fill('0.5');
	await page.getByLabel('終了秒').fill('2.5');
	await context.setOffline(true);
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	const result = await output(page, testInfo.outputPath('compressed.mp4'));
	try {
		const video = await result.getPrimaryVideoTrack();
		expect(video?.codec).toBe('avc');
		expect(video?.displayWidth).toBe(854);
		expect(video?.displayHeight).toBe(480);
		const audio = await result.getAudioTracks();
		expect(audio).toHaveLength(1);
		expect(audio[0].codec).toBe('aac');
		expect(audio[0].sampleRate).toBe(48000);
		expect(await audio[0].getFirstTimestamp()).toBeGreaterThanOrEqual(0);
		expect(await audio[0].getFirstTimestamp()).toBeLessThan(0.05);
		expect(await audio[0].computeDuration()).toBeCloseTo(2, 1);
		if (video) {
			expect(await video.getFirstTimestamp()).toBeCloseTo(0, 1);
			expect(await video.computeDuration()).toBeCloseTo(2, 1);
		}
		expect(await result.computeDuration()).toBeCloseTo(2, 1);
		expect(
			(await readFile(testInfo.outputPath('compressed.mp4'))).length,
		).toBeLessThan((await readFile(landscape)).length);
	} finally {
		result.dispose();
		await context.setOffline(false);
	}
	expect(
		requests.filter(
			(request) =>
				!request.url.startsWith('http://localhost:4321/') &&
				!request.url.startsWith('blob:'),
		),
	).toEqual([]);
	expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
	expect(
		requests.some((request) =>
			/video-compress\.mp4|api\/event/.test(request.url),
		),
	).toBe(false);
	const settings = await page.evaluate(() =>
		localStorage.getItem('tool_settings_video-compress'),
	);
	expect(settings).not.toContain('video-compress.mp4');
	expect(settings).not.toContain('start');
});
test('縦動画・音声なし・目標容量と不正範囲', async ({ page }, testInfo) => {
	await open(page);
	await load(page, portrait);
	await page.getByLabel('圧縮方法').selectOption('size');
	await page.getByLabel('目標容量（MB）').fill('0.2');
	await page.getByLabel('開始秒').fill('3');
	await expect(page.getByRole('alert')).toContainText('開始・終了秒');
	await expect(
		page.getByRole('button', { name: '圧縮する', exact: true }),
	).toBeDisabled();
	await page.getByLabel('開始秒').fill('0');
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	const result = await output(page, testInfo.outputPath('portrait.mp4'));
	try {
		const video = await result.getPrimaryVideoTrack();
		expect(video?.displayWidth).toBe(360);
		expect(video?.displayHeight).toBe(640);
		expect(await result.getAudioTracks()).toHaveLength(0);
		expect(await result.computeDuration()).toBeCloseTo(3, 1);
	} finally {
		result.dispose();
	}
});
test('キャンセル後に再実行・音声削除', async ({ page }, testInfo) => {
	await open(page);
	await load(page);
	await page.getByLabel('音声を削除').check();
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	await page.getByRole('button', { name: 'キャンセル' }).click();
	await expect(
		page.getByRole('button', { name: '圧縮する', exact: true }),
	).toBeEnabled();
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	const result = await output(page, testInfo.outputPath('muted.mp4'));
	try {
		expect(await result.getAudioTracks()).toHaveLength(0);
		expect(await result.getPrimaryVideoTrack()).not.toBeNull();
	} finally {
		result.dispose();
	}
});
test('壊れた動画・非対応形式から回復', async ({ page }) => {
	await open(page);
	await page.getByLabel('動画を選択、またはここにドロップ').setInputFiles({
		name: 'invalid.mp4',
		mimeType: 'video/mp4',
		buffer: Buffer.from('invalid'),
	});
	await expect(page.getByRole('alert')).toContainText('処理できません');
	await page.getByLabel('動画を選択、またはここにドロップ').setInputFiles({
		name: 'sample.avi',
		mimeType: 'video/x-msvideo',
		buffer: Buffer.from('invalid'),
	});
	await expect(page.getByRole('alert')).toContainText('256MiB以下');
	await load(page);
});
test('AAC非対応Workerでは音声を黙って落とさない', async ({
	page,
}, testInfo) => {
	await page.route('**/video-compress.worker-*.js', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: `globalThis.AudioEncoder = undefined;\n${await response.text()}`,
		});
	});
	await open(page);
	await load(page, resolve('tests/e2e/fixtures/video-compress-opus.webm'));
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('AAC変換ができません', {
		timeout: 20_000,
	});
	await expect(
		page.getByRole('link', { name: 'MP4をダウンロード' }),
	).toHaveCount(0);
	await page.getByLabel('音声を削除').check();
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	const result = await output(page, testInfo.outputPath('no-aac.mp4'));
	try {
		expect(await result.getAudioTracks()).toHaveLength(0);
	} finally {
		result.dispose();
	}
});

test('Worker異常終了後に読み直して回復', async ({ page }, testInfo) => {
	let injectFailure = true;
	await page.route('**/video-compress.worker-*.js', async (route) => {
		const response = await route.fetch();
		const body = await response.text();
		await route.fulfill({
			response,
			body: injectFailure
				? `${body}\nself.addEventListener('message', (event) => { if (event.data.type === 'compress') throw new Error('test worker failure'); });`
				: body,
		});
	});
	await open(page);
	await load(page);
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('動画処理が停止しました');
	await expect(
		page.getByRole('button', { name: '圧縮する', exact: true }),
	).toHaveCount(0);
	injectFailure = false;
	await page.getByRole('button', { name: '動画を読み直す' }).click();
	await expect(
		page.getByRole('button', { name: '圧縮する', exact: true }),
	).toBeEnabled();
	await page.getByLabel('音声を削除').check();
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	const result = await output(page, testInfo.outputPath('recovered.mp4'));
	try {
		expect(await result.getPrimaryVideoTrack()).not.toBeNull();
	} finally {
		result.dispose();
	}
});

test('rotation付き動画を表示寸法で縮小しPC・スマホ幅で操作できる', async ({
	page,
}, testInfo) => {
	await open(page);
	await load(page, resolve('tests/e2e/fixtures/video-compress-rotated.mp4'));
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.getByLabel('解像度（長辺の上限）').selectOption('854');
	const button = page.getByRole('button', { name: '圧縮する', exact: true });
	await button.focus();
	await button.press('Enter');
	const result = await output(page, testInfo.outputPath('rotated.mp4'));
	try {
		const video = await result.getPrimaryVideoTrack();
		expect(video?.displayWidth).toBe(360);
		expect(video?.displayHeight).toBe(640);
		expect(video?.rotation).toBe(0);
	} finally {
		result.dispose();
	}
	await page.screenshot({
		path: testInfo.outputPath('video-compress.png'),
		fullPage: true,
	});
});

test('本番の共通CSP解除後もmetaで制限し元・結果動画を再生可能', async ({
	page,
}, testInfo) => {
	const { VIDEO_CSP } = await import('../../src/lib/tools/video-compress');
	await page.route('**/video-compress', async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: Object.fromEntries(
				Object.entries(response.headers()).filter(
					([name]) => name.toLowerCase() !== 'content-security-policy',
				),
			),
		});
	});
	await open(page);
	await expect(
		page.locator('meta[http-equiv="Content-Security-Policy"]'),
	).toHaveAttribute('content', VIDEO_CSP);
	await load(page);
	await expect
		.poll(() =>
			page
				.getByLabel('元の動画プレビュー')
				.evaluate((video) => (video as HTMLVideoElement).readyState),
		)
		.toBeGreaterThanOrEqual(2);
	await page.getByRole('button', { name: '圧縮する', exact: true }).click();
	const result = await output(page, testInfo.outputPath('production-csp.mp4'));
	try {
		expect(await result.getAudioTracks()).toHaveLength(1);
	} finally {
		result.dispose();
	}
	await expect
		.poll(() =>
			page
				.getByLabel('圧縮後の動画プレビュー')
				.evaluate((video) => (video as HTMLVideoElement).readyState),
		)
		.toBeGreaterThanOrEqual(2);
});
