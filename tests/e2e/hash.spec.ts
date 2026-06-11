import path from 'node:path';
import { expect, test } from './fixtures/base';

// tests/e2e/fixtures/hash-sample.txt（scripts/generate-fixtures.ts で生成）の既知ハッシュ値
const FIXTURE = {
	path: path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'hash-sample.txt'),
	md5: '0815c77156afa38b4fd65109f46b55de',
	sha1: '8dc4cf8bb64e0d795012d71e2266b4820f877152',
	sha256: '7b7077ac778313b109b267afadc2be2f4ea36b519acce86d3ff9e07a65a70ca1',
	crc32: 'ebf9b3f3',
};

const ABC_SHA256 =
	'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const KONNICHIWA_SHA256 =
	'125aeadf27b0459b8760c13a3d80912dfa8a81a68261906f60d87f4a0268646c';

test.describe('Hash Generator Tool', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();
		await toolPage.expectTitle('ハッシュ値計算ツール');
		await toolPage.expectSafetyBadge();
	});

	test('テキスト "abc" のSHA-256が既知ベクトルと一致すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByLabel('ハッシュ計算するテキスト').fill('abc');
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			ABC_SHA256,
		);
		await expect(page.getByTestId('hash-result-md5')).toContainText(
			'900150983cd24fb0d6963f7d28e17f72',
		);
	});

	test('日本語テキストのハッシュが決定的であること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByLabel('ハッシュ計算するテキスト').fill('こんにちは');
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			KONNICHIWA_SHA256,
		);
	});

	test('アルゴリズムの選択切替で結果行が増減すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByLabel('ハッシュ計算するテキスト').fill('abc');
		await expect(page.getByTestId('hash-result-sha256')).toBeVisible();
		await expect(page.getByTestId('hash-result-sha512')).not.toBeVisible();
		await expect(page.getByTestId('hash-result-crc32')).not.toBeVisible();

		// SHA-512 を追加
		await page.getByRole('checkbox', { name: 'SHA-512' }).click();
		await expect(page.getByTestId('hash-result-sha512')).toContainText(
			/[0-9a-f]{128}/,
		);

		// MD5 を外す
		await page.getByRole('checkbox', { name: 'MD5', exact: true }).click();
		await expect(page.getByTestId('hash-result-md5')).not.toBeVisible();
	});

	test('ファイルアップロードで全選択アルゴリズムの結果が表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'ファイル' }).click();
		// CRC32 も選択して4アルゴリズム
		await page.getByRole('checkbox', { name: 'CRC32' }).click();
		await page.getByTestId('hash-file-input').setInputFiles(FIXTURE.path);

		await expect(page.getByTestId('hash-result-md5')).toContainText(
			FIXTURE.md5,
		);
		await expect(page.getByTestId('hash-result-sha1')).toContainText(
			FIXTURE.sha1,
		);
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			FIXTURE.sha256,
		);
		await expect(page.getByTestId('hash-result-crc32')).toContainText(
			FIXTURE.crc32,
		);
	});

	test('ファイル差し替え時に前回の結果がクリアされること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'ファイル' }).click();
		await page.getByTestId('hash-file-input').setInputFiles(FIXTURE.path);
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			FIXTURE.sha256,
		);

		// 別ファイルに差し替えると前回の値は消え、新しい値が表示される
		await page
			.getByTestId('hash-file-input')
			.setInputFiles(
				path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'utf8_no_bom.csv'),
			);
		await expect(page.getByTestId('hash-result-sha256')).not.toContainText(
			FIXTURE.sha256,
		);
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			/[0-9a-f]{64}/,
		);
	});

	test('期待値照合: 一致・不一致・判定不能・未選択アルゴリズム', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByLabel('ハッシュ計算するテキスト').fill('abc');
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			ABC_SHA256,
		);

		const expectedInput = page.getByLabel('期待値との照合', { exact: false });
		const verifyResult = page.getByTestId('hash-verify-result');

		// 一致（大文字・ハイフン混在でも吸収される）
		await expectedInput.fill(ABC_SHA256.toUpperCase());
		await expect(verifyResult).toContainText('一致');
		await expect(verifyResult).not.toContainText('不一致');

		// 不一致
		await expectedInput.fill(`${ABC_SHA256.slice(0, 63)}0`);
		await expect(verifyResult).toContainText('不一致');

		// 判定不能な長さ
		await expectedInput.fill('abcdef1234');
		await expect(verifyResult).toContainText('判定できません');

		// CRC32 長（8桁）はデフォルト未選択 → 自動追加せず案内を表示
		await expectedInput.fill('352441c2');
		await expect(verifyResult).toContainText(
			'対象アルゴリズムを選択してください',
		);
	});

	test('コピーと大文字トグルが動作すること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByLabel('ハッシュ計算するテキスト').fill('abc');
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			ABC_SHA256,
		);

		// 大文字トグル
		await page.getByRole('switch', { name: '大文字で表示' }).click();
		await expect(page.getByTestId('hash-result-sha256')).toContainText(
			ABC_SHA256.toUpperCase(),
		);

		// コピー
		await page
			.getByTestId('hash-result-sha256')
			.getByRole('button', { name: /コピー/ })
			.click();
		await expect(
			page.getByTestId('hash-result-sha256').getByRole('button'),
		).toContainText('コピー済み');
	});

	test('上限超ファイルで日本語エラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.getByRole('tab', { name: 'ファイル' }).click();
		// File.prototype.size を偽装して256MB超を再現（実ファイルは作らない）
		await page.evaluate(() => {
			Object.defineProperty(File.prototype, 'size', {
				get: () => 257 * 1024 * 1024,
				configurable: true,
			});
		});
		await page.getByTestId('hash-file-input').setInputFiles(FIXTURE.path);

		await expect(page.getByRole('alert')).toContainText('ファイルサイズが上限');
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		const textarea = page.getByLabel('ハッシュ計算するテキスト');
		await expect(textarea).toBeVisible();
		await expect(page.getByRole('checkbox', { name: 'SHA-256' })).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(textarea).toBeVisible();
	});
});
