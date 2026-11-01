import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/base';

test.describe('JSON Formatter', () => {
	test('loads page and shows format UI', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		// Verify key UI elements are present
		await expect(page.getByRole('textbox').first()).toBeVisible();
		await expect(page.getByRole('button', { name: /整形/ })).toBeVisible();
	});

	test('should format valid JSON and show error for invalid JSON', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		// 1. Input valid JSON
		const inputArea = page.getByRole('textbox').first();
		await inputArea.fill('{"a":1,"b":"hello"}');

		// Verify output is formatted (should contain newline and indentation)
		const outputContainer = page.locator('pre');
		await expect(outputContainer).toContainText('"a": 1');
		await expect(outputContainer).toContainText('"b": "hello"');

		// 2. Input invalid JSON
		await inputArea.fill('{"a":1');

		// Verify error banner is visible
		const errorBanner = page.locator('.bg-destructive\\/10');
		await expect(errorBanner).toBeVisible();
		await expect(errorBanner).toContainText('エラー');
	});

	test('空欄で整形・圧縮を実行すると入力を促す案内を表示し、入力すると消える', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();

		const inputArea = page.locator('#json-input-textarea');
		// プレースホルダーは例であることが分かる表記にする
		await expect(inputArea).toHaveAttribute('placeholder', /^例: /);
		await expect(inputArea).toHaveValue('');

		const notice = page
			.getByRole('status')
			.filter({ hasText: 'JSONを入力してください' });
		await expect(notice).toHaveCount(0);

		await page.getByRole('button', { name: '整形' }).click();
		await expect(notice).toBeVisible();
		await expect(notice).toContainText('プレースホルダー');
		// エラー扱いにはしない
		await expect(page.locator('.bg-destructive\\/10')).toHaveCount(0);

		// 空白だけの入力も空欄として扱う
		await inputArea.fill('   ');
		await expect(notice).toHaveCount(0);
		await page.getByRole('button', { name: '圧縮' }).click();
		await expect(notice).toBeVisible();

		await inputArea.fill('{"a":1}');
		await expect(notice).toHaveCount(0);
		await page.getByRole('button', { name: '整形' }).click();
		await expect(notice).toHaveCount(0);
		await expect(page.locator('pre')).toContainText('"a": 1');
	});

	test('input frame (wrapper) allows vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		// 高さの責務は入力外枠（data-resize="vertical"）に一本化されている
		const inputFrame = page
			.locator('#json-input-line-numbers')
			.locator('xpath=..');
		const style = await inputFrame.evaluate((el) => {
			const computed = getComputedStyle(el);
			return {
				resize: computed.resize,
				minHeight: computed.minHeight,
				maxHeight: computed.maxHeight,
			};
		});

		expect(style.resize).toBe('vertical');
		expect(style.minHeight).toBe('240px');
		// 80dvh はビューポート高さ 900px の80% = 720px
		expect(style.maxHeight).toBe('720px');

		// textarea本体は二重の高さ責務を持たないよう、自身の縦リサイズは無効化されている
		const inputArea = page.locator('#json-input-textarea');
		const textareaResize = await inputArea.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(textareaResize).toBe('none');
	});

	test('input frame disables resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await page.setViewportSize({ width: 390, height: 844 });
		await toolPage.goto();

		const inputFrame = page
			.locator('#json-input-line-numbers')
			.locator('xpath=..');
		const resize = await inputFrame.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(resize).toBe('none');
	});

	test('input frame, gutter, and textarea heights stay in sync as line count grows', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputFrame = page
			.locator('#json-input-line-numbers')
			.locator('xpath=..');
		const gutter = page.locator('#json-input-line-numbers');
		const inputArea = page.locator('#json-input-textarea');

		// ブラウザのボーダー計算・サブピクセル丸めによる数px程度の誤差は許容する
		const HEIGHT_TOLERANCE_PX = 3;

		const initialFrameBox = await inputFrame.boundingBox();
		expect(initialFrameBox).not.toBeNull();
		const initialFrameHeight = initialFrameBox?.height ?? Number.NaN;

		for (const lineCount of [10, 30, 100]) {
			await inputArea.fill(
				Array.from({ length: lineCount }, (_, i) => `line ${i}`).join('\n'),
			);

			const frameBox = await inputFrame.boundingBox();
			const gutterBox = await gutter.boundingBox();
			const textareaBox = await inputArea.boundingBox();
			expect(frameBox).not.toBeNull();
			expect(gutterBox).not.toBeNull();
			expect(textareaBox).not.toBeNull();

			const frameHeight = frameBox?.height ?? Number.NaN;
			const gutterHeight = gutterBox?.height ?? Number.NaN;
			const textareaHeight = textareaBox?.height ?? Number.NaN;

			expect(Math.abs(frameHeight - gutterHeight)).toBeLessThanOrEqual(
				HEIGHT_TOLERANCE_PX,
			);
			expect(Math.abs(frameHeight - textareaHeight)).toBeLessThanOrEqual(
				HEIGHT_TOLERANCE_PX,
			);

			// 行数が増えても外枠は自動拡張せず、初期高さ付近を維持する（内部スクロールになる）
			expect(Math.abs(frameHeight - initialFrameHeight)).toBeLessThanOrEqual(
				HEIGHT_TOLERANCE_PX,
			);
		}
	});

	test('scrolling the textarea keeps the line-number gutter in sync', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		const inputArea = page.locator('#json-input-textarea');
		await inputArea.fill(
			Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'),
		);

		await inputArea.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect(async () => {
			const [textareaScrollTop, gutterScrollTop] = await page.evaluate(() => {
				const textarea = document.getElementById(
					'json-input-textarea',
				) as HTMLTextAreaElement;
				const gutter = document.getElementById('json-input-line-numbers');
				return [textarea?.scrollTop, gutter?.scrollTop];
			});
			expect(gutterScrollTop).toBe(textareaScrollTop);
		}).toPass();
	});

	test('output placeholder textarea allows vertical resize with min/max height on desktop', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await page.setViewportSize({ width: 1280, height: 900 });

		// 未入力状態では読み取り専用のプレースホルダーtextareaが出力欄として表示される
		const outputArea = page.getByPlaceholder('整形結果がここに表示されます...');
		const style = await outputArea.evaluate((el) => {
			const computed = getComputedStyle(el);
			return {
				resize: computed.resize,
				minHeight: computed.minHeight,
				maxHeight: computed.maxHeight,
			};
		});

		expect(style.resize).toBe('vertical');
		expect(style.minHeight).toBe('240px');
		// 80dvh はビューポート高さ 900px の80% = 720px
		expect(style.maxHeight).toBe('720px');
	});

	test('output placeholder textarea disables resize on mobile viewport', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await page.setViewportSize({ width: 390, height: 844 });
		await toolPage.goto();

		const outputArea = page.getByPlaceholder('整形結果がここに表示されます...');
		const resize = await outputArea.evaluate(
			(el) => getComputedStyle(el).resize,
		);
		expect(resize).toBe('none');
	});

	test('保存ボタンはJSONをダウンロードと表示し、空出力では無効、整形と圧縮の結果はformatted.jsonのまま保存できる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');
		await toolPage.goto();
		await installBlobTypeCapture(page);

		const downloadButton = page.getByRole('button', {
			name: 'JSONをダウンロード',
			exact: true,
		});
		await expect(downloadButton).toBeVisible();
		await expect(downloadButton).toHaveText('JSONをダウンロード');
		await expect(
			page.getByRole('button', { name: '.json', exact: true }),
		).toHaveCount(0);
		await expect(downloadButton).toBeDisabled();

		const inputArea = page.locator('#json-input-textarea');
		await inputArea.fill('   \n\t');
		await expect(downloadButton).toBeDisabled();

		await inputArea.fill('{"a":1');
		await expect(page.locator('.bg-destructive\\/10')).toBeVisible();
		await expect(downloadButton).toBeDisabled();

		await inputArea.fill('{"a":1,"b":"hello"}');
		await expect(page.locator('pre')).toContainText('"a": 1');
		await expect(page.locator('pre')).toContainText('"b": "hello"');
		await expect(downloadButton).toBeEnabled();

		const formattedDownloadPromise = page.waitForEvent('download');
		await downloadButton.click();
		const formattedDownload = await formattedDownloadPromise;
		expect(formattedDownload.suggestedFilename()).toBe('formatted.json');
		expect(await readDownloadText(formattedDownload)).toBe(FORMATTED_JSON);
		expect(await lastBlobType(page)).toBe('application/json');

		await page.getByRole('button', { name: '圧縮', exact: true }).click();
		await expect(page.locator('pre')).toContainText('{"a":1,"b":"hello"}');

		await downloadButton.focus();
		await expect(downloadButton).toBeFocused();
		const minifiedDownloadPromise = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const minifiedDownload = await minifiedDownloadPromise;
		expect(minifiedDownload.suggestedFilename()).toBe('formatted.json');
		expect(await readDownloadText(minifiedDownload)).toBe(MINIFIED_JSON);
		expect(await lastBlobType(page)).toBe('application/json');
	});

	test('保存ボタンはPCとモバイルで他のボタンと重ならず、キーボードで保存できる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('json-formatter');

		for (const viewport of [
			{ width: 1280, height: 900 },
			{ width: 390, height: 844 },
		]) {
			await page.setViewportSize(viewport);
			await toolPage.goto();
			await page.locator('#json-input-textarea').fill('{"a":1}');

			const downloadButton = page.getByRole('button', {
				name: 'JSONをダウンロード',
				exact: true,
			});
			await expect(downloadButton).toBeEnabled();

			const controlButtons = [
				page.getByRole('button', { name: '整形', exact: true }),
				page.getByRole('button', { name: '圧縮', exact: true }),
				page.getByRole('button', { name: '設定を共有', exact: true }),
			];
			await controlButtons[0].scrollIntoViewIfNeeded();
			await assertButtonsDoNotOverlap(controlButtons, viewport);

			const outputButtons = [
				page.getByRole('button', { name: 'コピー', exact: true }),
				downloadButton,
			];
			await downloadButton.scrollIntoViewIfNeeded();
			await assertButtonsDoNotOverlap(outputButtons, viewport);

			await downloadButton.focus();
			await expect(downloadButton).toBeFocused();
			const downloadPromise = page.waitForEvent('download');
			await page.keyboard.press('Enter');
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toBe('formatted.json');
			expect(await readDownloadText(download)).toBe('{\n  "a": 1\n}');
		}
	});
});

