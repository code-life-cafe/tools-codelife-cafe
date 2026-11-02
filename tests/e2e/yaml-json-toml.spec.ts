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

	test('入替ボタンで変換元・変換先と入力・出力の内容が入れ替わる', async ({
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
			.getByRole('button', { name: '変換元・変換先と入力・出力を入れ替え' })
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
		// smol-toml 1.9以降は閉じ括弧が無い配列を、不正トークンのある2行目先頭に報告する
		await expect(error).toContainText('L2:C1');
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

	test('方向表記は日本語で、同形式の説明と1280px/390pxの操作ができる', async ({
		page,
		createToolPage,
	}) => {
		const sameFormat =
			'変換元と変換先が同じ形式のため、整形（インデント・キーソート適用）のみ行います。';
		const toolPage = createToolPage('yaml-json-toml');

		for (const viewport of [
			{ width: 1280, height: 900 },
			{ width: 390, height: 844 },
		]) {
			await page.setViewportSize(viewport);
			await toolPage.goto();

			await expect(page.getByText('変換元', { exact: true })).toBeVisible();
			await expect(page.getByText('変換先', { exact: true })).toBeVisible();
			await expect(page.getByText('From', { exact: true })).toHaveCount(0);
			await expect(page.getByText('To', { exact: true })).toHaveCount(0);
			await expect(page.getByText(sameFormat)).toHaveCount(0);

			const swap = page.getByRole('button', {
				name: '変換元・変換先と入力・出力を入れ替え',
			});
			await expect(swap).toBeVisible();

			await page.getByRole('combobox', { name: '変換元の形式' }).click();
			await page.getByRole('option', { name: 'JSON', exact: true }).click();
			await expect(page.getByText(sameFormat)).toBeVisible();
			await page.getByLabel('JSON入力').fill('{"b":1,"a":2}');
			await expect(page.getByLabel('JSON出力')).toHaveValue(
				'{\n  "b": 1,\n  "a": 2\n}',
			);

			await page.getByRole('combobox', { name: '変換先の形式' }).click();
			await page.getByRole('option', { name: 'YAML', exact: true }).click();
			await expect(page.getByText(sameFormat)).toHaveCount(0);
			await expect(page.getByLabel('YAML出力')).toHaveValue('b: 1\na: 2\n');

			await swap.click();
			await expect(page.getByLabel('YAML入力')).toHaveValue('b: 1\na: 2\n');
			await expect(page.getByLabel('JSON出力')).toHaveValue(
				'{\n  "b": 1,\n  "a": 2\n}',
			);

			const controls = [
				page.getByRole('combobox', { name: '変換元の形式' }),
				swap,
				page.getByRole('combobox', { name: '変換先の形式' }),
				page.getByRole('combobox', { name: 'インデント幅' }),
				page.getByRole('switch', { name: 'キーソート' }),
				page.getByLabel('YAML入力'),
				page.getByLabel('JSON出力'),
			];
			await assertControlsDoNotOverlap(controls, viewport);
		}
	});
});

async function assertControlsDoNotOverlap(
	controls: Array<{
		boundingBox: () => Promise<{
			x: number;
			y: number;
			width: number;
			height: number;
		} | null>;
		scrollIntoViewIfNeeded: () => Promise<void>;
	}>,
	viewport: { width: number; height: number },
) {
	const boxes = [];
	for (const control of controls) {
		const box = await control.boundingBox();
		expect(box).not.toBeNull();
		if (!box) continue;
		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
		boxes.push({ control, box });
	}
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i].box;
			const b = boxes[j].box;
			const overlapX =
				Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
			const overlapY =
				Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
			expect(overlapX > 1 && overlapY > 1).toBe(false);
		}
	}
	for (const { control, box } of boxes) {
		const inView = box.y >= -1 && box.y + box.height <= viewport.height + 1;
		if (!inView) await control.scrollIntoViewIfNeeded();
		const measured = inView ? box : await control.boundingBox();
		expect(measured).not.toBeNull();
		if (!measured) continue;
		expect(measured.x).toBeGreaterThanOrEqual(-1);
		expect(measured.x + measured.width).toBeLessThanOrEqual(viewport.width + 1);
	}
}
