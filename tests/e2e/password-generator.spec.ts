import { expect, test } from './fixtures/base';

const AMBIGUOUS = /[0Oo1lI|]/;

test.describe('パスワード生成', () => {
	test('初期表示で既定の設定（16文字・4文字種・5件）のパスワードを生成する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('password-generator').goto();
		await expect(page.locator('h1')).toContainText('パスワード生成');
		const items = page.getByTestId('password-result-list').locator('li > span');
		await expect(items).toHaveCount(5);
		for (const text of await items.allTextContents()) {
			expect(text).toHaveLength(16);
			expect(text).toMatch(/[A-Z]/);
			expect(text).toMatch(/[a-z]/);
			expect(text).toMatch(/[0-9]/);
			expect(text).toMatch(/[!-/:-@[-`{-~]/);
		}
		await expect(page.getByTestId('generate-entropy')).toContainText(
			'約104ビット',
		);
	});

	test('長さ・件数・文字種・紛らわしい文字の除外を反映する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('password-generator').goto();
		await page.getByLabel(/長さ/).fill('8');
		await page.getByLabel(/生成件数/).fill('3');
		await page.getByLabel('記号（!#$%など）').click();
		await page.getByLabel(/紛らわしい文字/).click();
		await page.getByRole('button', { name: '生成する' }).click();

		const items = page.getByTestId('password-result-list').locator('li > span');
		await expect(items).toHaveCount(3);
		for (const text of await items.allTextContents()) {
			expect(text).toMatch(/^[A-Za-z0-9]{8}$/);
			expect(text).not.toMatch(AMBIGUOUS);
		}
		await expect(page.getByText('生成結果（3件）')).toBeVisible();
	});

	test('文字種を0個にするとエラーを出し、生成ボタンを無効にする', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('password-generator').goto();
		for (const label of [
			'英大文字（A-Z）',
			'英小文字（a-z）',
			'数字（0-9）',
			'記号（!#$%など）',
		]) {
			await page.getByLabel(label).click();
		}
		await expect(page.getByRole('alert')).toContainText(
			'使う文字の種類を1つ以上選んでください。',
		);
		await expect(page.getByRole('button', { name: '生成する' })).toBeDisabled();
	});

	test('範囲外の長さはエラーを出す', async ({ page, createToolPage }) => {
		await createToolPage('password-generator').goto();
		await page.getByLabel(/長さ/).fill('129');
		await expect(page.getByRole('alert')).toContainText('長さは4〜128');
		await expect(page.getByRole('button', { name: '生成する' })).toBeDisabled();
		await expect(page.getByLabel(/長さ/)).toHaveAttribute(
			'aria-invalid',
			'true',
		);
	});

	test('設定値は再読み込み後も復元され、パスワードは保存しない', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('password-generator');
		await toolPage.goto();
		await page.getByLabel(/長さ/).fill('24');
		await page.getByRole('button', { name: '生成する' }).click();
		const items = page.getByTestId('password-result-list').locator('li > span');
		await expect(items.first()).toHaveText(/^.{24}$/);
		const generated = await items.allTextContents();

		const stored = await page.evaluate(() =>
			JSON.stringify({ ...localStorage, ...sessionStorage }),
		);
		for (const password of generated) {
			expect(stored).not.toContain(password);
			expect(page.url()).not.toContain(encodeURIComponent(password));
		}

		await page.reload();
		await expect(page.getByLabel(/長さ/)).toHaveValue('24');
		await expect(items.first()).toHaveText(/^.{24}$/);
	});
});

test.describe('強度チェック', () => {
	test('よく使われるパスワードは「とても弱い」と警告を表示する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('password-generator').goto();
		await page.getByLabel('確認するパスワード').fill('Password1');
		const result = page.getByTestId('strength-result');
		await expect(result).toContainText('とても弱い');
		await expect(result).toContainText('よく使われるパスワードと一致します');
		await expect(result).toHaveAttribute('aria-live', 'polite');
	});

	test('長いランダムな文字列は「とても強い」を表示する', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('password-generator').goto();
		await page
			.getByLabel('確認するパスワード')
			.fill('t7#Kq!2vZp@9mW$4xR&8nB^3cY*6hJ%1');
		const result = page.getByTestId('strength-result');
		await expect(result).toContainText('とても強い');
		await expect(result).toContainText('32文字');
	});

	test('入力欄は既定で伏せ字にし、ボタンで表示を切り替える', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('password-generator').goto();
		const input = page.getByLabel('確認するパスワード');
		await expect(input).toHaveAttribute('type', 'password');
		const toggle = page.getByRole('button', { name: 'パスワードを表示' });
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await toggle.click();
		await expect(input).toHaveAttribute('type', 'text');
		await expect(
			page.getByRole('button', { name: 'パスワードを隠す' }),
		).toHaveAttribute('aria-pressed', 'true');
	});
});

test.describe('プライバシー', () => {
	test('入力・生成したパスワードは計測・保存に入らず、tool_run は生成ボタンでだけ送る', async ({
		page,
		createToolPage,
	}) => {
		const bodies: string[] = [];
		await page.route('**/api/event', async (route) => {
			bodies.push(route.request().postData() ?? '');
			await route.fulfill({ status: 204 });
		});
		await createToolPage('password-generator').goto();
		const secret = 'Kq7#zP9!mW2$';
		await page.getByLabel('確認するパスワード').fill(secret);
		await expect(page.getByTestId('strength-result')).toContainText(
			'強度の目安',
		);
		// 初期表示の生成と強度チェックでは tool_run を送らない
		await page.waitForTimeout(800);
		expect(bodies.filter((b) => b.includes('"tool_run"'))).toEqual([]);

		await page.getByRole('button', { name: '生成する' }).click();
		await expect
			.poll(() => bodies.filter((b) => b.includes('"tool_run"')).length)
			.toBe(1);
		const generated = await page
			.getByTestId('password-result-list')
			.locator('li > span')
			.allTextContents();

		const stored = await page.evaluate(() =>
			JSON.stringify({ ...localStorage, ...sessionStorage }),
		);
		for (const value of [secret, ...generated]) {
			expect(stored).not.toContain(value);
			expect(page.url()).not.toContain(value);
			for (const body of bodies) expect(body).not.toContain(value);
		}
		const run = JSON.parse(
			bodies.find((b) => b.includes('"tool_run"')) ?? '{}',
		) as { props?: Record<string, unknown> };
		expect(run.props?.tool).toBe('password-generator');
	});
});

test.describe('レスポンシブ', () => {
	for (const width of [375, 1440]) {
		test(`${width}px で128文字を生成しても横にはみ出さない`, async ({
			page,
			createToolPage,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await createToolPage('password-generator').goto();
			await page.getByLabel(/長さ/).fill('128');
			await page.getByRole('button', { name: '生成する' }).click();
			await expect(
				page.getByTestId('password-result-list').locator('li > span').first(),
			).toHaveText(/^.{128}$/);
			await page.getByLabel('確認するパスワード').fill(`${'x'.repeat(40)}Y7#`);
			await expect
				.poll(() =>
					page.evaluate(
						() => document.documentElement.scrollWidth <= window.innerWidth,
					),
				)
				.toBe(true);
		});
	}
});
