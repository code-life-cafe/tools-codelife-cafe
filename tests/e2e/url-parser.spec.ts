import { expect, test } from './fixtures/base';

test.describe('URLパラメータ解析・編集ツール', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('url-parser');
		await toolPage.goto();
		await toolPage.expectTitle('URLパラメータ解析・編集');
		await toolPage.expectSafetyBadge();
	});

	test('URLを分解し、パラメータを編集して再生成できること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('url-parser');
		await toolPage.goto();

		await page
			.getByLabel('URL', { exact: true })
			.fill(
				'https://example.com/a/b?q=%E6%9D%B1%E4%BA%AC+%E5%A4%A9%E6%B0%97&x=1%2B1#top',
			);

		const parts = page.getByTestId('url-parser-parts');
		await expect(parts).toContainText('https:');
		await expect(parts).toContainText('example.com');
		await expect(parts).toContainText('/a/b');
		await expect(parts).toContainText('#top');

		await expect(page.getByLabel('キー 1')).toHaveValue('q');
		await expect(page.getByLabel('値 1')).toHaveValue('東京 天気');
		await expect(page.getByLabel('値 2')).toHaveValue('1+1');

		await page.getByLabel('値 1').fill('大阪');
		await page.getByRole('button', { name: 'パラメータ 2 を削除' }).click();
		await page.getByRole('button', { name: 'パラメータを追加' }).click();
		await page.getByLabel('キー 2').fill('lang');
		await page.getByLabel('値 2').fill('ja');

		await expect(
			page.getByRole('textbox', { name: '生成されたURL', exact: true }),
		).toHaveValue('https://example.com/a/b?q=%E5%A4%A7%E9%98%AA&lang=ja#top');
		await expect(
			page.getByRole('button', { name: 'URLをコピー' }),
		).toBeEnabled();
	});

	test('不正なURL・不正なパーセントエンコードでエラーまたは警告が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('url-parser');
		await toolPage.goto();
		const input = page.getByLabel('URL', { exact: true });

		await input.fill('example.com/path');
		await expect(page.getByRole('alert')).toContainText(
			'URLとして解析できません',
		);

		await input.fill('ftp://example.com/');
		await expect(page.getByRole('alert')).toContainText('対象外');

		await input.fill('https://example.com/?a=%zz');
		await expect(page.getByTestId('url-parser-warnings')).toContainText(
			'原文のまま保持',
		);
		await expect(page.getByLabel('値 1')).toHaveValue('%zz');
		await expect(
			page.getByRole('textbox', { name: '生成されたURL', exact: true }),
		).toHaveValue('https://example.com/?a=%zz');
	});

	test('HTML風の値が文字列として表示され、入力が保存されないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('url-parser');
		await toolPage.goto();
		await page
			.getByLabel('URL', { exact: true })
			.fill(
				'https://example.com/?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E#<b>h</b>',
			);
		await expect(page.getByLabel('値 1')).toHaveValue(
			'<img src=x onerror=alert(1)>',
		);
		await expect(page.locator('img[src="x"]')).toHaveCount(0);

		const stored = await page.evaluate(
			() =>
				JSON.stringify({ ...localStorage }) +
				JSON.stringify({ ...sessionStorage }),
		);
		expect(stored).not.toContain('example.com');
	});

	test('キーボードで入力と操作ができること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('url-parser');
		await toolPage.goto();
		await page
			.getByLabel('URL', { exact: true })
			.fill('https://example.com/?a=1');
		await page.getByRole('button', { name: 'パラメータを追加' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByLabel('キー 2')).toBeVisible();
	});

	test('空キー・空値と先頭BOMを再生成時にも保持すること', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('url-parser').goto();
		await page
			.getByLabel('URL', { exact: true })
			.fill('https://example.com/?=&a=1&=&q=%EF%BB%BFabc#top');
		await expect(
			page.getByRole('textbox', { name: '生成されたURL', exact: true }),
		).toHaveValue('https://example.com/?=&a=1&=&q=%EF%BB%BFabc#top');
		await expect(page.getByLabel('値 4', { exact: true })).toHaveValue(
			'\uFEFFabc',
		);
	});
});

for (const slug of ['url-parser', 'random-sort', 'log-time-analyzer']) {
	test(`${slug}: 旧URLでも操作画面を表示する`, async ({
		page,
		createToolPage,
	}) => {
		await createToolPage(`tools/${slug}`).goto();
		const label =
			slug === 'url-parser'
				? 'URL'
				: slug === 'random-sort'
					? '項目（1行に1項目）'
					: 'ログ（最大10,000行・1MiB）';
		await expect(page.getByLabel(label, { exact: true })).toBeVisible();
	});

	test(`${slug}: 通信遮断なしでも入力を通信・ログ・保存へ含めない`, async ({
		browser,
		baseURL,
	}) => {
		// fixtureのpageを使わず、広告等を含む通信の遮断も行わない。
		const context = await browser.newContext({
			baseURL,
			serviceWorkers: 'allow',
		});
		const marker = `PRIVATE_INPUT_PROBE_${slug.replaceAll('-', '_')}`;
		const requests: string[] = [];
		const messages: string[] = [];
		context.on('request', (request) =>
			requests.push(`${request.url()} ${request.postData() ?? ''}`),
		);
		try {
			const page = await context.newPage();
			page.on('console', (message) => messages.push(message.text()));
			await page.goto(`/${slug}`);
			await expect(
				page.locator('astro-island[ssr][client="load"]'),
			).toHaveCount(0);
			if (slug === 'url-parser') {
				await page
					.getByLabel('URL', { exact: true })
					.fill(`https://tools-input-probe.invalid/?q=${marker}`);
				await expect(
					page.getByRole('textbox', { name: '生成されたURL', exact: true }),
				).toHaveValue(`https://tools-input-probe.invalid/?q=${marker}`);
				await expect(page.getByLabel('値 1', { exact: true })).toHaveValue(
					marker,
				);
			} else if (slug === 'random-sort') {
				await page.getByLabel('項目（1行に1項目）').fill(`${marker}\n別の項目`);
				await page
					.getByRole('button', { name: '並べ替える', exact: true })
					.click();
				await expect(page.getByTestId('random-sort-result')).toContainText(
					marker,
				);
			} else {
				await page
					.getByLabel('ログ（最大10,000行・1MiB）', { exact: true })
					.fill(`2026-10-06T00:00:00Z ${marker}\n2026-10-06T00:00:01Z 次の行`);
				await expect(page.getByTestId('log-time-top')).toContainText('1000');
			}
			// 既存計測のデバウンス時間を越えて通信とconsoleを観測する。
			await page.waitForTimeout(750);
			await page.waitForLoadState('networkidle');
			const stored = await page.evaluate(() =>
				JSON.stringify({
					local: { ...localStorage },
					session: { ...sessionStorage },
				}),
			);
			expect(requests.join('\n')).not.toContain(marker);
			expect(requests.join('\n')).not.toContain('tools-input-probe.invalid');
			expect(messages.join('\n')).not.toContain(marker);
			expect(stored).not.toContain(marker);
		} finally {
			await context.close();
		}
	});
}
