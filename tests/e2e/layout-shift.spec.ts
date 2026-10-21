import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base';

declare global {
	interface Window {
		layoutShiftValues: number[];
	}
}

async function observeLayoutShifts(page: Page) {
	await page.addInitScript(() => {
		const shifts: number[] = [];
		Object.assign(window, { layoutShiftValues: shifts });
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const shift = entry as PerformanceEntry & {
					value: number;
					hadRecentInput: boolean;
				};
				if (!shift.hadRecentInput) shifts.push(shift.value);
			}
		}).observe({ type: 'layout-shift', buffered: true });
	});
}

async function expectStableLayout(page: Page) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(
			Array.from(document.images, (img) => img.decode().catch(() => {})),
		);
	});
	// 描画完了後のフレームと300msの幅アニメーションを観測する。
	await page.waitForTimeout(750);
	const cls = await page.evaluate(() =>
		window.layoutShiftValues.reduce((sum, value) => sum + value, 0),
	);
	console.log(`CLS ${new URL(page.url()).pathname}: ${cls}`);
	expect(cls).toBeLessThanOrEqual(0.1);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

test('Mermaidのデスクトップ初期表示でCLSが0.1以下', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await observeLayoutShifts(page);
	await page.goto('/mermaid/');
	await expect(page.getByRole('button', { name: 'SVG保存' })).toBeEnabled();
	await expectStableLayout(page);
});

for (const { width, height } of [
	{ width: 375, height: 900 },
	{ width: 393, height: 851 },
	{ width: 1440, height: 900 },
]) {
	test(`upscaleの画像選択から結果表示までCLSが0.1以下 (${width}px)`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		await page.setViewportSize({ width, height });
		await observeLayoutShifts(page);
		await page.goto('/upscale/');
		const png = await page.evaluate(() => {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 64;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas unavailable');
			ctx.fillStyle = '#3060ff';
			ctx.fillRect(0, 0, 64, 64);
			return canvas.toDataURL('image/png').split(',')[1];
		});
		const frame = page.getByTestId('upscale-preview-frame');
		const preview = page.getByTestId('upscale-result');
		const run = page.getByTestId('upscale-run');
		await expect(run).toBeDisabled();
		await expect(
			page.getByRole('button', { name: '高速（全端末）' }),
		).toBeDisabled();
		await page.evaluate(() => document.fonts.ready);
		const emptyFrame = await frame.boundingBox();
		const emptyPreview = await preview.boundingBox();
		await page.getByTestId('upscale-file-input').setInputFiles({
			name: 'tiny.png',
			mimeType: 'image/png',
			buffer: Buffer.from(png, 'base64'),
		});
		await expect(preview.getByAltText('処理前の元画像')).toBeVisible();
		await expect(preview).toContainText('処理前プレビュー');
		const before = await frame.boundingBox();
		expect(before).not.toBeNull();
		expect(before).toEqual(emptyFrame);
		const selectedPreview = await preview.boundingBox();
		expect(selectedPreview).toEqual(emptyPreview);
		await expect(run).toBeEnabled();
		expect(before?.height).toBeLessThanOrEqual(320);
		// ファイル選択時のシフトも計測し、実行クリックの直近入力扱いに隠さない。
		await page.waitForTimeout(1500);
		await page.getByTestId('upscale-run').click();
		await expect(page.getByTestId('upscale-download')).toBeVisible({
			timeout: 120_000,
		});
		await expect(preview.getByAltText('アップスケール結果')).toBeVisible();
		const result = preview.locator('img').first();
		await expect
			.poll(() => result.evaluate((img: HTMLImageElement) => img.naturalWidth))
			.toBe(256);
		const after = await frame.boundingBox();
		expect(after?.width).toBe(before?.width);
		expect(after?.height).toBe(before?.height);
		const completedPreview = await preview.boundingBox();
		expect(completedPreview?.width).toBe(selectedPreview?.width);
		expect(completedPreview?.height).toBe(selectedPreview?.height);
		await expectStableLayout(page);

		// クリア後も同じ領域を保ち、再選択できる。
		await page.getByRole('button', { name: '別の画像', exact: true }).click();
		await expect(run).toBeDisabled();
		await expect(page.getByTestId('upscale-file-input')).toBeAttached();
		const clearedFrame = await frame.boundingBox();
		const clearedPreview = await preview.boundingBox();
		expect(clearedFrame?.width).toBe(emptyFrame?.width);
		expect(clearedFrame?.height).toBe(emptyFrame?.height);
		expect(clearedPreview?.width).toBe(emptyPreview?.width);
		expect(clearedPreview?.height).toBe(emptyPreview?.height);
	});
}

for (const width of [375, 1440]) {
	test(`Mermaidの保存幅・URL優先・幅切替を維持する (${width}px)`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.addInitScript(() => {
			localStorage.setItem(
				'tool_settings_mermaid',
				JSON.stringify({ isExpanded: false }),
			);
		});
		await observeLayoutShifts(page);
		await page.goto('/mermaid/');
		const container = page.locator('#tool-layout-container');
		await expect(container).toHaveClass(/max-w-\[800px\]/);
		await expect(page.getByRole('button', { name: 'SVG保存' })).toBeEnabled();
		await expectStableLayout(page);

		// URL設定は保存設定より優先される。
		const settings = Buffer.from(JSON.stringify({ isExpanded: true })).toString(
			'base64',
		);
		await page.goto(`/mermaid/?settings=${encodeURIComponent(settings)}`);
		await expect(container).toHaveClass(/max-w-full/);
		await expectStableLayout(page);
		await page.getByRole('button', { name: '標準幅', exact: true }).click();
		await expect(container).toHaveClass(/max-w-\[800px\]/);
		await expect(container).toHaveClass(/transition-all/);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						JSON.parse(localStorage.getItem('tool_settings_mermaid') || '{}')
							.isExpanded,
				),
			)
			.toBe(false);
		await page.getByRole('button', { name: 'フルサイズ', exact: true }).click();
		await expect(container).toHaveClass(/max-w-full/);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						JSON.parse(localStorage.getItem('tool_settings_mermaid') || '{}')
							.isExpanded,
				),
			)
			.toBe(true);
	});
}