const FORMATTED_JSON = '{\n  "a": 1,\n  "b": "hello"\n}';
const MINIFIED_JSON = '{"a":1,"b":"hello"}';

async function installBlobTypeCapture(page: {
	evaluate: (pageFunction: () => void) => Promise<unknown>;
}) {
	await page.evaluate(() => {
		const target = window as Window & { __jsonDownloadBlobTypes?: string[] };
		if (target.__jsonDownloadBlobTypes) return;
		target.__jsonDownloadBlobTypes = [];
		const original = URL.createObjectURL.bind(URL);
		URL.createObjectURL = (obj: Blob | MediaSource) => {
			if (obj instanceof Blob) {
				target.__jsonDownloadBlobTypes?.push(obj.type);
			}
			return original(obj);
		};
	});
}

async function lastBlobType(page: {
	evaluate: (
		pageFunction: () => string | undefined,
	) => Promise<string | undefined>;
}) {
	return page.evaluate(() => {
		const types = (window as Window & { __jsonDownloadBlobTypes?: string[] })
			.__jsonDownloadBlobTypes;
		return types?.at(-1);
	});
}

async function readDownloadText(download: {
	saveAs: (path: string) => Promise<void>;
}) {
	const savePath = path.join(
		os.tmpdir(),
		`json-formatter-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
	);
	await download.saveAs(savePath);
	try {
		return fs.readFileSync(savePath, 'utf8');
	} finally {
		fs.unlinkSync(savePath);
	}
}

async function assertButtonsDoNotOverlap(
	buttons: Array<{
		boundingBox: () => Promise<{
			x: number;
			y: number;
			width: number;
			height: number;
		} | null>;
		scrollIntoViewIfNeeded: () => Promise<void>;
	}>,
	viewport: { width: number; height: number },
) {
	await buttons[0]?.scrollIntoViewIfNeeded();
	const boxes = [];
	for (const button of buttons) {
		const box = await button.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
		expect(box.x).toBeGreaterThanOrEqual(-1);
		expect(box.y).toBeGreaterThanOrEqual(-1);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
		boxes.push(box);
	}

	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i];
			const b = boxes[j];
			const overlapX =
				Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
			const overlapY =
				Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
			expect(overlapX > 1 && overlapY > 1).toBe(false);
		}
	}
}
