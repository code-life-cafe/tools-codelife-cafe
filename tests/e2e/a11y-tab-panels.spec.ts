import { expect, test } from './fixtures/base';
import { findTabPanelProblems } from './helpers/tab-panels';

// 切替だけに使っているタブが、存在しないパネルを aria-controls で指さないこと（Issue #747 の5、axe aria-valid-attr-value）。
// タブは切り替わる領域（パネル）を指し、パネルは選択中のタブで名前付けされる。矢印キーでの切替も維持する。
// 画像の投入が必要な /favicon/ と /image-mosaic/ は、それぞれの spec で検証する。
type Case = {
	path: string;
	/** 矢印キーで切り替える tablist の位置（0始まり） */
	tablistIndex?: number;
	/** モバイル幅だけでタブを出すページ */
	mobile?: boolean;
	/** sm 以上の幅だけでタブを出す切替 */
	desktop?: boolean;
	/** 検査の前に押すタブ（入れ子のタブの外側など） */
	before?: string;
};

const CASES: Case[] = [
	{ path: '/cipher/' },
	{ path: '/cipher/caesar-hiragana/' },
	{ path: '/dummy-data/' },
	{ path: '/ogp/' },
	{ path: '/qr-reader/' },
	{ path: '/qr-encrypt/', before: 'QRを読み取って復号', tablistIndex: 1 },
	{ path: '/tax/' },
	{ path: '/tax/', tablistIndex: 1 },
	{ path: '/text-diff/' },
	{ path: '/text-diff/', tablistIndex: 1, desktop: true },
	{ path: '/unix-time/' },
	{ path: '/url-encoder/' },
	{ path: '/wareki-converter/' },
	{ path: '/markdown/', mobile: true },
	{ path: '/mermaid/', mobile: true },
];

test.describe('切替タブとパネルの対応（#747）', () => {
	for (const c of CASES) {
		const index = c.tablistIndex ?? 0;
		test(`${c.path} のタブ（${index + 1}つ目の切替）がパネルを指し、矢印キーで切り替えられる`, async ({
			page,
		}) => {
			if (c.mobile) await page.setViewportSize({ width: 375, height: 800 });
			if (c.desktop) await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(c.path);
			await expect(
				page.locator('astro-island[ssr][client="load"]'),
			).toHaveCount(0);
			if (c.before) {
				await page.getByRole('tab', { name: c.before }).click();
			}

			expect(await findTabPanelProblems(page)).toEqual([]);

			const tablist = page.getByRole('tablist').nth(index);
			const selected = tablist.getByRole('tab', { selected: true });
			await expect(selected).toHaveCount(1);
			const before = await selected.getAttribute('id');
			await selected.focus();
			await page.keyboard.press('ArrowRight');
			await expect(selected).not.toHaveAttribute('id', before ?? '');
			const next = tablist.getByRole('tab', { selected: true });
			await expect(next).toBeFocused();

			expect(await findTabPanelProblems(page)).toEqual([]);
			// 選択中のタブが指すパネルが表示され、そのタブの名前で読まれる
			const panelId = await next.getAttribute('aria-controls');
			const panel = page.locator(`[id="${panelId}"]`);
			await expect(panel).toBeVisible();
			await expect(panel).toHaveAccessibleName(
				(await next.textContent())?.trim() ?? '',
			);
		});
	}
});
