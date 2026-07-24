import { expect, test } from './fixtures/base';

test.describe('Character Counter', () => {
	test('loads page and shows character count UI', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		// Verify the character count UI elements are present
		await expect(page.getByText('文字数（空白含む）')).toBeVisible();
		await expect(page.getByText('バイト数（UTF-8）')).toBeVisible();
		await expect(page.getByRole('textbox').first()).toBeVisible();
	});

	test('should count characters and bytes in real-time', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		// Input "テスト" (3 characters, UTF-8 9 bytes)
		const textbox = page.getByRole('textbox').first();
		await textbox.fill('テスト');

		// Verify stats are calculated correctly
		const charCountCard = page.locator('.rounded-xl', {
			hasText: '文字数（空白含む）',
		});
		await expect(charCountCard.locator('.text-2xl')).toHaveText('3');

		const byteCountCard = page.locator('.rounded-xl', {
			hasText: 'バイト数（UTF-8）',
		});
		await expect(byteCountCard.locator('.text-2xl')).toHaveText('9');
	});

	test('shows primary SNS limits by default and reflects input in the progress bar', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		await expect(page.getByRole('tab', { name: 'SNS' })).toHaveAttribute(
			'aria-selected',
			'true',
		);

		const xBar = page.getByRole('progressbar', { name: 'X' });
		const blueskyBar = page.getByRole('progressbar', { name: 'Bluesky' });
		const threadsBar = page.getByRole('progressbar', { name: 'Threads' });
		await expect(xBar).toBeVisible();
		await expect(blueskyBar).toBeVisible();
		await expect(threadsBar).toBeVisible();

		// Instagram・LinkedInは「その他のSNS」の折りたたみ内にあり、初期状態では非表示
		await expect(
			page.getByRole('progressbar', { name: 'Instagram' }),
		).toBeHidden();

		const textbox = page.getByRole('textbox').first();
		await textbox.fill('あ'.repeat(10));
		await expect(xBar).toHaveAttribute('aria-valuenow', '10');
	});

	test('expands "その他のSNS" to reveal Instagram and LinkedIn', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		await page.getByRole('button', { name: /その他のSNS/ }).click();
		await expect(
			page.getByRole('progressbar', { name: 'Instagram' }),
		).toBeVisible();
		await expect(
			page.getByRole('progressbar', { name: 'LinkedIn' }),
		).toBeVisible();
	});

	test('switches to the SEO tab and shows title/meta description limits', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'SEO' }).click();
		await expect(
			page.getByRole('progressbar', { name: 'title' }),
		).toBeVisible();
		await expect(
			page.getByRole('progressbar', { name: 'meta description' }),
		).toBeVisible();
	});

	test('shows an over-limit message once the X limit (280 chars) is exceeded', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('char-count');
		await toolPage.goto();

		const textbox = page.getByRole('textbox').first();
		await textbox.fill('あ'.repeat(281));

		const xBar = page.getByRole('progressbar', { name: 'X' });
		await expect(xBar).toHaveAttribute('aria-valuenow', '280');
		await expect(page.getByText('1文字オーバー')).toBeVisible();
	});
});
