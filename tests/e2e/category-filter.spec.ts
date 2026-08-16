import { toolCatalog, toolCategories } from '../../src/lib/tools/catalog';
import { expect, test } from './fixtures/base';

const devCategory = toolCategories.find((c) => c.name === '開発ツール');
if (!devCategory) throw new Error('開発ツール カテゴリが見つかりません');
const aiCategory = toolCategories.find((c) => c.name === 'AI');
if (!aiCategory) throw new Error('AI カテゴリが見つかりません');
const imageCategory = toolCategories.find((c) => c.name === '画像');
if (!imageCategory) throw new Error('画像 カテゴリが見つかりません');

const totalCount = toolCatalog.length;
const devCount = toolCatalog.filter((t) =>
	t.categories.includes('開発ツール'),
).length;
const aiCount = toolCatalog.filter((t) => t.categories.includes('AI')).length;
const imageCount = toolCatalog.filter((t) =>
	t.categories.includes('画像'),
).length;

const visibleCards = (page: import('@playwright/test').Page) =>
	page.locator('#tool-grid [data-categories]:visible');

const cardCategoryIds = async (card: import('@playwright/test').Locator) =>
	((await card.getAttribute('data-categories')) ?? '')
		.split(' ')
		.filter(Boolean);

test.describe('トップページ カテゴリフィルタ', () => {
	test('カテゴリチップをクリックすると該当カテゴリのカードのみ表示される', async ({
		page,
	}) => {
		await page.goto('/');

		// 初期状態: 全カード表示、「すべて」チップがアクティブ
		await expect(visibleCards(page)).toHaveCount(totalCount);
		await expect(
			page.getByRole('button', { name: 'すべて', exact: true }),
		).toHaveAttribute('aria-pressed', 'true');

		// 「開発ツール」チップをクリック
		await page
			.locator('#category-filter')
			.getByRole('button', { name: '開発ツール' })
			.click();

		await expect(visibleCards(page)).toHaveCount(devCount);
		for (const card of await visibleCards(page).all()) {
			expect(await cardCategoryIds(card)).toContain(devCategory.id);
		}

		// URL が ?category=<id> に更新される
		await expect(page).toHaveURL(new RegExp(`category=${devCategory.id}`));
	});

	test('「すべて」チップで全件表示に戻り、URLからパラメータが消える', async ({
		page,
	}) => {
		await page.goto('/');

		await page
			.locator('#category-filter')
			.getByRole('button', { name: '開発ツール' })
			.click();
		await expect(visibleCards(page)).toHaveCount(devCount);

		await page.getByRole('button', { name: 'すべて', exact: true }).click();

		await expect(visibleCards(page)).toHaveCount(totalCount);
		await expect(page).not.toHaveURL(/category=/);
		await expect(
			page.getByRole('button', { name: 'すべて', exact: true }),
		).toHaveAttribute('aria-pressed', 'true');
	});

	test('?category=<id> の直アクセスで初期フィルタが適用される', async ({
		page,
	}) => {
		await page.goto(`/?category=${devCategory.id}`);

		await expect(visibleCards(page)).toHaveCount(devCount);
		await expect(
			page
				.locator('#category-filter')
				.getByRole('button', { name: '開発ツール' }),
		).toHaveAttribute('aria-pressed', 'true');
	});

	test('不正な category パラメータでは全件表示のままになる', async ({
		page,
	}) => {
		await page.goto('/?category=unknown-category');

		await expect(visibleCards(page)).toHaveCount(totalCount);
		await expect(
			page.getByRole('button', { name: 'すべて', exact: true }),
		).toHaveAttribute('aria-pressed', 'true');
	});

	test('ツールカードのカテゴリバッジクリックで同カテゴリに絞り込まれる', async ({
		page,
	}) => {
		await page.goto('/');

		// JSON整形カードのカテゴリバッジ（開発ツール）をクリック
		await page
			.locator(`#tool-grid a[href="/json-formatter"] [data-category-badge]`)
			.click();

		// 遷移せずトップページのままフィルタが適用される
		await expect(page).toHaveURL(new RegExp(`category=${devCategory.id}`));
		await expect(visibleCards(page)).toHaveCount(devCount);
	});

	test('ページ遷移して戻ってもフィルタが動作する（View Transitions対応）', async ({
		page,
	}) => {
		await page.goto('/');

		// 別ページへ遷移して戻る
		await page
			.locator('#tool-grid')
			.getByRole('link', { name: /文字数カウント/ })
			.click();
		await expect(page).toHaveURL(/char-count/);
		// ヘッダーロゴ（href="/"）でトップへ戻る
		await page.locator('header a[href="/"]').click();
		await expect(page).toHaveURL('/');

		// 戻り遷移後、イベントリスナーのセットアップ完了を待つ
		await expect(page.locator('#category-filter')).toHaveAttribute(
			'data-filter-ready',
			'true',
		);

		// Back後の初期カテゴリ状態（「すべて」がアクティブ）を明示的に検証
		await expect(
			page.getByRole('button', { name: 'すべて', exact: true }),
		).toHaveAttribute('aria-pressed', 'true');

		await page
			.locator('#category-filter')
			.getByRole('button', { name: '開発ツール' })
			.click();

		// 件数および表示カードのカテゴリ整合性を確認
		await expect(visibleCards(page)).toHaveCount(devCount);
		for (const card of await visibleCards(page).all()) {
			expect(await cardCategoryIds(card)).toContain(devCategory.id);
		}
	});

	test('AI・画像の両方に該当するツールは両カテゴリのフィルタに表示される', async ({
		page,
	}) => {
		await page.goto('/');

		// 「AI」タブ: 背景削除・画像アップスケールが表示される
		await page
			.locator('#category-filter')
			.getByRole('button', { name: 'AI', exact: true })
			.click();
		await expect(visibleCards(page)).toHaveCount(aiCount);
		await expect(
			page.locator('#tool-grid a[href="/bg-remove"]:visible'),
		).toHaveCount(1);
		await expect(
			page.locator('#tool-grid a[href="/upscale"]:visible'),
		).toHaveCount(1);

		// 「画像」タブ: 同じ2ツールに加えて他の画像処理ツールも表示される
		await page
			.locator('#category-filter')
			.getByRole('button', { name: '画像', exact: true })
			.click();
		await expect(visibleCards(page)).toHaveCount(imageCount);
		await expect(
			page.locator('#tool-grid a[href="/bg-remove"]:visible'),
		).toHaveCount(1);
		await expect(
			page.locator('#tool-grid a[href="/upscale"]:visible'),
		).toHaveCount(1);

		// AIを使わない画像ツール（画像圧縮）は「AI」タブには含まれない
		await page
			.locator('#category-filter')
			.getByRole('button', { name: 'AI', exact: true })
			.click();
		await expect(
			page.locator('#tool-grid a[href="/image-compress"]:visible'),
		).toHaveCount(0);
	});
});
