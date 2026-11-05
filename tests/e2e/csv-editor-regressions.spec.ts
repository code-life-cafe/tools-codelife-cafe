import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, test } from './fixtures/base.ts';

for (const csv of [
	'カテゴリ,値\n売上,10',
	'カテゴリ,値\nゼロ前,0\n売上,10\nゼロ後,0',
]) {
	test(
		'円グラフの100%の円がプレビュー・SVG・PNGで一致する（#573）: ' +
			csv.split('\n').length +
			'行',
		async ({ page, createToolPage }) => {
			await createToolPage('csv-editor').goto();
			await page.getByRole('textbox').first().fill(csv);
			await page.getByRole('button', { name: 'パースして編集へ' }).click();
			await page.getByRole('tab', { name: /グラフ/ }).click();
			await page.getByRole('tabpanel').getByRole('combobox').first().click();
			await page.getByRole('option', { name: '円グラフ', exact: true }).click();

			const svg = page.getByRole('tabpanel').locator('svg[viewBox]:has(text)');
			const circle = svg.locator('circle');
			await expect(circle).toHaveCount(1);
			await expect(circle).toBeVisible();
			await expect(svg.locator('path')).toHaveCount(0);
			await expect(svg).toContainText('売上: 10');

			const svgDownloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: /SVG ダウンロード/ }).click();
			const svgDownload = await svgDownloadPromise;
			const svgText = await readFile(await svgDownload.path(), 'utf-8');
			expect(
				await svg.evaluate((node, text) => {
					const container = document.createElement('div');
					container.innerHTML = text;
					return node.isEqualNode(container.querySelector('svg'));
				}, svgText),
			).toBe(true);

			const pngDownloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: /PNG ダウンロード/ }).click();
			const pngDownload = await pngDownloadPromise;
			const { data, info } = await sharp(
				await readFile(await pngDownload.path()),
			)
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			const width = Number(await svg.getAttribute('width'));
			const height = Number(await svg.getAttribute('height'));
			expect(info.width).toBe(width * 2);
			expect(info.height).toBe(height * 2);
			const cx = Number(await circle.getAttribute('cx'));
			const cy = Number(await circle.getAttribute('cy'));
			const radius = Number(await circle.getAttribute('r'));
			const fill = await circle.getAttribute('fill');
			expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
			const rgb = [1, 3, 5].map((i) =>
				Number.parseInt(fill?.slice(i, i + 2) ?? '', 16),
			);
			// 中心と円の四方で、PNGの塗りがプレビューの円と一致する。
			for (const [dx, dy] of [
				[0, 0],
				[0.6, 0],
				[-0.6, 0],
				[0, 0.6],
				[0, -0.6],
			]) {
				const x = Math.round((cx + radius * dx) * 2);
				const y = Math.round((cy + radius * dy) * 2);
				const offset = (y * info.width + x) * info.channels;
				expect([...data.subarray(offset, offset + 4)]).toEqual([...rgb, 255]);
			}
		},
	);
}

test('円グラフを2カテゴリ→絞り込みで1カテゴリ→2カテゴリへ切り替えられる（#573）', async ({
	page,
	createToolPage,
}) => {
	await createToolPage('csv-editor').goto();
	await page
		.getByRole('textbox')
		.first()
		.fill('カテゴリ,値\n売上,3\n売上,7\nその他,5');
	await page.getByRole('button', { name: 'パースして編集へ' }).click();
	const showPie = async () => {
		await page.getByRole('tab', { name: /グラフ/ }).click();
		await page.getByRole('tabpanel').getByRole('combobox').first().click();
		await page.getByRole('option', { name: '円グラフ', exact: true }).click();
	};
	const svg = page.getByRole('tabpanel').locator('svg[viewBox]:has(text)');
	await showPie();
	await expect(svg.locator('path')).toHaveCount(2);
	await expect(svg).toContainText('売上: 10');
	await expect(svg).toContainText('その他: 5');

	await page.getByRole('tab', { name: /絞込・ソート/ }).click();
	await page.getByRole('button', { name: /条件を追加/ }).click();
	await page.getByPlaceholder('値', { exact: true }).fill('売上');
	await showPie();
	await expect(svg.locator('circle')).toHaveCount(1);
	await expect(svg.locator('path')).toHaveCount(0);
	await expect(svg).toContainText('売上: 10');
	await expect(svg).not.toContainText('その他');

	await page.getByRole('tab', { name: /絞込・ソート/ }).click();
	await page.getByRole('button', { name: /条件をクリア/ }).click();
	await showPie();
	await expect(svg.locator('circle')).toHaveCount(0);
	await expect(svg.locator('path')).toHaveCount(2);
	await expect(svg).toContainText('売上: 10');
	await expect(svg).toContainText('その他: 5');
});

