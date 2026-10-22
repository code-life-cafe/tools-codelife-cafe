import { expect, test } from './fixtures/base';

const path = '/cipher/caesar-hiragana/';
const canonical = `https://tools.codelife.cafe${path}`;

test('ひらがなLPのSEO・例題・FAQ・相互リンク', async ({ page }) => {
	await page.goto(path);
	await expect(page).toHaveTitle(
		'ひらがなのシーザー暗号｜日本語の変換・解読と例題 | CODE:LIFE Tools',
	);
	const description = await page
		.locator('meta[name="description"]')
		.getAttribute('content');
	expect(description?.length).toBeGreaterThanOrEqual(80);
	expect(description?.length).toBeLessThanOrEqual(120);
	expect(description).toContain('総当たり解読');
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		'href',
		canonical,
	);
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		'content',
		'https://tools.codelife.cafe/og/cipher.png',
	);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'ひらがなのシーザー暗号：日本語の変換・解読',
	);
	const examples = page.getByRole('region', {
		name: 'ひらがなの暗号化・復号・総当たり解読の例題',
	});
	await expect(examples).toContainText('「すうのとへ」');
	await expect(examples).toContainText('シフト 3: こんにちは');
	const faq = page.getByRole('region', { name: 'よくある質問 (FAQ)' });
	await expect(faq.locator('dt')).toHaveCount(4);
	const data = await page
		.locator('script[type="application/ld+json"]')
		.allTextContents();
	const graphs = data.flatMap((value) => JSON.parse(value)['@graph'] ?? []);
	for (const type of ['SoftwareApplication', 'FAQPage', 'BreadcrumbList']) {
		expect(graphs.some((node) => node['@type'] === type)).toBe(true);
	}
	const app = graphs.find((node) => node['@type'] === 'SoftwareApplication');
	expect(app.url).toBe(canonical);
	expect(app.offers.price).toBe('0');
	const breadcrumbs = graphs.find((node) => node['@type'] === 'BreadcrumbList');
	expect(breadcrumbs.itemListElement.at(-1).item).toBe(canonical);
	const structuredFaq = graphs.find((node) => node['@type'] === 'FAQPage');
	expect(structuredFaq.mainEntity).toHaveLength(4);
	for (const question of structuredFaq.mainEntity) {
		await expect(faq).toContainText(question.name);
		await expect(faq).toContainText(question.acceptedAnswer.text);
	}
	await page
		.getByRole('link', { name: 'シーザー暗号変換・解読ツールへ', exact: true })
		.click();
	await expect(page).toHaveURL(/\/cipher\/?$/);
	await expect(
		page.getByPlaceholder(/「こんにちは」や「Hello World」を入力/),
	).toHaveValue('');
	await page
		.getByRole('link', { name: 'ひらがなシーザー暗号の解説と例題' })
		.click();
	await expect(page).toHaveURL(new RegExp(`${path}$`));
});

test('例文で暗号化・復号し、全45候補を推測順で選択する', async ({ page }) => {
	await page.goto(path);
	const input = page.getByPlaceholder(/「こんにちは」や「Hello World」を入力/);
	const output = page.getByPlaceholder('変換結果がここに表示されます');
	await page
		.getByRole('button', {
			name: 'ひらがなの例文を試す（こんにちは・シフト3）',
		})
		.click();
	await expect(input).toHaveValue('こんにちは');
	await expect(page.getByLabel('シフト数:')).toHaveValue('3');
	await expect(output).toHaveValue('すうのとへ');
	await input.fill('すうのとへ');
	await page
		.getByRole('button', { name: 'デコード（復号）', exact: true })
		.click();
	await expect(output).toHaveValue('こんにちは');
	await page
		.getByRole('button', { name: 'エンコード（暗号化）', exact: true })
		.click();
	await page
		.getByRole('button', { name: '鍵がわからないとき：全候補を見る' })
		.click();
	const candidates = page.getByRole('button', { name: /^シフト \d+:/ });
	await expect(candidates).toHaveCount(45);
	await expect(candidates.first()).toContainText('シフト 1:');
	await page.getByLabel('候補の並べ替え').selectOption('score');
	await expect(candidates).toHaveCount(45);
	await expect(candidates.first()).toContainText('シフト 3:');
	await expect(candidates.first()).toContainText('こんにちは');
	await expect(page.getByText('推測: 有力', { exact: true })).toHaveCount(1);
	await expect(candidates.first()).toContainText('推測: 有力');
	await expect(
		page.getByText(
			'スコアは文字の頻度や短い頻出語による推測で、正解を保証しません。英字の英語らしさも評価します。',
		),
	).toBeVisible();
	await candidates.first().focus();
	await candidates.first().press('Enter');
	await expect(output).toHaveValue('こんにちは');
	await expect(input).toHaveValue('すうのとへ');
	await expect(page.getByLabel('シフト数:')).toHaveValue('3');
	await page.getByLabel('候補の並べ替え').selectOption('shift');
	await expect(candidates.first()).toContainText('シフト 1:');
	await input.fill('Khoor zruog');
	await expect(candidates).toHaveCount(25);
	await page.getByLabel('候補の並べ替え').selectOption('score');
	await expect(candidates.first()).toContainText('Hello world');
	for (const width of [375, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	}
});

for (const route of ['/cipher/', path]) {
	test(`全候補が同点なら有力バッジを表示せず優勢候補を保つ: ${route}`, async ({
		page,
	}) => {
		await page.goto(route);
		const input = page.getByPlaceholder(
			/「こんにちは」や「Hello World」を入力/,
		);
		const candidates = page.getByRole('button', { name: /^シフト \d+:/ });
		const badge = page.getByText('推測: 有力', { exact: true });
		const order = page.getByLabel('候補の並べ替え');

		await input.fill('すうのとへ');
		await page
			.getByRole('button', { name: '鍵がわからないとき：全候補を見る' })
			.click();
		await expect(candidates).toHaveCount(45);
		await expect(candidates.first()).toContainText('シフト 1:');
		await expect(badge).toHaveCount(0);
		await order.selectOption('score');
		await expect(candidates.first()).toContainText('シフト 3:');
		await expect(candidates.first()).toContainText('こんにちは');
		await expect(badge).toHaveCount(1);

		await input.fill('123!?');
		await expect(candidates).toHaveCount(25);
		await expect(candidates).toContainText(
			Array.from({ length: 25 }, (_, index) => `シフト ${index + 1}:`),
		);
		for (const candidate of await candidates.all()) {
			await expect(candidate).toContainText('123!?');
		}
		await expect(badge).toHaveCount(0);

		await input.fill('すうのとへ');
		await expect(candidates).toHaveCount(45);
		await expect(candidates.first()).toContainText('シフト 3:');
		await expect(candidates.first()).toContainText('こんにちは');
		await expect(badge).toHaveCount(1);
		await input.fill('Khoor zruog');
		await expect(candidates).toHaveCount(25);
		await expect(candidates.first()).toContainText('シフト 3:');
		await expect(candidates.first()).toContainText('Hello world');
		await expect(badge).toHaveCount(1);
		await order.selectOption('shift');
		await expect(candidates.first()).toContainText('シフト 1:');
		await expect(badge).toHaveCount(0);
	});
}
