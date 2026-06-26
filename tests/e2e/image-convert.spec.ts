import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

const FIX = (name: string) =>
	path.join(process.cwd(), 'tests', 'e2e', 'fixtures', name);

const PNG = FIX('sample-400x300.png');
const WEBP = FIX('convert-sample.webp');
const HEIC = FIX('convert-sample.heic');
const EXIF_JPG = FIX('convert-exif.jpg');

const input = (page: Page) => page.getByTestId('image-convert-input');
const downloadBtn = (page: Page) =>
	page.getByRole('button', { name: 'ダウンロード', exact: true }).first();

/** 初回アップロード後、最初の変換完了（ダウンロードボタン表示）を待つ */
async function waitConverted(page: Page) {
	await downloadBtn(page).waitFor({ state: 'visible', timeout: 45_000 });
}

/** 出力形式を選び直して再変換し、完了を待つ */
async function reconvert(page: Page, format: 'JPEG' | 'PNG' | 'WebP' | 'AVIF') {
	await page.getByRole('combobox', { name: '出力形式' }).click();
	await page.getByRole('option', { name: format, exact: true }).click();
	const btn = downloadBtn(page);
	await page.getByRole('button', { name: 'この設定で再変換' }).click();
	// 再処理開始で一旦消え、完了で再表示される
	await btn.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
	await btn.waitFor({ state: 'visible', timeout: 45_000 });
}

async function readDownload(
	page: Page,
): Promise<{ name: string; buf: Buffer }> {
	const downloadPromise = page.waitForEvent('download');
	await downloadBtn(page).click();
	const download = await downloadPromise;
	const buf = fs.readFileSync(await download.path());
	return { name: download.suggestedFilename(), buf };
}

test.describe('画像形式変換', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('image-convert');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('image-convert');
		await toolPage.expectTitle('画像形式変換');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
		// /image-compress への送客リンク
		await expect(
			page.getByRole('link', { name: '画像圧縮・リサイズ' }).first(),
		).toBeVisible();
	});

	test('PNG→JPEG が成功しダウンロードできる', async ({ page }) => {
		await input(page).setInputFiles(PNG);
		await waitConverted(page);
		await expect(page.getByTestId('convert-completion')).toContainText(
			'変換完了',
		);
		const { name, buf } = await readDownload(page);
		expect(name).toBe('sample-400x300.jpg');
		expect(buf[0]).toBe(0xff);
		expect(buf[1]).toBe(0xd8); // JPEG
	});

	test('WebP→PNG が成功しダウンロードできる', async ({ page }) => {
		await input(page).setInputFiles(WEBP);
		await waitConverted(page);
		await reconvert(page, 'PNG');
		const { name, buf } = await readDownload(page);
		expect(name).toBe('convert-sample.png');
		expect(buf[0]).toBe(0x89);
		expect(buf[1]).toBe(0x50);
		expect(buf[2]).toBe(0x4e);
		expect(buf[3]).toBe(0x47); // PNG
	});

	test('HEIC→JPEG が成功する（libheif遅延ロード）', async ({ page }) => {
		test.slow();
		// HEIC 投入時のみ libheif の wasm-bundle チャンクが読み込まれることを確認
		const heifRequested = page.waitForRequest(/wasm-bundle/, {
			timeout: 45_000,
		});
		await input(page).setInputFiles(HEIC);
		await heifRequested;
		await waitConverted(page);
		const { name, buf } = await readDownload(page);
		expect(name).toBe('convert-sample.jpg');
		expect(buf[0]).toBe(0xff);
		expect(buf[1]).toBe(0xd8); // JPEG
	});

	test('出力AVIF が生成される', async ({ page }) => {
		test.slow();
		await input(page).setInputFiles(WEBP);
		await waitConverted(page);
		await reconvert(page, 'AVIF');
		const { name, buf } = await readDownload(page);
		expect(name).toBe('convert-sample.avif');
		// ISO-BMFF ftyp + AVIF brand
		expect(buf.toString('latin1', 4, 8)).toBe('ftyp');
		expect(buf.toString('latin1', 8, 12)).toBe('avif');
	});

	test('複数入力 → converted.zip（PK署名＋エントリ数）', async ({ page }) => {
		await input(page).setInputFiles([PNG, WEBP]);
		const zipButton = page.getByRole('button', {
			name: 'ZIPでまとめてダウンロード',
		});
		await expect(zipButton).toBeVisible({ timeout: 45_000 });

		const downloadPromise = page.waitForEvent('download');
		await zipButton.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('converted.zip');

		const buf = fs.readFileSync(await download.path());
		expect(buf[0]).toBe(0x50);
		expect(buf[1]).toBe(0x4b); // PK
		// EOCD（末尾22バイト・コメント無し）の総エントリ数 = 2
		const eocd = buf.length - 22;
		expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
		expect(buf.readUInt16LE(eocd + 10)).toBe(2);
	});

	test('EXIF付きJPEG→JPEG で keep / strip の差が出る', async ({ page }) => {
		const EXIF_MARK = Buffer.from('Exif\0\0', 'latin1');

		// 既定（strip）: 出力に EXIF が無い
		await input(page).setInputFiles(EXIF_JPG);
		await waitConverted(page);
		const stripped = await readDownload(page);
		expect(stripped.name).toBe('convert-exif.jpg');
		expect(stripped.buf.includes(EXIF_MARK)).toBe(false);

		// 保持（keep）: 出力に EXIF が残る
		await page.getByRole('switch', { name: /EXIF/ }).click();
		const btn = downloadBtn(page);
		await page.getByRole('button', { name: 'この設定で再変換' }).click();
		await btn.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
		await btn.waitFor({ state: 'visible', timeout: 45_000 });
		const kept = await readDownload(page);
		expect(kept.buf.includes(EXIF_MARK)).toBe(true);
	});

	test('非JPEG出力＋保持で注意表示が出る', async ({ page }) => {
		await input(page).setInputFiles(PNG);
		await waitConverted(page);
		// EXIF保持を有効化
		await page.getByRole('switch', { name: /EXIF/ }).click();
		// 出力をPNGに変更 → 注意表示
		await page.getByRole('combobox', { name: '出力形式' }).click();
		await page.getByRole('option', { name: 'PNG', exact: true }).click();
		await expect(
			page.getByText('EXIF保持はJPEG出力でのみ確実です', { exact: false }),
		).toBeVisible();
	});

	test('上限超過（枚数）で日本語エラー', async ({ page }) => {
		const files = Array.from({ length: 31 }, (_, i) => ({
			name: `a${i}.png`,
			mimeType: 'image/png',
			buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
		}));
		await input(page).setInputFiles(files);
		await expect(page.getByRole('alert')).toContainText(
			'一度に処理できるのは30ファイルまで',
		);
	});

	test('上限超過（サイズ50MB）で日本語エラー', async ({ page }, testInfo) => {
		// setInputFiles のインメモリ buffer は 50MB 上限のため一時ファイル経由で渡す
		const big = path.join(
			os.tmpdir(),
			`cl-convert-big-${testInfo.workerIndex}.png`,
		);
		fs.writeFileSync(big, Buffer.alloc(50 * 1024 * 1024 + 1024));
		try {
			await input(page).setInputFiles(big);
			await expect(page.getByRole('alert')).toContainText(
				'ファイルサイズが50MBを超えています',
			);
		} finally {
			fs.rmSync(big, { force: true });
		}
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await input(page).setInputFiles(PNG);
		await waitConverted(page);
		await expect(page.getByTestId('convert-result-list')).toBeVisible();
	});
});
