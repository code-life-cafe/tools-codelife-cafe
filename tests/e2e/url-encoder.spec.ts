import { expect, test } from './fixtures/base';

test.describe('URL Encoder Tool', () => {
	for (const width of [375, 768, 1280]) {
		test(`keeps modes within the viewport at ${width}px`, async ({
			page,
			createToolPage,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await createToolPage('url-encoder').goto();
			const assertLayout = async (stage: string) => {
				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					scrollWidth: document.documentElement.scrollWidth,
					tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => {
						const { left, right, top } = tab.getBoundingClientRect();
						return {
							left,
							right,
							top,
							scrollWidth: tab.scrollWidth,
							clientWidth: tab.clientWidth,
						};
					}),
				}));
				await testInfo.attach(stage, {
					body: JSON.stringify(layout),
					contentType: 'application/json',
				});
				expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
				for (const tab of layout.tabs) {
					expect(tab.left).toBeGreaterThanOrEqual(0);
					expect(tab.right).toBeLessThanOrEqual(layout.viewport);
					expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth + 1);
				}
				expect(layout.tabs).toHaveLength(2);
				expect(layout.tabs[0].top).toBe(layout.tabs[1].top);
				expect(layout.tabs[0].right).toBeLessThanOrEqual(layout.tabs[1].left);
				await expect(page.getByRole('tablist')).toHaveAttribute(
					'aria-orientation',
					'horizontal',
				);
			};
			await assertLayout('empty');
			await page.reload();
			await expect(
				page.locator('astro-island[ssr][client="load"]'),
			).toHaveCount(0);
			await assertLayout('reloaded');
			const input = page.getByRole('textbox').first();
			const output = page.getByRole('textbox').nth(1);
			await page.getByRole('switch').click();
			await input.fill('https://example.com/東京?q=天気');
			await expect(output).toHaveValue(
				'https%3A%2F%2Fexample.com%2F%E6%9D%B1%E4%BA%AC%3Fq%3D%E5%A4%A9%E6%B0%97',
			);
			const componentTab = page.getByRole('tab', {
				name: 'コンポーネント (encodeURIComponent)',
			});
			const fullTab = page.getByRole('tab', { name: 'フルURL (encodeURI)' });
			await componentTab.focus();
			await componentTab.press('ArrowRight');
			await expect(fullTab).toBeFocused();
			await expect(fullTab).toHaveAttribute('aria-selected', 'true');
			await expect(output).toHaveValue(
				'https://example.com/%E6%9D%B1%E4%BA%AC?q=%E5%A4%A9%E6%B0%97',
			);
			await assertLayout('full-url');
			await fullTab.press('ArrowLeft');
			await expect(componentTab).toBeFocused();
			await expect(componentTab).toHaveAttribute('aria-selected', 'true');
			await expect(output).toHaveValue(
				'https%3A%2F%2Fexample.com%2F%E6%9D%B1%E4%BA%AC%3Fq%3D%E5%A4%A9%E6%B0%97',
			);
			await assertLayout('component');
			await testInfo.attach('layout', {
				body: await page.screenshot(),
				contentType: 'image/png',
			});
		});
	}
	test('should load the page correctly', async ({ createToolPage }) => {
		const toolPage = createToolPage('url-encoder');
		await toolPage.goto();
		await toolPage.expectTitle('URLエンコード / デコード | CODE:LIFE Tools');
		await toolPage.expectSafetyBadge();
	});

	test('should encode and decode values correctly', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('url-encoder');
		await toolPage.goto();

		// textareas: first is input, second is output
		const inputArea = page.getByRole('textbox').first();
		const outputArea = page.getByRole('textbox').nth(1);

		// 1. test component mode decoding (default)
		await inputArea.fill(
			'https%3A%2F%2Fexample.com%2F%E6%A4%9C%E7%B4%A2%3Fq%3D%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
		);
		await expect(outputArea).toHaveValue(
			'https://example.com/検索?q=東京 天気',
		);

		// test space handled via '+'
		await inputArea.fill('%E6%9D%B1%E4%BA%AC+%E5%A4%A9%E6%B0%97');
		await expect(outputArea).toHaveValue('東京 天気');

		// 2. switch direction to encode
		await page.getByRole('switch').click();

		// test component mode encoding
		await inputArea.fill('https://example.com/検索?q=東京 天気');
		await expect(outputArea).toHaveValue(
			'https%3A%2F%2Fexample.com%2F%E6%A4%9C%E7%B4%A2%3Fq%3D%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
		);

		// test full url mode encoding
		await page.getByRole('tab', { name: 'フルURL (encodeURI)' }).press('Enter');
		await expect(outputArea).toHaveValue(
			'https://example.com/%E6%A4%9C%E7%B4%A2?q=%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
		);
	});

	test('入力・結果・方向切替を日本語名で識別でき、ラベルとキーボードで操作できる', async ({
		page,
		createToolPage,
	}) => {
		const directionName = '変換方向（オンでデコード、オフでエンコード）';
		const toolPage = createToolPage('url-encoder');

		for (const viewport of [
			{ width: 1280, height: 900 },
			{ width: 390, height: 844 },
		]) {
			await page.setViewportSize(viewport);
			await toolPage.goto();

			const input = page.getByRole('textbox', { name: '入力 (デコード前)' });
			const output = page.getByRole('textbox', { name: '変換結果' });
			const direction = page.getByRole('switch', { name: directionName });
			await expect(input).toBeVisible();
			await expect(output).toBeVisible();
			await expect(direction).toBeVisible();
			await expect(direction).toBeChecked();
			await expect(
				page.getByRole('textbox', {
					name: 'https://example.com/%E6%A4%9C%E7%B4%A2?q=%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97',
				}),
			).toHaveCount(0);

			await page.getByText('入力 (デコード前)', { exact: true }).click();
			await expect(input).toBeFocused();

			await direction.focus();
			await expect(direction).toBeFocused();
			await page.keyboard.press('Space');
			await expect(direction).not.toBeChecked();
			const encodeInput = page.getByRole('textbox', {
				name: '入力 (エンコード前)',
			});
			await expect(encodeInput).toBeVisible();

			await page.getByText('入力 (エンコード前)', { exact: true }).click();
			await expect(encodeInput).toBeFocused();
			await encodeInput.fill('a b');
			await expect(output).toHaveValue('a%20b');

			const swap = page
				.getByRole('button', { name: '入力と出力を入れ替える' })
				.or(page.getByRole('button', { name: '入れ替え', exact: true }));
			await swap.click();
			await expect(direction).toBeChecked();
			await expect(
				page.getByRole('textbox', { name: '入力 (デコード前)' }),
			).toHaveValue('a%20b');
			await expect(output).toHaveValue('a b');

			await page.getByRole('button', { name: 'クリア' }).click();
			await expect(
				page.getByRole('textbox', { name: '入力 (デコード前)' }),
			).toHaveValue('');
			await expect(output).toHaveValue('');

			await page.getByRole('textbox', { name: '入力 (デコード前)' }).fill('%');
			await expect(output).toHaveValue(
				'不正なURLエスケープ形式です。デコードできません。',
			);
			await page.getByRole('tab', { name: 'フルURL (encodeURI)' }).click();
			await expect(output).toHaveValue(
				'不正なURLエスケープ形式です。デコードできません。',
			);
			await page
				.getByRole('tab', { name: 'コンポーネント (encodeURIComponent)' })
				.click();

			await direction.focus();
			await page.keyboard.press('Enter');
			await expect(direction).not.toBeChecked();

			const controls = [
				page.getByRole('tab', { name: 'コンポーネント (encodeURIComponent)' }),
				page.getByRole('tab', { name: 'フルURL (encodeURI)' }),
				direction,
				page.getByRole('textbox', { name: '入力 (エンコード前)' }),
				output,
				page.getByRole('button', { name: 'コピー' }),
				page.getByRole('button', { name: 'クリア' }),
			];
			await assertControlsWithinViewport(controls, viewport);
		}
	});
});

async function assertControlsWithinViewport(
	controls: Array<{
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
	const boxes = [];
	for (const control of controls) {
		const box = await control.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
		boxes.push({ control, box });
	}
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i].box;
			const b = boxes[j].box;
			const overlapX =
				Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
			const overlapY =
				Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
			expect(overlapX > 1 && overlapY > 1).toBe(false);
		}
	}
	for (const { control, box } of boxes) {
		const inView = box.y >= -1 && box.y + box.height <= viewport.height + 1;
		if (!inView) await control.scrollIntoViewIfNeeded();
		const measured = inView ? box : await control.boundingBox();
		expect(measured).not.toBeNull();
		if (!measured) continue;
		expect(measured.x).toBeGreaterThanOrEqual(-1);
		expect(measured.x + measured.width).toBeLessThanOrEqual(viewport.width + 1);
	}
}
