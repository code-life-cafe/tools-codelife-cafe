import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/base';

const FIXTURES = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
const PNG_512 = path.join(FIXTURES, 'favicon-512.png');
const SVG = path.join(FIXTURES, 'favicon-source.svg');
const NON_SQUARE = path.join(FIXTURES, 'sample-400x300.png');

const fileInput = (page: import('@playwright/test').Page) =>
	page.getByTestId('favicon-input');

const zipButton = (page: import('@playwright/test').Page) =>
	page.getByRole('button', { name: 'favicon.zip をダウンロード' });

/** 画像を投入し、生成完了（ZIPボタンが有効化）まで待つ */
async function uploadAndWait(
	page: import('@playwright/test').Page,
	file: string,
) {
	await fileInput(page).setInputFiles(file);
	await expect(zipButton(page)).toBeEnabled();
}

test.describe('ファビコン生成', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('favicon');
		await toolPage.goto();
	});

	test('ページ表示・SafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('favicon');
		await toolPage.expectTitle('ファビコン生成');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('512×512 PNG投入 → favicon.zip がDLされ7エントリを含む', async ({
		page,
	}) => {
		await uploadAndWait(page, PNG_512);

		const downloadPromise = page.waitForEvent('download');
		await zipButton(page).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('favicon.zip');

		const buf = fs.readFileSync(await download.path());
		// PK シグネチャ
		expect(buf[0]).toBe(0x50);
		expect(buf[1]).toBe(0x4b);
		// EOCD（末尾22バイト・コメントなし）の総エントリ数 = 7
		// （favicon.ico + PNG5枚 + site.webmanifest）
		const eocd = buf.length - 22;
		expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
		expect(buf.readUInt16LE(eocd + 10)).toBe(7);
	});

	test('SVG投入で生成が成功しプレビューに反映される', async ({ page }) => {
		await uploadAndWait(page, SVG);
		// プレビューのファビコン画像が blob URL を持つ（＝生成済み）
		await expect(page.getByTestId('favicon-tab-icon')).toHaveAttribute(
			'src',
			/^blob:/,
		);
		// SVG でも ZIP がダウンロードできる
		const downloadPromise = page.waitForEvent('download');
		await zipButton(page).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('favicon.zip');
	});

	test('非正方形入力で cover / contain 切替がプレビューに反映される', async ({
		page,
	}) => {
		await uploadAndWait(page, NON_SQUARE);

		const homeIcon = page.getByTestId('favicon-home-icon');
		await expect(homeIcon).toHaveAttribute('src', /^blob:/);
		const before = await homeIcon.getAttribute('src');

		// 既定（余白をつける＝contain）→ 中央をクロップ（cover）に切替
		await page.getByRole('tab', { name: '中央をクロップ' }).click();

		// 再生成され object URL が更新される（プレビューに反映）
		await expect(homeIcon).not.toHaveAttribute('src', before ?? '');
		await expect(homeIcon).toHaveAttribute('src', /^blob:/);
	});

	test('アプリ名を連続入力してもフォーカスが外れない', async ({ page }) => {
		await uploadAndWait(page, PNG_512);

		const appName = page.getByLabel('アプリ名（site.webmanifest）');
		await appName.click();
		// 既定値 "My App" に続けて連続入力する。生成のたびに input が
		// disabled 化されると blur され、以降の文字が落ちる／フォーカスを失う。
		await appName.pressSequentially(' Pro', { delay: 20 });

		await expect(appName).toBeFocused();
		await expect(appName).toHaveValue('My App Pro');
	});

	test('HTMLスニペットが表示されコピーできる', async ({ page }) => {
		await uploadAndWait(page, PNG_512);

		const snippet = page.getByTestId('favicon-html-snippet');
		await expect(snippet).toContainText('rel="icon"');
		await expect(snippet).toContainText('/favicon.ico');
		await expect(snippet).toContainText('rel="manifest"');

		await page.getByRole('button', { name: 'HTMLをコピー' }).click();
		// コピー後はラベルが切り替わる（CopyButton の aria-label）
		await expect(
			page.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible();
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText('画像をドラッグ＆ドロップ')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await uploadAndWait(page, PNG_512);
		await expect(page.getByTestId('favicon-preview')).toBeVisible();
	});

	test('外部参照を含むSVGは拒否される（外部送信を防ぐ）', async ({ page }) => {
		await fileInput(page).setInputFiles({
			name: 'evil.svg',
			mimeType: 'image/svg+xml',
			buffer: Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
			),
		});
		await expect(page.getByRole('alert')).toContainText('自己完結');
		// 生成されないため ZIP ボタンは現れない
		await expect(zipButton(page)).toHaveCount(0);
	});

	test('非対応形式（GIF）は日本語エラーになる', async ({ page }) => {
		// FileDropzone の accept フィルタが GIF を弾き、日本語エラーを表示する
		await fileInput(page).setInputFiles({
			name: 'anim.gif',
			mimeType: 'image/gif',
			buffer: Buffer.from('GIF89a fake'),
		});
		await expect(page.getByRole('alert')).toContainText('対応していない');
	});
});
