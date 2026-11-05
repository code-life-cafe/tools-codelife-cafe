import { expect, test } from './fixtures/base.ts';

test.describe('ブックマークレット変換ツール（JS ⇔ Bookmarklet）', () => {
	test('ページが正しく表示されること', async ({ createToolPage }) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();
		await toolPage.expectTitle(
			'ブックマークレット変換ツール（JS ⇔ Bookmarklet） | CODE:LIFE Tools',
		);
		await toolPage.expectSafetyBadge();
	});

	test('JavaScriptを入力すると自動でBookmarkletにエンコードされること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.getByLabel('JavaScript 入力').fill("alert('hello')");
		await expect(page.getByLabel('Bookmarklet 出力')).toHaveValue(
			/^javascript:/,
		);
		await expect(page.getByLabel('Bookmarklet 出力')).toContainText(
			/hello|hello%27|alert/,
		);
	});

	test('javascript:の入力は自動でDecodeされ整形済みJSが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		// ページ読込直後は入力が空のためEncode扱い（ラベルはJavaScript入力）。
		// javascript:プレフィックスによる自動判定でDecodeに切り替わり、ラベルもBookmarklet入力に変わることを確認する。
		const encoded = encodeURIComponent('if(a){alert(1);}');
		await page.getByLabel('JavaScript 入力').fill(`javascript:${encoded}`);

		await expect(page.getByLabel('Bookmarklet 入力')).toHaveValue(
			`javascript:${encoded}`,
		);
		await expect(page.getByLabel('JavaScript 出力')).toHaveValue(
			'if(a){\n  alert(1);\n}',
		);
	});

	test('方向を手動でEncode/Decodeに切り替えられること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換方向' }).click();
		await page.getByRole('option', { name: 'Decode', exact: true }).click();
		await expect(page.getByLabel('Bookmarklet 入力')).toBeVisible();

		await page.getByRole('combobox', { name: '変換方向' }).click();
		await page.getByRole('option', { name: 'Encode', exact: true }).click();
		await expect(page.getByLabel('JavaScript 入力')).toBeVisible();
	});

	test('IIFEラップ・Minifyオプションが出力に反映されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.getByLabel('JavaScript 入力').fill('alert(1); // comment');

		const output = page.getByLabel('Bookmarklet 出力');
		// IIFEラップON（デフォルト）+ Minify OFF（デフォルト）: コメントはURIエンコード後も英数字のまま残る
		await expect(output).toHaveValue(/comment/);

		// Minify ON: コメントが除去される
		await page.getByRole('switch', { name: 'Minify' }).click();
		await expect(output).not.toHaveValue(/comment/);
		const encoded = await output.inputValue();
		const decoded = decodeURIComponent(encoded.replace('javascript:', ''));
		expect(decoded.startsWith('(() => {')).toBe(true);

		// IIFEラップOFF
		await page.getByRole('switch', { name: 'IIFEラップ' }).click();
		await expect(output).not.toHaveValue(encoded);
		const encoded2 = await output.inputValue();
		const decoded2 = decodeURIComponent(encoded2.replace('javascript:', ''));
		expect(decoded2.startsWith('(() => {')).toBe(false);
	});

	test('外部スクリプト挿入が動作すること', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.getByLabel('JavaScript 入力').fill('alert(1)');
		const output = page.getByLabel('Bookmarklet 出力');
		await expect(output).toHaveValue(/^javascript:/);
		const before = await output.inputValue();

		await page
			.getByLabel('外部スクリプトURL（任意）')
			.fill('https://example.com/a.js');
		await expect(output).not.toHaveValue(before);

		const encoded = await output.inputValue();
		const decoded = decodeURIComponent(encoded.replace('javascript:', ''));
		expect(decoded).toContain("document.createElement('script')");
		expect(decoded).toContain('s.src="https://example.com/a.js"');
	});

	test('ドラッグ用リンクのhrefと転送内容が最新の出力と一致すること（#588）', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('bookmarklet').goto();
		const output = page.getByLabel('Bookmarklet 出力');
		const dragLink = page.getByRole('link', { name: /ブックマークに追加/ });

		for (const source of ["alert('最初')", "alert('更新後')"]) {
			await page.getByLabel('JavaScript 入力').fill(source);
			const expected = `javascript:${encodeURIComponent(`(() => {\n${source}\n})();`)}`;
			await expect(output).toHaveValue(expected);
			await expect(dragLink).toBeVisible();
			await expect(dragLink).toHaveAttribute('href', expected);
			expect(
				await dragLink.evaluate((link) => (link as HTMLAnchorElement).href),
			).toBe(expected);
			await expect(dragLink).toHaveAttribute('draggable', 'true');

			const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
			try {
				await dragLink.dispatchEvent('dragstart', { dataTransfer });
				expect(
					await dataTransfer.evaluate((data) => ({
						uri: data.getData('text/uri-list'),
						text: data.getData('text/plain'),
					})),
				).toEqual({ uri: expected, text: expected });
			} finally {
				await dataTransfer.dispose();
			}
		}

		await page.getByRole('button', { name: 'クリア', exact: true }).click();
		await expect(dragLink).toHaveCount(0);
	});

	test('生成・ドラッグ・クリック・Enterで利用者コードを実行しないこと（#588）', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('bookmarklet').goto();
		const source =
			'document.documentElement.dataset.bookmarkletExecuted = "yes";';
		await page.getByLabel('JavaScript 入力').fill(source);
		const expected = `javascript:${encodeURIComponent(`(() => {\n${source}\n})();`)}`;
		await expect(page.getByLabel('Bookmarklet 出力')).toHaveValue(expected);
		const dragLink = page.getByRole('link', { name: /ブックマークに追加/ });
		const root = page.locator('html');
		await expect(root).not.toHaveAttribute('data-bookmarklet-executed', 'yes');

		const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
		try {
			await dragLink.dispatchEvent('dragstart', { dataTransfer });
		} finally {
			await dataTransfer.dispose();
		}
		await dragLink.click();
		await dragLink.focus();
		await dragLink.press('Enter');
		await dragLink.click({ button: 'middle' });

		// CSPによるブロックだけで成功しないよう、イベントの既定動作防止も検証する。
		expect(
			await dragLink.evaluate((link) =>
				['click', 'auxclick'].map((type) => {
					const event = new MouseEvent(type, {
						bubbles: true,
						cancelable: true,
						button: type === 'auxclick' ? 1 : 0,
					});
					link.dispatchEvent(event);
					return event.defaultPrevented;
				}),
			),
		).toEqual([true, true]);
		await expect(root).not.toHaveAttribute('data-bookmarklet-executed', 'yes');
	});

	test('MinifyのON/OFFでASIの改行と行コメント境界を保持すること（#589）', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('bookmarklet').goto();
		const source =
			'const first = 1 // コメント\nconst second = 2\nalert(first + second)';
		await page.getByLabel('JavaScript 入力').fill(source);
		const output = page.getByLabel('Bookmarklet 出力');
		await expect(output).toHaveValue(/%E3%82%B3/);
		const original = await output.inputValue();

		await page.getByRole('switch', { name: 'Minify' }).click();
		await expect(output).not.toHaveValue(original);
		const decoded = decodeURIComponent(
			(await output.inputValue()).slice('javascript:'.length),
		);
		expect(decoded).toContain('const first = 1\nconst second = 2\nalert');
		expect(decoded).not.toContain('コメント');

		await page.getByRole('switch', { name: 'Minify' }).click();
		await expect(output).toHaveValue(original);
	});

	test('不正なURIエンコードでエラーが表示されること', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.getByRole('combobox', { name: '変換方向' }).click();
		await page.getByRole('option', { name: 'Decode', exact: true }).click();

		await page.getByLabel('Bookmarklet 入力').fill('javascript:%E0%A4%A');
		const error = page.getByTestId('bookmarklet-error');
		await expect(error).toContainText('不正');
	});

	test('サンプル読込: ダークモード切替', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.getByRole('combobox', { name: 'サンプルを読み込み' }).click();
		await page.getByRole('option', { name: 'ダークモード切替' }).click();

		await expect(page.getByLabel('JavaScript 入力')).toHaveValue(/invert\(1\)/);
		await expect(page.getByLabel('Bookmarklet 出力')).toHaveValue(
			/^javascript:/,
		);
	});

	test('コピーが動作すること', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.getByLabel('JavaScript 入力').fill('alert(1)');
		await expect(page.getByLabel('Bookmarklet 出力')).toHaveValue(
			/^javascript:/,
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
		const toolPage = createToolPage('bookmarklet');
		await toolPage.goto();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByLabel('JavaScript 入力')).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByLabel('JavaScript 入力')).toBeVisible();
	});
});
