import type { Page } from '@playwright/test';

/**
 * ページ内のすべてのタブ（role="tab"）について、タブとパネルの対応の問題を列挙する（Issue #747）。
 *
 * - 選択中のタブの `aria-controls` が指す要素が存在し、role="tabpanel" であること（axe aria-valid-attr-value）
 * - そのパネルが選択中のタブで名前付けされていること（aria-labelledby）
 * - 非選択のタブは、指す要素があれば role="tabpanel" であること
 *   （TabsContent は非選択のパネルを描画しないため、要素がないこと自体は許す）
 *
 * 問題がなければ空配列を返す。タブが1つもない場合も問題として返す（検査対象の取り違えを防ぐ）。
 */
export async function findTabPanelProblems(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const problems: string[] = [];
		const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
		if (tabs.length === 0) return ['role="tab" の要素がない'];
		for (const tab of tabs) {
			const label = `タブ「${tab.textContent?.trim() ?? ''}」`;
			const controls = tab.getAttribute('aria-controls');
			if (!controls) {
				problems.push(`${label}: aria-controls がない`);
				continue;
			}
			const selected = tab.getAttribute('aria-selected') === 'true';
			const panel = document.getElementById(controls);
			if (!panel) {
				if (selected) {
					problems.push(
						`${label}: 選択中なのに aria-controls="${controls}" の要素がない`,
					);
				}
				continue;
			}
			if (panel.getAttribute('role') !== 'tabpanel') {
				problems.push(`${label}: 指す要素が role="tabpanel" でない`);
			}
			if (selected) {
				const labelledBy = panel.getAttribute('aria-labelledby') ?? '';
				if (!tab.id || !labelledBy.split(/\s+/).includes(tab.id)) {
					problems.push(
						`${label}: 選択中なのにパネルの aria-labelledby がこのタブを指さない`,
					);
				}
			}
		}
		return problems;
	});
}
