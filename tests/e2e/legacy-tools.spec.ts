import { PDFDocument } from 'pdf-lib';
import { toolCatalog } from '../../src/lib/tools/catalog';
import { expect, test } from './fixtures/base';

test('旧URL全件は正規URLへ移動しクエリ・ハッシュを維持する', async ({
	page,
}) => {
	test.setTimeout(180_000);
	for (const tool of toolCatalog) {
		await page.goto(`/tools/${tool.id}/?probe=%2B&probe=two#preview`);
		await expect(page).toHaveURL(
			new RegExp(`${tool.href}\\?probe=%2B&probe=two#preview$`),
		);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			`https://tools.codelife.cafe${tool.href}`,
		);
	}
});

for (const slug of ['image-compress', 'pdf-merge', 'csv-fixer']) {
	test(`${slug}の旧URLから操作UIを開ける`, async ({ page }) => {
		await page.goto(`/tools/${slug}/`);
		await expect(page).toHaveURL(new RegExp(`/${slug}/?$`));
		await expect(page.locator('input[type="file"]').first()).toBeAttached();
		await expect(
			page.getByText('このツールには操作エリアがありません。'),
		).toHaveCount(0);
	});
}

test('旧画像圧縮URLから画像を処理できる', async ({ page }) => {
	await page.goto('/tools/image-compress/');
	await page
		.locator('input[type="file"]')
		.setInputFiles('tests/e2e/fixtures/sample-400x300.png');
	await expect(
		page.getByRole('button', { name: 'ダウンロード', exact: true }).first(),
	).toBeVisible();
});

test('旧PDF結合URLから合成PDFを結合できる', async ({ page }) => {
	const pdf = await PDFDocument.create();
	pdf.addPage([200, 200]);
	const buffer = Buffer.from(await pdf.save());
	await page.goto('/tools/pdf-merge/');
	await page.locator('input[type="file"]').setInputFiles([
		{ name: 'sample-a.pdf', mimeType: 'application/pdf', buffer },
		{ name: 'sample-b.pdf', mimeType: 'application/pdf', buffer },
	]);
	await expect(
		page.getByTestId('merge-file-row').filter({ hasText: /1ページ/ }),
	).toHaveCount(2);
	const downloaded = page.waitForEvent('download');
	await page.getByRole('button', { name: '結合してダウンロード' }).click();
	expect((await downloaded).suggestedFilename()).toMatch(/\.pdf$/);
});

test('旧CSV修復URLから合成CSVを変換できる', async ({ page }) => {
	await page.goto('/tools/csv-fixer/');
	await page.locator('input[type="file"]').setInputFiles({
		name: 'sample.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('名前,値\nサンプル,123\n'),
	});
	await expect(
		page.getByRole('cell', { name: 'サンプル', exact: true }),
	).toBeVisible();
	const downloaded = page.waitForEvent('download');
	await page.getByRole('button', { name: '変換してダウンロード' }).click();
	expect((await downloaded).suggestedFilename()).toBe('sample_converted.csv');
});

test('旧共有URLの設定を復元し共有URLが正規URLになる', async ({
	page,
	context,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const settings = Buffer.from(JSON.stringify({ indent: '4' })).toString(
		'base64',
	);
	await page.goto(
		`/tools/json-formatter/?settings=${encodeURIComponent(settings)}`,
	);
	await expect(page).toHaveURL(/\/json-formatter\/\?settings=/);
	await expect(page.getByRole('combobox')).toContainText('4');
	await page.getByRole('button', { name: '設定を共有' }).click();
	const shared = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URL(shared).pathname).toBe('/json-formatter/');
	expect(
		JSON.parse(
			Buffer.from(
				new URL(shared).searchParams.get('settings') ?? '',
				'base64',
			).toString(),
		),
	).toEqual({ indent: '4' });
});
