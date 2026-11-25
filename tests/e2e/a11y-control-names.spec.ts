import { expect, test } from './fixtures/base';

// 選択欄・スイッチ・色入力・数値入力に、スクリーンリーダーが読める名前があること（Issue #746）。
// 名前のない部品は「コンボボックス」「スイッチ」とだけ読まれ、何の設定か分からない。
type Control = {
	role: 'combobox' | 'switch' | 'spinbutton' | 'textbox' | 'button';
	name: string | RegExp;
};

const CASES: { slug: string; controls: Control[]; colorInputs?: string[] }[] = [
	{ slug: 'csv-editor', controls: [{ role: 'combobox', name: '区切り文字' }] },
	{
		slug: 'dummy-data',
		controls: [
			{ role: 'combobox', name: 'フィールドのプリセットを選ぶ' },
			{ role: 'spinbutton', name: '生成件数 (1〜1000)' },
		],
	},
	{
		slug: 'image-metadata',
		controls: [{ role: 'combobox', name: '出力形式' }],
		colorInputs: ['JPEG背景色'],
	},
	{
		slug: 'masking',
		controls: [
			{ role: 'combobox', name: 'マスク文字' },
			{ role: 'combobox', name: '強度' },
			{ role: 'textbox', name: /^マスキング後/ },
		],
	},
	{
		slug: 'mermaid',
		controls: [
			{ role: 'combobox', name: 'サンプル' },
			{ role: 'combobox', name: 'テーマ' },
		],
	},
	{
		slug: 'ogp',
		controls: [],
		colorInputs: ['背景色（色を選ぶ）', '文字色（色を選ぶ）'],
	},
	{
		slug: 'qr-generator',
		controls: [
			{ role: 'combobox', name: 'サイズ' },
			{ role: 'combobox', name: 'エラー訂正レベル' },
			{ role: 'textbox', name: '前景色' },
			{ role: 'textbox', name: '背景色' },
		],
		colorInputs: ['前景色（色を選ぶ）', '背景色（色を選ぶ）'],
	},
	{
		slug: 'regex-tester',
		controls: [{ role: 'combobox', name: 'よく使うパターンから選ぶ' }],
	},
	{
		slug: 'sql-formatter',
		controls: [
			{ role: 'combobox', name: 'SQL方言' },
			{ role: 'combobox', name: 'インデント' },
		],
	},
	{
		slug: 'url-encoder',
		controls: [
			{ role: 'switch', name: 'デコードに切り替える（オフでエンコード）' },
		],
	},
	{
		slug: 'wareki-converter',
		controls: [
			{
				role: 'switch',
				name: '和暦から西暦への変換に切り替える（オフで西暦から和暦）',
			},
			{ role: 'spinbutton', name: '西暦（年）' },
		],
	},
	{
		slug: 'char-count',
		controls: [{ role: 'button', name: '入力テキストをクリア' }],
	},
];

test.describe('Accessibility: 操作部品のアクセシブルな名前', () => {
	for (const { slug, controls, colorInputs = [] } of CASES) {
		test(`/${slug}/ の選択欄・スイッチ・入力欄を名前で取得できる`, async ({
			page,
		}) => {
			await page.goto(`/${slug}/`);
			for (const { role, name } of controls) {
				await expect(
					page.getByRole(role, { name, exact: typeof name === 'string' }),
				).toBeVisible();
			}
			// input[type=color] はARIAロールを持たないため、ラベルで取得する
			for (const label of colorInputs) {
				const input = page.getByLabel(label, { exact: true });
				await expect(input).toBeVisible();
				await expect(input).toHaveAttribute('type', 'color');
			}
		});
	}

	test('名前のない選択欄・スイッチ・フォーム部品が対象ページに残っていない', async ({
		page,
	}) => {
		for (const { slug } of CASES) {
			await page.goto(`/${slug}/`);
			await expect(
				page.locator('astro-island[ssr][client="load"]'),
			).toHaveCount(0);
			const unnamed = await page.evaluate(() => {
				const hasName = (el: Element): boolean => {
					if (el.getAttribute('aria-label')?.trim()) return true;
					const labelledby = el.getAttribute('aria-labelledby');
					if (
						labelledby
							?.split(/\s+/)
							.some((id) => document.getElementById(id)?.textContent?.trim())
					)
						return true;
					const labels = (el as HTMLInputElement).labels;
					if (labels && [...labels].some((l) => l.textContent?.trim()))
						return true;
					if (el.getAttribute('title')?.trim()) return true;
					if (el.getAttribute('placeholder')?.trim()) return true;
					return false;
				};
				const visible = (el: Element): boolean => {
					const rect = el.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0;
				};
				return [
					...document.querySelectorAll(
						'main [role="combobox"], main [role="switch"], main input:not([type="hidden"]):not([type="file"]), main textarea',
					),
				]
					.filter((el) => visible(el) && !hasName(el))
					.map((el) => el.outerHTML.slice(0, 120));
			});
			expect(unnamed, `/${slug}/ に名前のない部品があります`).toEqual([]);
		}
	});
});
