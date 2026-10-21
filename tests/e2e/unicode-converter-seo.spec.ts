import { expect, test } from './fixtures/base';

test.describe('ユニコード変換 SEO', () => {
	test('title・meta description・H1が最新のfrontmatterと一致すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unicode-converter');
		await toolPage.goto();

		await expect(page).toHaveTitle(
			'ユニコード変換｜\\uXXXXエスケープを日本語にデコード・相互変換 | CODE:LIFE Tools',
		);

		const description = await page
			.locator('meta[name="description"]')
			.getAttribute('content');
		expect(description).toBe(
			'JSONやログの \\u65e5\\u672c のような\\uXXXXエスケープを日本語に即戻せます。日本語から\\uXXXXへの変換、絵文字・サロゲートペアの相互変換にも対応。ブラウザ内処理で外部送信はありません。',
		);
		const length = description?.length ?? 0;
		expect(length).toBeGreaterThanOrEqual(100);
		expect(length).toBeLessThanOrEqual(120);

		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'ユニコード変換',
		);
	});

	test('追加したFAQがページとFAQPage JSON-LDの両方に出力されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('unicode-converter');
		await toolPage.goto();

		const newFaqs = [
			{
				question:
					'JSONやAPIレスポンスに含まれる \\uXXXX エスケープ文字列を元の日本語に戻すには？',
				answerFragment: 'デコード」モードに切り替え',
			},
			{
				question:
					'\\u{1F600}のような中括弧付きのコードポイント表記（\\u{XXXXX}）もデコードできますか？',
				answerFragment: '\\u{XXXXX}形式のデコードにも対応',
			},
			{
				question: 'HTML数値文字参照（&#x65e5; や &#26085; など）との違いは？',
				answerFragment: '本ツールでは変換できません',
			},
		];

		for (const { question } of newFaqs) {
			await expect(page.getByText(question)).toBeVisible();
		}

		const jsonLdRaw = await page
			.locator('script[type="application/ld+json"]')
			.innerHTML();
		const jsonLd = JSON.parse(jsonLdRaw);
		const faqPage = jsonLd['@graph'].find(
			(node: { '@type': string }) => node['@type'] === 'FAQPage',
		);
		const faqEntries: { name: string; acceptedAnswer: { text: string } }[] =
			faqPage.mainEntity;

		for (const { question, answerFragment } of newFaqs) {
			const entry = faqEntries.find((item) => item.name === question);
			expect(entry).toBeDefined();
			expect(entry?.acceptedAnswer.text).toContain(answerFragment);
		}
	});
});
