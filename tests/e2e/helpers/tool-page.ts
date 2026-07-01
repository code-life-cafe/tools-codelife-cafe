import { expect, type Page } from '@playwright/test';

export class ToolPage {
	constructor(
		private page: Page,
		private path: string,
	) {}

	async goto() {
		await this.page.goto(`/${this.path}`);
		await this.page.waitForLoadState('networkidle');
	}

	async expectSafetyBadge() {
		await expect(
			this.page.getByRole('button', { name: 'セキュリティ情報を表示' }),
		).toBeVisible();

		const trustBadges = this.page.locator('[aria-label="信頼バッジ"]').first();
		await expect(trustBadges).toBeVisible();
		for (const label of [
			'入力データ非送信',
			'Cookieなし',
			'個人追跡なし',
			'OSS',
			'広告なし',
		]) {
			await expect(trustBadges.getByText(label, { exact: true })).toBeVisible();
		}

		await expect(trustBadges.locator('div').first()).toHaveAttribute(
			'title',
			/AI機能では初回実行時などに推論モデルをダウンロード/,
		);
	}

	async expectTitle(title: string) {
		await expect(this.page).toHaveTitle(new RegExp(title));
	}

	async fillInput(text: string) {
		await this.page.getByRole('textbox').first().fill(text);
	}

	async expectOutputContains(text: string) {
		await expect(this.page.getByRole('textbox').last()).toContainText(text);
	}

	async clickCopy() {
		await this.page.getByRole('button', { name: /コピー/ }).click();
	}
}
