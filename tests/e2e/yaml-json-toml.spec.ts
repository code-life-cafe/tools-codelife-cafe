import { expect, test } from './fixtures/base';

test.describe('YAML ⇔ JSON ⇔ TOML 変換ツール', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();
		await toolPage.expectTitle('YAML ⇔ JSON ⇔ TOML 変換ツール');
		await toolPage.expectSafetyBadge();
	});

	test('サンプル読込: k8s ConfigMap風YAML → JSON', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByRole('combobox', { name: 'サンプルを読み込み' }).click();
		await page
			.getByRole('option', { name: 'k8s ConfigMap風 YAML → JSON' })
			.click();

		await expect(page.getByLabel('YAML入力')).toHaveValue(/apiVersion: v1/);
		await expect(page.getByLabel('JSON出力')).toHaveValue(
			/"MAX_CONNECTIONS": "100"/,
		);
	});

	test('Swapボタンで From/To と入力/出力の内容が入れ替わる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByLabel('YAML入力').fill('name: 太郎\nage: 30\n');
		await expect(page.getByLabel('JSON出力')).toHaveValue(
			'{\n  "name": "太郎",\n  "age": 30\n}',
		);

		await page
			.getByRole('button', { name: 'From/Toと入力/出力を入れ替え' })
			.click();

		await expect(page.getByLabel('JSON入力')).toHaveValue(
			'{\n  "name": "太郎",\n  "age": 30\n}',
		);
		await expect(page.getByLabel('YAML出力')).toHaveValue(
			'name: 太郎\nage: 30\n',
		);
	});

	test('不正なJSONでL{row}:C{col}付きエラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換元の形式' }).click();
		await page.getByRole('option', { name: 'JSON', exact: true }).click();

		await page.getByLabel('JSON入力').fill('{"a": 1,}');
		const error = page.getByTestId('yaml-json-toml-error');
		await expect(error).toContainText('L1:C9');
		await expect(error).toContainText('JSON');
	});

	test('不正なYAMLで行番号付きエラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByLabel('YAML入力').fill('a: [1, 2\nb: 3');
		const error = page.getByTestId('yaml-json-toml-error');
		await expect(error).toContainText('L2:C1');
		await expect(error).toContainText('YAML');
	});

	test('不正なTOMLで行番号付きエラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換元の形式' }).click();
		await page.getByRole('option', { name: 'TOML', exact: true }).click();

		await page.getByLabel('TOML入力').fill('a = [1, 2\nb = 3');
		const error = page.getByTestId('yaml-json-toml-error');
		await expect(error).toContainText('L1:C9');
		await expect(error).toContainText('TOML');
	});

	test('JSONルート配列 → TOML は専用エラーになること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換元の形式' }).click();
		await page.getByRole('option', { name: 'JSON', exact: true }).click();
		await page.getByRole('combobox', { name: '変換先の形式' }).click();
		await page.getByRole('option', { name: 'TOML', exact: true }).click();

		await page.getByLabel('JSON入力').fill('[1, 2, 3]');
		const error = page.getByTestId('yaml-json-toml-error');
		await expect(error).toContainText('TOML');
		await expect(error).toContainText('配列');
	});

	test('null含有 → TOML はキー単位パス付きの専用エラーになること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換元の形式' }).click();
		await page.getByRole('option', { name: 'JSON', exact: true }).click();
		await page.getByRole('combobox', { name: '変換先の形式' }).click();
		await page.getByRole('option', { name: 'TOML', exact: true }).click();

		await page.getByLabel('JSON入力').fill('{"settings":{"apiKey":null}}');
		const error = page.getByTestId('yaml-json-toml-error');
		await expect(error).toContainText('null');
		await expect(error).toContainText('settings.apiKey');
	});

	test('キーソートON/OFFとインデント幅切替が出力に反映されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換元の形式' }).click();
		await page.getByRole('option', { name: 'JSON', exact: true }).click();

		await page.getByLabel('JSON入力').fill('{"b":2,"a":1}');
		const output = page.getByLabel('JSON出力');
		await expect(output).toHaveValue('{\n  "b": 2,\n  "a": 1\n}');

		// キーソートON
		await page.getByRole('switch', { name: 'キーソート' }).click();
		await expect(output).toHaveValue('{\n  "a": 1,\n  "b": 2\n}');

		// インデント幅4
		await page.getByRole('combobox', { name: 'インデント幅' }).click();
		await page.getByRole('option', { name: '4スペース' }).click();
		await expect(output).toHaveValue('{\n    "a": 1,\n    "b": 2\n}');
	});

	test('TOMLはコンパクト表示非対応の注記が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換元の形式' }).click();
		await page.getByRole('option', { name: 'JSON', exact: true }).click();
		await page.getByRole('combobox', { name: '変換先の形式' }).click();
		await page.getByRole('option', { name: 'TOML', exact: true }).click();

		await page.getByLabel('JSON入力').fill('{"a":1}');
		await page.getByRole('combobox', { name: 'インデント幅' }).click();
		await page.getByRole('option', { name: 'コンパクト' }).click();

		await expect(page.getByLabel('TOML出力')).toHaveValue('a = 1\n');
		await expect(page.getByText(/コンパクト表示/)).toBeVisible();
	});

	test('コピーが動作すること', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.getByLabel('YAML入力').fill('name: 太郎\n');
		await expect(page.getByLabel('JSON出力')).toHaveValue(
			'{\n  "name": "太郎"\n}',
		);
		await page.getByRole('button', { name: 'コピー', exact: true }).click();
		await expect(
			page.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible();
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('yaml-json-toml');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('YAML入力')).toBeVisible();
		await expect(page.getByLabel('JSON出力')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('YAML入力')).toBeVisible();
		await expect(page.getByLabel('JSON出力')).toBeVisible();
	});
});
