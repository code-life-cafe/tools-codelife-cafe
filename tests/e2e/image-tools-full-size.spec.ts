// image-mosaic / image-text のフルサイズ設定（isExpanded）が、
// SQLフォーマッターと同一パターン（useToolSettings）を通じて
// 「共有URLパラメーター → localStorage → 既定値」の優先順位・
// ツール間の設定キー非衝突・不正値への耐性を満たすことを検証する。
//
// 判断事項: 本PRでは「共有URLからの復元」のみを対象とし、SQLフォーマッターの
// ような「設定を共有」ボタン（共有URL生成UI）は追加していない。isExpanded は
// ツールごとに1つのbool値のみで、ユーザーが意図的に共有する価値のある設定
// （SQLフォーマッターの方言・インデント等）と性質が異なるため、既存パターンの
// 「状態永続化の仕組み」だけを再利用し、UI追加はスコープ外と判断した。
import path from 'node:path';
import { expect, test } from './fixtures/base';

const FIXTURE = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'sample-400x300.png',
);

type ToolId = 'image-mosaic' | 'image-text';

const TOOLS: { id: ToolId; storageKey: string; canvasTestId: string }[] = [
	{
		id: 'image-mosaic',
		storageKey: 'tool_settings_image-mosaic',
		canvasTestId: 'editor-canvas',
	},
	{
		id: 'image-text',
		storageKey: 'tool_settings_image-text',
		canvasTestId: 'text-canvas',
	},
];

function encodeSettings(settings: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(settings)).toString('base64');
}

for (const tool of TOOLS) {
	test.describe(`${tool.id}: フルサイズ設定の優先順位`, () => {
		test('共有URLパラメーターでフルサイズ状態が復元され、ページ幅とズームビューポートの高さが同期する', async ({
			page,
		}) => {
			const settings = encodeSettings({ isExpanded: true });
			await page.goto(`/${tool.id}?settings=${settings}`);
			await expect(
				page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
			).toBeVisible({ timeout: 10000 });

			await expect(page.locator('#tool-layout-container')).toHaveClass(
				/max-w-full/,
			);

			// フルサイズ／標準幅トグルとズームビューポートは画像読み込み後（編集フェーズ）
			// にのみ表示されるため、画像を読み込んでから両方の同期を確認する
			await page.locator('input[type="file"]').setInputFiles(FIXTURE);
			await expect(page.getByTestId(tool.canvasTestId)).toBeVisible();
			await expect(page.getByRole('button', { name: '標準幅' })).toBeVisible();
			await expect(page.getByTestId('zoom-scroll-container')).toHaveClass(
				/h-\[70dvh\]/,
			);
		});

		test('不正なsettingsパラメーターでもページは壊れず既定値で表示される', async ({
			page,
		}) => {
			await page.goto(`/${tool.id}?settings=___not-valid-base64___`);
			await expect(
				page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
			).toBeVisible({ timeout: 10000 });

			// 復元に失敗した場合は既定値（標準幅）にフォールバックする
			await expect(page.locator('#tool-layout-container')).toHaveClass(
				/max-w-\[800px\]/,
			);
			await page.locator('input[type="file"]').setInputFiles(FIXTURE);
			await expect(page.getByTestId(tool.canvasTestId)).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'フルサイズ' }),
			).toBeVisible();
		});

		test('localStorageに保存された前回設定が復元される', async ({ page }) => {
			await page.goto(`/${tool.id}`);
			await page.evaluate(
				({ key }) => {
					localStorage.setItem(key, JSON.stringify({ isExpanded: true }));
				},
				{ key: tool.storageKey },
			);
			await page.reload();
			await expect(
				page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
			).toBeVisible({ timeout: 10000 });

			await expect(page.locator('#tool-layout-container')).toHaveClass(
				/max-w-full/,
			);
		});

		test('共有URLパラメーターはlocalStorageより優先される', async ({
			page,
		}) => {
			await page.goto(`/${tool.id}`);
			await page.evaluate(
				({ key }) => {
					localStorage.setItem(key, JSON.stringify({ isExpanded: false }));
				},
				{ key: tool.storageKey },
			);

			const settings = encodeSettings({ isExpanded: true });
			await page.goto(`/${tool.id}?settings=${settings}`);
			await expect(
				page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
			).toBeVisible({ timeout: 10000 });

			await expect(page.locator('#tool-layout-container')).toHaveClass(
				/max-w-full/,
			);
		});
	});
}

test.describe('image-mosaic / image-text の設定キーは衝突しない', () => {
	test('image-mosaicのフルサイズ設定がimage-textに漏れない', async ({
		page,
	}) => {
		await page.goto('/image-mosaic');
		await expect(
			page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
		).toBeVisible({ timeout: 10000 });
		await page.locator('input[type="file"]').setInputFiles(FIXTURE);
		await expect(page.getByTestId('editor-canvas')).toBeVisible();
		await page.getByRole('button', { name: 'フルサイズ' }).click();
		await expect(page.locator('#tool-layout-container')).toHaveClass(
			/max-w-full/,
		);

		await page.goto('/image-text');
		await expect(
			page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
		).toBeVisible({ timeout: 10000 });
		// image-mosaic 側で有効化したフルサイズ設定が image-text 側に漏れていないこと
		await expect(page.locator('#tool-layout-container')).toHaveClass(
			/max-w-\[800px\]/,
		);
	});
});
