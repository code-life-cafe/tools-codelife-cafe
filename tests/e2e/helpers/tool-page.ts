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

		// 信頼バッジ列は SafetyBadge に集約済みのため、重複表示されていないこと
		await expect(this.page.locator('[aria-label="信頼バッジ"]')).toHaveCount(0);
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
