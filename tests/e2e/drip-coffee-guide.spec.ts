import { expect, test } from './fixtures/base';

test.describe('ドリップコーヒー抽出ガイド', () => {
	test('ページが正しく表示されること（未ログイン・SafetyBadge）', async ({
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();
		await toolPage.expectTitle('ドリップコーヒー抽出ガイド');
		await toolPage.expectSafetyBadge();
	});

	test('プリセット3種が表示され、豆量変更で総湯量が比例スケールされること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		const recipeList = page.getByRole('list', { name: 'レシピ一覧' });
		await expect(recipeList.locator('button[aria-pressed]')).toHaveCount(3);
		await expect(recipeList.getByText('4:6メソッド')).toBeVisible();
		await expect(recipeList.getByText('Hoffmann 1-Cup')).toBeVisible();
		await expect(recipeList.getByText('ベーシック3投')).toBeVisible();

		// 4:6メソッド（20g -> 300ml）を選択し、豆量を2倍にすると総湯量も2倍になる
		await recipeList.getByRole('button', { name: /4:6メソッド/ }).click();
		const doseInput = page.getByLabel('豆量', { exact: true });
		await doseInput.fill('40');
		await expect(page.getByText('600ml')).toBeVisible();
	});

	test('エスプレッソ・浸漬用のメソッドが選択肢に存在しないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'レシピ' }).click();
		await page.getByRole('button', { name: '新しいレシピを作る' }).click();
		await page.getByLabel('メソッド').click();

		await expect(
			page.getByRole('option', { name: /Espresso|エスプレッソ/ }),
		).toHaveCount(0);
		await expect(
			page.getByRole('option', { name: /AeroPress|French Press|浸漬/ }),
		).toHaveCount(0);
		await expect(page.getByRole('option', { name: 'V60' })).toBeVisible();
	});

	test('プリセットからガイドを開始し、完了後の記録フォームにパラメータが反映され保存できること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		await page.getByRole('button', { name: /ベーシック3投/ }).click();
		await page.getByRole('button', { name: 'ガイド開始' }).click();

		await expect(page.getByTestId('guide-timer')).toBeVisible();
		await expect(page.getByText('STEP 1 / 4')).toBeVisible();

		await page.waitForTimeout(1200);
		await page.getByTestId('guide-complete-button').click();

		// フォームが開き、メソッド・豆量・総湯量等が自動入力されている
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel('豆量', { exact: true })).toHaveValue('15');
		await expect(dialog.getByLabel('総湯量', { exact: true })).toHaveValue(
			'250',
		);
		// yield_g（抽出量）は空のまま
		await expect(dialog.getByLabel('抽出量', { exact: true })).toHaveValue('');

		await dialog.getByLabel('豆名').fill('エチオピア イルガチェフェ');
		await dialog.getByLabel('抽出量', { exact: true }).fill('250');
		await dialog.getByRole('button', { name: '保存する' }).click();
		await expect(dialog).toBeHidden();

		await page.getByRole('tab', { name: '履歴' }).click();
		await expect(page.getByText('エチオピア イルガチェフェ')).toBeVisible();
	});

	test('保存後に一覧・詳細で再表示でき、前回値が次回フォームにプリフィルされること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		await page.getByRole('button', { name: /ベーシック3投/ }).click();
		await page.getByRole('button', { name: 'ガイドなしで記録' }).click();
		const firstDialog = page.getByRole('dialog');
		await firstDialog.getByLabel('豆名').fill('ケニア AA');
		await firstDialog.getByLabel('豆量', { exact: true }).fill('15');
		await firstDialog.getByLabel('抽出量', { exact: true }).fill('250');
		await firstDialog.getByLabel('抽出時間').fill('180');
		await firstDialog.getByRole('button', { name: '保存する' }).click();
		await expect(firstDialog).toBeHidden();

		// 履歴詳細を開く
		await page.getByRole('tab', { name: '履歴' }).click();
		await page.getByText('ケニア AA').click();
		await expect(page.getByRole('dialog')).toContainText('ケニア AA');
		await page.keyboard.press('Escape');

		// 次の新規記録フォームで前回値がプリフィルされる
		await page.getByRole('tab', { name: '抽出' }).click();
		await page.getByRole('button', { name: 'ガイドなしで記録' }).click();
		await expect(page.getByRole('dialog').getByLabel('豆名')).toHaveValue(
			'ケニア AA',
		);
	});

	test('豆名の直近サジェストが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		await page.getByRole('button', { name: 'ガイドなしで記録' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('豆名').fill('グアテマラ');
		await dialog.getByLabel('豆量', { exact: true }).fill('20');
		await dialog.getByLabel('抽出量', { exact: true }).fill('300');
		await dialog.getByLabel('抽出時間').fill('180');
		await dialog.getByRole('button', { name: '保存する' }).click();
		await expect(dialog).toBeHidden();

		await page.getByRole('button', { name: 'ガイドなしで記録' }).click();
		const secondDialog = page.getByRole('dialog');
		await secondDialog.getByLabel('豆名').fill('');
		await secondDialog.getByLabel('豆名').click();
		await expect(
			secondDialog.getByRole('button', { name: 'グアテマラ' }),
		).toBeVisible();
	});

	test('マイレシピの作成・編集・削除ができ、プリセットは編集できないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'レシピ' }).click();

		// プリセットには編集ボタンがなく、複製のみ
		const presetSection = page.locator('section').first();
		await expect(
			presetSection.getByRole('button', { name: '編集' }),
		).toHaveCount(0);
		await expect(
			presetSection.getByRole('button', { name: '複製' }).first(),
		).toBeVisible();

		// マイレシピを作成
		await page.getByRole('button', { name: '新しいレシピを作る' }).click();
		const editorDialog = page.getByRole('dialog');
		await editorDialog.getByLabel('レシピ名').fill('E2Eテストレシピ');
		await editorDialog.getByLabel('基準豆量（g）').fill('16');
		await editorDialog.getByLabel('注湯量(ml)').first().fill('260');
		await editorDialog.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByText('E2Eテストレシピ')).toBeVisible();

		// 編集
		await page
			.locator('li', { hasText: 'E2Eテストレシピ' })
			.getByRole('button', { name: '編集' })
			.click();
		const editDialog = page.getByRole('dialog');
		await editDialog.getByLabel('レシピ名').fill('E2Eテストレシピ改');
		await editDialog.getByRole('button', { name: '保存する' }).click();
		await expect(page.getByText('E2Eテストレシピ改')).toBeVisible();

		// 削除
		await page
			.locator('li', { hasText: 'E2Eテストレシピ改' })
			.getByRole('button', { name: '削除' })
			.click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: '削除する' })
			.click();
		await expect(page.getByText('E2Eテストレシピ改')).toHaveCount(0);
	});

	test('JSON書き出し→読み込み（置換）でbrew件数が一致すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		await page.getByRole('button', { name: 'ガイドなしで記録' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('豆名').fill('ブラジル');
		await dialog.getByLabel('豆量', { exact: true }).fill('20');
		await dialog.getByLabel('抽出量', { exact: true }).fill('300');
		await dialog.getByLabel('抽出時間').fill('180');
		await dialog.getByRole('button', { name: '保存する' }).click();
		await expect(dialog).toBeHidden();

		await page.getByRole('tab', { name: '設定' }).click();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'JSONを書き出す' }).click(),
		]);
		const filePath = await download.path();
		expect(filePath).toBeTruthy();

		await page.getByRole('button', { name: 'JSONを読み込む' }).click();
		const fileInput = page.locator('input[type="file"]');
		if (filePath) {
			await fileInput.setInputFiles(filePath);
		}

		const importDialog = page.getByRole('dialog');
		await expect(importDialog.getByText(/置換後: レシピ/)).toBeVisible();
		await importDialog.getByRole('button', { name: '置換する' }).click();
		await expect(importDialog).toBeHidden();

		await page.getByRole('tab', { name: '履歴' }).click();
		await expect(page.getByText('ブラジル')).toBeVisible();
	});

	test('壊れたJSONは拒否され、既存データが消えないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		await toolPage.goto();

		await page.getByRole('button', { name: 'ガイドなしで記録' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('豆名').fill('コロンビア');
		await dialog.getByLabel('豆量', { exact: true }).fill('20');
		await dialog.getByLabel('抽出量', { exact: true }).fill('300');
		await dialog.getByLabel('抽出時間').fill('180');
		await dialog.getByRole('button', { name: '保存する' }).click();
		await expect(dialog).toBeHidden();

		await page.getByRole('tab', { name: '設定' }).click();
		await page.getByRole('button', { name: 'JSONを読み込む' }).click();
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles({
			name: 'broken.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{not valid json'),
		});

		await expect(page.getByRole('alert')).toContainText('JSON');

		await page.getByRole('tab', { name: '履歴' }).click();
		await expect(page.getByText('コロンビア')).toBeVisible();
	});

	test('記録本文をネットワークに送信しないこと（tool_runイベントにslugのみ）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('drip-coffee-guide');
		const events: string[] = [];
		await page.route('**/api/event', (route) => {
			events.push(route.request().postData() ?? '');
			route.fulfill({ status: 200, body: '{}' });
		});
		await toolPage.goto();

		await page.getByRole('button', { name: 'ガイドなしで記録' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('豆名').fill('機密の豆名メモ情報');
		await dialog.getByLabel('豆量', { exact: true }).fill('20');
		await dialog.getByLabel('抽出量', { exact: true }).fill('300');
		await dialog.getByLabel('抽出時間').fill('180');
		await dialog
			.getByLabel('メモ')
			.fill('絶対に送信されてはいけない秘密のメモ');
		await dialog.getByRole('button', { name: '保存する' }).click();
		await expect(dialog).toBeHidden();
		await page.waitForTimeout(300);

		for (const body of events) {
			expect(body).not.toContain('機密の豆名メモ情報');
			expect(body).not.toContain('絶対に送信されてはいけない秘密のメモ');
		}
	});
});