test('booleanのfalse条件とneq条件がテーブルとグラフに反映される（#574）', async ({
	page,
	createToolPage,
}) => {
	await createToolPage('csv-editor').goto();
	await page
		.getByRole('textbox')
		.first()
		.fill(
			'カテゴリ,値,有効\n合計,2,true\n合計,3,false\n合計,5,1\n合計,7,0\n合計,100,\n合計,1000,unknown',
		);
	await page.getByRole('button', { name: 'パースして編集へ' }).click();
	await page.getByRole('tab', { name: /絞込・ソート/ }).click();
	await page.getByRole('button', { name: /条件を追加/ }).click();
	await page.getByRole('tabpanel').getByRole('combobox').nth(1).click();
	await page
		.getByRole('option', { name: '有効 (boolean)', exact: true })
		.click();
	await page.getByPlaceholder('値', { exact: true }).fill('false');

	for (const { operator, values, sum } of [
		{ operator: '等しい', values: ['false', '0'], sum: '10' },
		{ operator: '等しくない', values: ['true', '1'], sum: '7' },
	]) {
		await page.getByRole('tab', { name: /絞込・ソート/ }).click();
		await page.getByRole('tabpanel').getByRole('combobox').nth(2).click();
		await page.getByRole('option', { name: operator, exact: true }).click();
		await page.getByRole('tab', { name: /テーブル/ }).click();
		await expect(page.locator('table tbody tr')).toHaveCount(2);
		const cells = page.locator('table tbody input[type="text"]');
		await expect(cells.nth(2)).toHaveValue(values[0]);
		await expect(cells.nth(5)).toHaveValue(values[1]);
		await page.getByRole('tab', { name: /グラフ/ }).click();
		await page.getByRole('tabpanel').getByRole('combobox').first().click();
		await page.getByRole('option', { name: '円グラフ', exact: true }).click();
		await expect(
			page
				.getByRole('tabpanel')
				.locator('svg')
				.filter({ has: page.locator('text') }),
		).toContainText(`合計: ${sum}`);
	}
});

for (const tabName of ['テキスト', 'テーブル', '絞込・ソート', 'グラフ']) {
	for (const failure of ['破損', '上限超過']) {
		test(`${tabName}でXLSXの${failure}が見え、編集とUndoを保持する（#580）`, async ({
			page,
			createToolPage,
		}) => {
			await createToolPage('csv-editor').goto();
			await page
				.getByRole('textbox')
				.first()
				.fill('商品,数量\nりんご,2\nみかん,3');
			await page.getByRole('button', { name: 'パースして編集へ' }).click();
			await page
				.locator('table tbody input[type="text"]')
				.first()
				.fill('りんご（編集）');
			const tab = page.getByRole('tab', { name: tabName, exact: true });
			await tab.click();

			await page.locator('input[type="file"]').setInputFiles({
				name: '読み込み失敗.xlsx',
				mimeType:
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				buffer:
					failure === '破損'
						? Buffer.from('破損XLSX')
						: Buffer.alloc(20 * 1024 * 1024 + 1),
			});
			const alert = page.getByRole('alert');
			await expect(alert).toBeVisible();
			await expect(alert).toContainText(
				failure === '破損'
					? 'ファイルが破損'
					: 'ファイルサイズが制限（20MB）を超えています',
			);
			await expect(alert).toContainText(
				'読み込みに失敗しました。表示中のデータは読み込み前のもので、編集内容は保持されています。',
			);
			await expect(tab).toHaveAttribute('data-state', 'active');

			await page.getByRole('tab', { name: 'テーブル', exact: true }).click();
			await expect(page.locator('table tbody tr')).toHaveCount(2);
			await expect(
				page.locator('table tbody input[type="text"]').first(),
			).toHaveValue('りんご（編集）');
			await page
				.getByRole('button', { name: '元に戻す (Undo)', exact: true })
				.click();
			await expect(
				page.locator('table tbody input[type="text"]').first(),
			).toHaveValue('りんご');

			// 次の正常な読み込みで、古いエラー表示は解消する。
			await page.locator('input[type="file"]').setInputFiles({
				name: '正常.csv',
				mimeType: 'text/csv',
				buffer: Buffer.from('商品,数量\nぶどう,4'),
			});
			await expect(alert).toHaveCount(0);
			await expect(
				page.locator('table tbody input[type="text"]').first(),
			).toHaveValue('ぶどう');
		});
	}
}

test('データ未読込のXLSXエラーでは旧データの案内を表示しない（#580）', async ({
	page,
	createToolPage,
}) => {
	await createToolPage('csv-editor').goto();
	await page.locator('input[type="file"]').setInputFiles({
		name: '破損.xlsx',
		mimeType:
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: Buffer.from('破損XLSX'),
	});
	await expect(page.getByRole('alert')).toContainText('ファイルが破損');
	await expect(page.getByRole('alert')).not.toContainText('表示中のデータ');
});
