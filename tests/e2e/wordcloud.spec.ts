import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/base';

test.describe('ワードクラウド生成 Tool', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();
		await toolPage.expectTitle('ワードクラウド生成');
		await toolPage.expectSafetyBadge();
	});

	test('テキスト入力からワードクラウドおよび頻度表が可視化されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();

		const input = page.getByLabel('解析対象テキスト');
		await input.fill('吾輩は猫である。名前はまだ無い。名前は猫である。');

		// 解析結果が表示されるまで待機（テーブル内の「猫」と「名前」が存在すること）
		await expect(page.getByRole('table')).toContainText('猫');
		await expect(page.getByRole('table')).toContainText('名前');
	});

	test('CSV / SVG / PNG エクスポートボタンが正常に動作すること', async ({
		page,
		createToolPage,
	}, testInfo) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();

		const input = page.getByLabel('解析対象テキスト');
		await input.fill('吾輩は猫である。名前はまだ無い。吾輩は猫である。');

		await expect(page.getByRole('table')).toContainText('猫');

		// CSVダウンロード検証
		const csvDownloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'CSV ダウンロード' }).click();
		const csvDownload = await csvDownloadPromise;
		expect(csvDownload.suggestedFilename()).toMatch(/^wordcloud-.*\.csv$/);

		const csvPath = path.join(os.tmpdir(), `test-${Date.now()}.csv`);
		await csvDownload.saveAs(csvPath);
		const csvContent = fs.readFileSync(csvPath, 'utf-8');
		expect(csvContent.startsWith('\uFEFF')).toBe(true);
		expect(csvContent).toContain('順位,単語,品詞,出現回数');
		fs.unlinkSync(csvPath);

		// SVGダウンロード検証
		const svgDownloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'SVG ダウンロード' }).click();
		const svgDownload = await svgDownloadPromise;
		expect(svgDownload.suggestedFilename()).toMatch(/^wordcloud-.*\.svg$/);

		const svgPath = path.join(os.tmpdir(), `test-${Date.now()}.svg`);
		await svgDownload.saveAs(svgPath);
		const svgContent = fs.readFileSync(svgPath, 'utf-8');
		expect(svgContent).toContain('<svg');
		expect(svgContent).toContain('猫');
		expect(svgContent).toContain('translate(400, 225)');
		fs.unlinkSync(svgPath);

		// 実際にPNGを保存し、寸法と文字の画素があることまで確認する。
		const pngDownloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'PNG ダウンロード' }).click();
		const pngDownload = await pngDownloadPromise;
		expect(pngDownload.suggestedFilename()).toMatch(/^wordcloud-.*\.png$/);
		const pngPath = testInfo.outputPath('wordcloud.png');
		await pngDownload.saveAs(pngPath);
		const png = fs.readFileSync(pngPath);
		expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		const image = await page.evaluate(async (base64) => {
			const response = await fetch(`data:image/png;base64,${base64}`);
			const bitmap = await createImageBitmap(await response.blob());
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvasを作成できません');
			ctx.drawImage(bitmap, 0, 0);
			const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			const hasText = pixels.some(
				(value, index) => index % 4 === 3 && value > 0,
			);
			bitmap.close();
			return { width: canvas.width, height: canvas.height, hasText };
		}, png.toString('base64'));
		expect(image).toEqual({ width: 800, height: 450, hasText: true });
	});

	for (const { label, angle } of [
		{ label: '横のみ (0°)', angle: 0 },
		{ label: '縦横 (0/90°)', angle: 90 },
		{ label: 'ランダム', angle: 30 },
	]) {
		test(`日本語長文を枠内に描画して再解析できる (${label})`, async ({
			page,
			createToolPage,
		}, testInfo) => {
			// 回転角度を再現できるよう、ブラウザfixtureの乱数を固定する。
			await page.addInitScript(() => {
				Math.random = () => 0.75;
			});
			await createToolPage('wordcloud').goto();
			await page.getByLabel('最大表示語数').click();
			await page.getByRole('option', { name: '200語', exact: true }).click();
			await page.getByLabel('回転角度').click();
			await page.getByRole('option', { name: label, exact: true }).click();
			await page.evaluate(() => document.fonts.ready);
			const text = [
				'春の公園では猫と犬が遊び、桜の花が咲いています。',
				'夏の海では魚が泳ぎ、秋の山では鳥が歌います。',
				'冬の図書館では子供が本を読み、学校では先生が音楽と科学を教えます。',
				'家族と友達は野菜と果物を買い、食卓で料理と旅行の話をします。',
			]
				.join('')
				.repeat(30);
			const input = page.getByLabel('解析対象テキスト');
			const svg = page.getByTestId('wordcloud-canvas').locator('svg');
			await input.fill(text);
			await expect(svg).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'PNG ダウンロード' }),
			).toBeEnabled();
			await page.evaluate(() => document.fonts.ready);
			const first = await svg.innerHTML();
			const rendered = await svg.locator('text').evaluateAll((elements) => {
				return elements.map((element) => {
					const text = element as SVGGraphicsElement;
					const box = text.getBBox();
					const matrix = text.getCTM();
					const rootMatrix = text.ownerSVGElement?.getCTM();
					if (!matrix || !rootMatrix)
						throw new Error('SVGの変換行列がありません');
					// モバイルでの表示倍率を除き、800×450のviewBox座標で判定する。
					const toViewBox = rootMatrix.inverse().multiply(matrix);
					const corners = [
						[box.x, box.y],
						[box.x + box.width, box.y],
						[box.x, box.y + box.height],
						[box.x + box.width, box.y + box.height],
					].map(([x, y]) => new DOMPoint(x, y).matrixTransform(toViewBox));
					return {
						text: text.textContent,
						transform: text.getAttribute('transform'),
						width: box.width,
						height: box.height,
						x0: Math.min(...corners.map((p) => p.x)),
						y0: Math.min(...corners.map((p) => p.y)),
						x1: Math.max(...corners.map((p) => p.x)),
						y1: Math.max(...corners.map((p) => p.y)),
					};
				});
			});
			expect(rendered.length).toBeGreaterThan(10);
			expect(rendered.length).toBeLessThanOrEqual(200);
			for (const word of rendered) {
				expect(word.text).toBeTruthy();
				expect(word.transform).toContain(`rotate(${angle})`);
				expect(word.width).toBeGreaterThan(0);
				expect(word.height).toBeGreaterThan(0);
				// getBBoxのfont boxと実際のインク境界の差は1pxまで許容する。
				expect(word.x0, word.text ?? '').toBeGreaterThanOrEqual(-1);
				expect(word.y0, word.text ?? '').toBeGreaterThanOrEqual(-1);
				expect(word.x1, word.text ?? '').toBeLessThanOrEqual(801);
				expect(word.y1, word.text ?? '').toBeLessThanOrEqual(451);
			}
			await svg.screenshot({ path: testInfo.outputPath('wordcloud.png') });
			await input.fill('');
			await expect(svg).toHaveCount(0);
			await input.fill(text);
			await expect(svg).toBeVisible();
			expect(await svg.innerHTML()).toBe(first);
		});
	}

	test('200語の解析結果でも配置できた単語を表示する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('wordcloud').goto();
		await page.getByLabel('最大表示語数').click();
		await page.getByRole('option', { name: '200語', exact: true }).click();
		await page.getByLabel('回転角度').click();
		await page
			.getByRole('option', { name: '横のみ (0°)', exact: true })
			.click();
		// 漢字を句点で分けて200種類以上を解析に渡す（解析Workerも実物を使う）。
		const text = Array.from({ length: 220 }, (_, i) =>
			String.fromCharCode(0x4e00 + i),
		).join('。');
		await page.getByLabel('解析対象テキスト').fill(`${text}。${text}。`);
		await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(200);
		const words = page.getByTestId('wordcloud-canvas').locator('svg text');
		await expect(words.first()).toBeVisible();
		expect(await words.count()).toBeLessThanOrEqual(200);
		await expect(
			page.getByRole('button', { name: 'PNG ダウンロード' }),
		).toBeEnabled();
	});

	test('レスポンシブ表示（375px / 1440px）', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('wordcloud');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('解析対象テキスト')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('解析対象テキスト')).toBeVisible();
	});
});
