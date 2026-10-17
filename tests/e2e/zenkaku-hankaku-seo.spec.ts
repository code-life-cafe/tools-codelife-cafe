import { expect, test } from './fixtures/base';

test.describe('全角半角変換 SEO', () => {
	test('title・meta description・H1が最新のfrontmatterと一致すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('zenkaku-hankaku');
		await toolPage.goto();

		await expect(page).toHaveTitle(/^全角半角変換/);
		await expect(page).toHaveTitle(
			'全角半角変換｜全角⇔半角をまとめて一括変換・データ送信なし | CODE:LIFE Tools',
		);

		const description = await page
			.locator('meta[name="description"]')
			.getAttribute('content');
		expect(description).toBe(
			'全角・半角の変換をブラウザ内でまとめて処理する無料ツール。カナ・英字・数字・記号を種類別に選んで一括変換でき、半角カナの濁点（ｶﾞ→ガ）も正しく結合します。入力を外部サーバーへ送信することはありません。',
		);
		const length = description?.length ?? 0;
		expect(length).toBeGreaterThanOrEqual(100);
		expect(length).toBeLessThanOrEqual(120);

		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'全角半角変換（全角⇔半角を一括変換）',
		);
	});

	test('追加したFAQがページとFAQPage JSON-LDの両方に出力されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('zenkaku-hankaku');
		await toolPage.goto();

		const newFaqs = [
			{
				question: '全角と半角の違いは何ですか？',
				answerFragment: '文字数カウント',
			},
			{
				question: 'Excelの関数（ASC・JIS）との違いは何ですか？',
				answerFragment: '文字種を絞ることはできません',
			},
			{
				question: '銀行振込名義で使える文字に揃えられますか？',
				answerFragment: '金融機関によって異なる',
			},
			{
				question: '入力したテキストはサーバーに送信されますか？',
				answerFragment: '送信されません',
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
