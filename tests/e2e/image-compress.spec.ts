import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/base';

const SAMPLE = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'sample-400x300.png',
);
const ALPHA = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'compress-alpha.png',
);

const fileInput = (page: import('@playwright/test').Page) =>
	page.locator('input[type="file"]');

async function uploadAndWait(
	page: import('@playwright/test').Page,
	files: string | string[],
) {
	await fileInput(page).setInputFiles(files);
	// 1枚目の結果（ダウンロードボタン）が出るまで待つ
	await expect(
		page.getByRole('button', { name: 'ダウンロード', exact: true }).first(),
	).toBeVisible();
}

test.describe('画像圧縮・リサイズ', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('image-compress');
		await toolPage.goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('image-compress');
		await toolPage.expectTitle('画像圧縮');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('PNGアップロードで結果が表示されダウンロードできる', async ({
		page,
	}) => {
		await uploadAndWait(page, SAMPLE);
		await expect(page.getByTestId('compress-result-list')).toBeVisible();
		await expect(page.getByTestId('compress-completion')).toContainText(
			'変換完了: 1件の画像を処理しました。',
		);
		// keep（既定）→ PNG出力
		const downloadPromise = page.waitForEvent('download');
		await page
			.getByRole('button', { name: 'ダウンロード', exact: true })
			.first()
			.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('sample-400x300_compressed.png');
	});

	test('最大幅リサイズで出力寸法が変わる', async ({ page }) => {
		await uploadAndWait(page, SAMPLE);

		await page.getByRole('combobox', { name: 'リサイズ' }).click();
		await page.getByRole('option', { name: '最大幅を指定' }).click();
		await page.getByRole('spinbutton', { name: 'リサイズ値' }).fill('200');
		await page.getByRole('button', { name: 'この設定で再圧縮' }).click();

		// 400×300 → 200×150（縦横比維持）。結果行の寸法表示で検証
		await expect(page.getByText('200×150')).toBeVisible();
	});

	test('目標サイズ指定（JPEG）で目標KB以下になる', async ({ page }) => {
		await uploadAndWait(page, SAMPLE);

		await page.getByRole('combobox', { name: '出力形式' }).click();
		await page.getByRole('option', { name: 'JPEG' }).click();
		await page
			.getByRole('switch', { name: '目標ファイルサイズを指定' })
			.click();
		await page.getByRole('spinbutton', { name: '目標サイズ(KB)' }).fill('30');
		await page.getByRole('button', { name: 'この設定で再圧縮' }).click();

		const downloadPromise = page.waitForEvent('download');
		await page
			.getByRole('button', { name: 'ダウンロード', exact: true })
			.first()
			.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/_compressed\.jpg$/);
		const buf = fs.readFileSync(await download.path());
		expect(buf.length).toBeLessThanOrEqual(30 * 1024);
		// JPEGシグネチャ（FF D8）
		expect(buf[0]).toBe(0xff);
		expect(buf[1]).toBe(0xd8);
	});

	test('複数ファイルをZIPで一括ダウンロードできる', async ({ page }) => {
		await fileInput(page).setInputFiles([SAMPLE, ALPHA]);
		// 2件とも完了するまで待つ（ZIPボタンは2件完了で出現）
		const zipButton = page.getByRole('button', {
			name: 'ZIPでまとめてダウンロード',
		});
		await expect(zipButton).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await zipButton.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('images_compressed.zip');

		const buf = fs.readFileSync(await download.path());
		// PK シグネチャ
		expect(buf[0]).toBe(0x50);
		expect(buf[1]).toBe(0x4b);
		// EOCD（末尾22バイト）の総エントリ数 = 2
		const eocd = buf.length - 22;
		expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
		expect(buf.readUInt16LE(eocd + 10)).toBe(2);
	});

	test('JPEG画像を入力して圧縮ダウンロードできる', async ({ page }) => {
		// Nodeに画像エンコーダがないため、ブラウザ内で実JPEGを生成して入力する
		await page.evaluate(async () => {
			const c = document.createElement('canvas');
			c.width = 300;
			c.height = 200;
			const ctx = c.getContext('2d');
			if (!ctx) return;
			const grad = ctx.createLinearGradient(0, 0, 300, 200);
			grad.addColorStop(0, '#ff3030');
			grad.addColorStop(1, '#3030ff');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, 300, 200);
			const blob = await new Promise<Blob | null>((res) =>
				c.toBlob(res, 'image/jpeg', 0.92),
			);
			if (!blob) return;
			const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
			const dt = new DataTransfer();
			dt.items.add(file);
			const input = document.querySelector(
				'input[type=file]',
			) as HTMLInputElement;
			input.files = dt.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});

		const downloadPromise = page.waitForEvent('download');
		await page
			.getByRole('button', { name: 'ダウンロード', exact: true })
			.first()
			.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('photo_compressed.jpg');
	});

	test('非対応形式（GIF）は日本語エラーになる', async ({ page }) => {
		await fileInput(page).setInputFiles({
			name: 'anim.gif',
			mimeType: 'image/gif',
			buffer: Buffer.from('GIF89a fake'),
		});
		await expect(page.getByRole('alert')).toContainText('対応していない形式');
	});

	test('処理中にキャンセルすると中断され、未処理のアイテムはpendingのまま残る', async ({
		page,
	}) => {
		const files = Array.from({ length: 30 }, () => SAMPLE);
		await fileInput(page).setInputFiles(files);

		const cancelButton = page.getByRole('button', { name: 'キャンセル' });
		await cancelButton.click();

		await expect(cancelButton).toBeHidden();
		// 中断により、全件が処理し終わる前に止まっている（未処理アイテムが残る）
		await expect(page.getByText('処理中…').first()).toBeVisible();
		await expect(page.getByTestId('compress-completion')).toBeHidden();
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await uploadAndWait(page, SAMPLE);
		await expect(page.getByTestId('compress-result-list')).toBeVisible();
	});
});
