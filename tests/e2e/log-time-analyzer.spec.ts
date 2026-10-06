import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures/base';

test.describe('ログ時間差分析ツール', () => {
	test('100件を超える不正行も行番号と理由を確認できる', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('log-time-analyzer').goto();
		await page
			.getByLabel(/^ログ/)
			.fill(Array.from({ length: 101 }, () => '不正な時刻').join('\n'));
		await expect(
			page.getByTestId('log-time-invalid').locator('li'),
		).toHaveCount(100);
		await page
			.getByRole('button', {
				name: 'すべての不正行を表示（101件）',
				exact: true,
			})
			.click();
		await expect(page.getByTestId('log-time-invalid')).toContainText('101行目');
		await expect(
			page.getByTestId('log-time-invalid').locator('li'),
		).toHaveCount(101);
	});
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('log-time-analyzer');
		await toolPage.goto();
		await toolPage.expectTitle('ログ時間差分析');
		await toolPage.expectSafetyBadge();
	});

	test('ISO 8601のログから時間差・不正行・順序逆転を表示できること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('log-time-analyzer');
		await toolPage.goto();
		await page
			.getByLabel(/^ログ/)
			.fill(
				[
					'2026-10-06T09:00:00.000Z start',
					'2026-10-06T09:00:01.500Z next',
					'broken line',
					'[2026-10-06T18:00:10+09:00] later',
					'2026-10-06T09:00:05Z reversed',
				].join('\n'),
			);

		await expect(page.getByTestId('log-time-summary')).toContainText(
			'解析できた行 4件',
		);
		await expect(page.getByTestId('log-time-summary')).toContainText(
			'解析できない行 1件',
		);
		await expect(page.getByTestId('log-time-invalid')).toContainText('3行目');

		const top = page.getByTestId('log-time-top');
		await expect(top).toContainText('8500');
		await expect(top).toContainText('間に解析できない行あり');
		await expect(top).toContainText('1500');

		await expect(page.getByTestId('log-time-reversed')).toContainText('-5000');
	});

	test('UNIX秒・ミリ秒を形式選択で解析でき、全行不正ならエラー表示になること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('log-time-analyzer');
		await toolPage.goto();
		const input = page.getByLabel(/^ログ/);

		await page.getByLabel('時刻の形式').selectOption('unix-s');
		await input.fill('1700000000.5 a\n1700000002 b');
		await expect(page.getByTestId('log-time-top')).toContainText('1500');

		await page.getByLabel('時刻の形式').selectOption('unix-ms');
		await expect(page.getByTestId('log-time-summary')).toContainText(
			'解析できた行 2件',
		);
		await expect(page.getByTestId('log-time-top')).toContainText('1.5');

		await page.getByLabel('時刻の形式').selectOption('iso');
		await expect(page.getByRole('alert')).toContainText(
			'解析できる行がありません',
		);
	});

	test('CSVを保存でき、数式として解釈される先頭文字が無害化されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('log-time-analyzer');
		await toolPage.goto();
		await page.getByLabel('時刻の形式').selectOption('unix-s');
		await page.getByLabel(/^ログ/).fill('100 a\n102 b\n=cmd x\n101 c');

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: '全間隔をCSV保存' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('log-time-diff.csv');
		const path = await download.path();
		const csv = await readFile(path, 'utf-8');
		expect(csv).toContain('2000');
		expect(csv).toContain('-1000');
		expect(csv).not.toContain('cmd');
	});

	test('行数上限を超えるとエラーになり、入力がlocalStorageに保存されないこと', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('log-time-analyzer');
		await toolPage.goto();
		await page.getByLabel('時刻の形式').selectOption('unix-s');
		await page.getByLabel(/^ログ/).evaluate((element) => {
			// 大量行はネイティブsetterとinputイベントで投入し、Reactの入力処理を検証する。
			const setter = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				'value',
			)?.set;
			if (!setter) throw new Error('textareaのsetterがありません');
			setter.call(element, '1 x\n'.repeat(10_001));
			element.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await expect(page.getByRole('alert')).toContainText('行数が多すぎます');

		await page.getByLabel(/^ログ/).fill('1 SECRET_TOKEN_123');
		const stored = await page.evaluate(
			() =>
				JSON.stringify({ ...localStorage }) +
				JSON.stringify({ ...sessionStorage }),
		);
		expect(stored).not.toContain('SECRET_TOKEN_123');
	});
});
