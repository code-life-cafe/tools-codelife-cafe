import { expect, test } from './fixtures/base';

test.describe('Cipher Tool', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/cipher');
	});

	test('Page loads correctly and defaults to Caesar cipher', async ({
		page,
	}) => {
		await expect(page).toHaveTitle(/暗号化・難読化ツール/);

		// SafetyBadge component check (usually has text like 完全クライアントサイド処理)
		await expect(page.locator('text=完全クライアントサイド処理')).toBeVisible();

		// Default tab check
		const caesarTabBtn = page.getByRole('tab', { name: 'シーザー暗号' });
		await expect(caesarTabBtn).toHaveAttribute('aria-selected', 'true');
	});

	test('Tab switching resets state and changes UI', async ({ page }) => {
		const inputArea = page.getByPlaceholder(
			/「こんにちは」や「Hello World」を入力.../,
		);
		await inputArea.fill('test');

		// Switch to ROT13
		await page.getByRole('tab', { name: 'ROT13' }).click();

		// Verify different placeholder and empty input
		const rot13InputArea = page.getByPlaceholder(/「Hello World」を入力.../);
		await expect(rot13InputArea).toBeVisible();
		await expect(rot13InputArea).toHaveValue('');

		// Shift slider should not be visible
		await expect(page.getByText('シフト数:')).not.toBeVisible();
	});

	test('Caesar cipher transformations', async ({ page }) => {
		const inputArea = page.getByPlaceholder(
			/「こんにちは」や「Hello World」を入力.../,
		);

		// Basic ASCII
		await inputArea.fill('abc');
		const outputArea = page.getByPlaceholder('変換結果がここに表示されます');
		await expect(outputArea).toHaveValue('def'); // Default shift is 3

		// Japanese inputs
		await inputArea.fill('あいう');
		// Set shift to 1 (need to interact with slider or input)
		// There are visually two parts but the number input is easier to target
		const shiftInput = page.getByLabel('シフト数:');
		await shiftInput.fill('1');
		await shiftInput.press('Enter');

		await expect(outputArea).toHaveValue('いうえ');

		// Check max shift attribute dynamically changed to 45
		await expect(shiftInput).toHaveAttribute('max', '45');
	});

	test('Direction toggle updates output for Caesar', async ({ page }) => {
		const inputArea = page.getByPlaceholder(
			/「こんにちは」や「Hello World」を入力.../,
		);
		await inputArea.fill('def');

		// Encode 'def' with shift 3 gives 'ghi', but let's change direction
		await page.getByRole('button', { name: 'デコード（復号）' }).click();

		const outputArea = page.getByPlaceholder('変換結果がここに表示されます');
		await expect(outputArea).toHaveValue('abc');
	});

	test('ROT13 transformation', async ({ page }) => {
		await page.getByRole('tab', { name: 'ROT13' }).click();

		const inputArea = page.getByPlaceholder(/「Hello World」を入力.../);
		await inputArea.fill('Hello');

		const outputArea = page.getByPlaceholder('変換結果がここに表示されます');
		await expect(outputArea).toHaveValue('Uryyb');

		// Self-inverse check
		await inputArea.fill('Uryyb');
		await expect(outputArea).toHaveValue('Hello');
	});

	test('String reversal transformation', async ({ page }) => {
		await page.getByRole('tab', { name: '文字列反転' }).click();

		const inputArea =
			page.getByPlaceholder(/「テキストを反転します」を入力.../);
		await inputArea.fill('Hello🎉'); // includes surrogate pair / emoji

		const outputArea = page.getByPlaceholder('変換結果がここに表示されます');
		await expect(outputArea).toHaveValue('🎉olleH');
	});

	test('Morse code encode and decode', async ({ page }) => {
		await page.getByRole('tab', { name: 'モールス信号' }).click();

		const inputArea = page.getByPlaceholder(/「SOS」や「Hello」を入力.../);

		// Encode
		await inputArea.fill('SOS');
		const outputArea = page.getByPlaceholder('変換結果がここに表示されます');
		await expect(outputArea).toHaveValue('... --- ...');

		await inputArea.fill('Hello World');
		await expect(outputArea).toHaveValue(
			'.... . .-.. .-.. --- / .-- --- .-. .-.. -..',
		);

		// Decode
		await page.getByRole('button', { name: 'デコード（復号）' }).click();
		await inputArea.fill('... --- ...');
		await expect(outputArea).toHaveValue('SOS');
	});

	test('Brute force panel functionality', async ({ page }) => {
		await page.getByRole('tab', { name: 'シーザー暗号' }).click();
		const inputArea = page.getByPlaceholder(
			/「こんにちは」や「Hello World」を入力.../,
		);
		await inputArea.fill('abc');

		// Open brute force
		await page
			.getByRole('button', { name: 'Toggle brute force panel' })
			.click();

		// The panel should show 25 items for ASCII
		await expect(
			page
				.locator('button')
				.filter({ hasText: 'シフト 1:' })
				.filter({ hasText: 'bcd' }),
		).toBeVisible();
		await expect(
			page
				.locator('button')
				.filter({ hasText: 'シフト 25:' })
				.filter({ hasText: 'zab' }),
		).toBeVisible();

		// Click a pattern to set shift
		await page
			.locator('button')
			.filter({ hasText: 'シフト 5:' })
			.filter({ hasText: 'fgh' })
			.click();

		// The shift slider input should now be 5
		const shiftInput = page.getByLabel('シフト数:');
		await expect(shiftInput).toHaveValue('5');
	});

	test('Common UI elements (copy, clear, text info)', async ({ page }) => {
		const inputArea = page.getByPlaceholder(
			/「こんにちは」や「Hello World」を入力.../,
		);
		await inputArea.fill('test');

		// Character count
		await expect(page.getByText('4 文字')).toBeVisible();

		// Clear button
		await page.getByRole('button', { name: 'クリア' }).click();
		await expect(inputArea).toHaveValue('');
		await expect(page.getByText('0 文字')).toBeVisible();

		// Algorithm Info
		await page.getByRole('button', { name: 'Toggle info' }).click();
		await expect(page.getByText('ジュリアス・シーザー')).toBeVisible();
	});

	test('Responsive display', async ({ page }) => {
		// 375px mobile
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByRole('tablist')).toBeVisible();

		// It stacks grid-cols-1 automatically using Tailwind, difficult to test layout intrinsically via locator
		// but we can ensure elements are still visible.
		const inputArea = page.getByPlaceholder(
			/「こんにちは」や「Hello World」を入力.../,
		);
		await expect(inputArea).toBeVisible();

		// 1440px desktop
		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(inputArea).toBeVisible();
	});
});
