import path from 'node:path';
import { expect, test } from './fixtures/base.ts';

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

/** 計算自体は本物を使い、次のSHA-256の完了だけを明示的に保留する。 */
async function pauseNextSha256(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const digest = crypto.subtle.digest.bind(crypto.subtle);
		crypto.subtle.digest = async (algorithm, data) => {
			const result = await digest(algorithm, data);
			if (algorithm === 'SHA-256') {
				crypto.subtle.digest = digest;
				document.documentElement.dataset.hashPaused = 'true';
				await new Promise<void>((resolve) => {
					window.addEventListener('resume-hash', () => resolve(), {
						once: true,
					});
				});
			}
			return result;
		};
	});
}

async function resumeHash(page: import('@playwright/test').Page) {
	await page.evaluate(async () => {
		window.dispatchEvent(new Event('resume-hash'));
		// Promiseの継続とReactの描画が済んでから、古い結果の混入を確認する。
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	});
}

test.describe('Hash Generator Tool', () => {
	for (const text of ['', 'abc']) {
		test(`ファイル→テキスト（${text || '空欄'}）→ファイルで結果と照合が復帰する`, async ({
			page,
			createToolPage,
		}) => {
			await createToolPage('hash').goto();
			await page.getByRole('tab', { name: 'ファイル' }).click();
			await page.getByTestId('hash-file-input').setInputFiles(FIXTURE.path);
			const result = page.getByTestId('hash-result-sha256');
			const verdict = page.getByTestId('hash-verify-result');
			await expect(result).toContainText(FIXTURE.sha256);
			await page
				.getByLabel('期待値との照合', { exact: false })
				.fill(FIXTURE.sha256);
			await expect(verdict).toHaveText('一致（SHA-256）');

			await page.getByRole('tab', { name: 'テキスト' }).click();
			await page.getByLabel('ハッシュ計算するテキスト').fill(text);
			if (text) {
				await expect(result).toContainText(ABC_SHA256);
				await expect(verdict).toHaveText('不一致（SHA-256）');
			} else {
				await expect(result).not.toContainText(FIXTURE.sha256);
				await expect(verdict).toContainText('計算結果を待っています');
			}

			await page.getByRole('tab', { name: 'ファイル' }).click();
			await expect(
				page.getByTitle('hash-sample.txt', { exact: true }),
			).toBeVisible();
			await expect(result).toContainText(FIXTURE.sha256);
			await expect(verdict).toHaveText('一致（SHA-256）');
			await page.getByRole('button', { name: '選択をクリア' }).click();
			await expect(result).not.toContainText(FIXTURE.sha256);
			await expect(verdict).toContainText('計算結果を待っています');
			await page.getByRole('tab', { name: 'テキスト' }).click();
			await page.getByRole('tab', { name: 'ファイル' }).click();
			await expect(
				page.getByTitle('hash-sample.txt', { exact: true }),
			).toHaveCount(0);
			await expect(result).toContainText('—');
		});
	}

	test('計算中のファイルからテキストへ切り替えても古い結果が混ざらず、ファイルへ復帰できる', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('hash').goto();
		await pauseNextSha256(page);
		await page.getByRole('tab', { name: 'ファイル' }).click();
		await page.getByTestId('hash-file-input').setInputFiles(FIXTURE.path);
		await expect(page.locator('html')).toHaveAttribute(
			'data-hash-paused',
			'true',
		);
		await page.getByRole('tab', { name: 'テキスト' }).click();
		await page.getByLabel('ハッシュ計算するテキスト').fill('abc');
		const result = page.getByTestId('hash-result-sha256');
		await expect(result).toContainText(ABC_SHA256);
		await resumeHash(page);
		await expect(result).toContainText(ABC_SHA256);
		await page.getByRole('tab', { name: 'ファイル' }).click();
		await expect(result).toContainText(FIXTURE.sha256);
	});

	test('テキスト計算中にファイルへ戻っても、遅れて完了したテキスト結果が混ざらない', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('hash').goto();
		await page.getByRole('tab', { name: 'ファイル' }).click();
		await page.getByTestId('hash-file-input').setInputFiles(FIXTURE.path);
		const result = page.getByTestId('hash-result-sha256');
		await expect(result).toContainText(FIXTURE.sha256);
		await pauseNextSha256(page);
		await page.getByRole('tab', { name: 'テキスト' }).click();
		await page.getByLabel('ハッシュ計算するテキスト').fill('abc');
		await expect(page.locator('html')).toHaveAttribute(
			'data-hash-paused',
			'true',
		);
		await page.getByRole('tab', { name: 'ファイル' }).click();
		await expect(result).toContainText(FIXTURE.sha256);
		await resumeHash(page);
		await expect(result).toContainText(FIXTURE.sha256);
	});

	test('計算中のファイルを解除すると、完了後も結果と照合は復活しない', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('hash').goto();
		await pauseNextSha256(page);
		await page.getByRole('tab', { name: 'ファイル' }).click();
		await page.getByTestId('hash-file-input').setInputFiles(FIXTURE.path);
		await page
			.getByLabel('期待値との照合', { exact: false })
			.fill(FIXTURE.sha256);
		await expect(page.locator('html')).toHaveAttribute(
			'data-hash-paused',
			'true',
		);
		await page.getByRole('button', { name: '選択をクリア' }).click();
		await resumeHash(page);
		await expect(page.getByTestId('hash-result-sha256')).toContainText('—');
		await expect(page.getByTestId('hash-verify-result')).toContainText(
			'計算結果を待っています',
		);
		await expect(page.getByRole('progressbar')).toHaveCount(0);
	});

	test('ページが正しく表示されること', async ({ page, createToolPage }) => {
		const toolPage = createToolPage('hash');
		await toolPage.goto();
		await expect(page).toHaveTitle(
			'ハッシュ値計算・確認・照合ツール｜SHA-256・MD5対応 | CODE:LIFE Tools',
		);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'ハッシュ値計算・確認ツール',
		);
		await expect(
			page
				.getByRole('navigation', { name: 'パンくずリスト' })
				.locator('[aria-current="page"]'),
		).toHaveText('ハッシュ値計算・確認ツール');
		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			'content',
			'ファイルやテキストのハッシュ値を計算・確認できる無料ツール。SHA-256・MD5・SHA-1・SHA-512・CRC32に対応し、配布元のハッシュ値と照合できます。秘密鍵を使うHMAC（HMAC-SHA256など）も計算できます。入力内容やファイルは外部に送信せず、ブラウザ内で処理します。',
		);
		await toolPage.expectSafetyBadge();
	});

	test('用途・FAQとJSON-LDがパスワード保存と照合の限界を説明すること', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('hash').goto();
		const useCases = page.getByRole('region', {
			name: 'こんなお困りごと・シーンでお使いいただけます',
		});
		await expect(useCases).not.toContainText('パスワード');
		await expect(useCases).not.toContainText('完全に同一');

		const faq = page.getByRole('region', { name: 'よくある質問 (FAQ)' });
		await expect(faq).toContainText(
			'パスワード保存専用の処理には対応していません',
		);
		await expect(faq).toContainText('パスワード保存には適しません');
		await expect(faq).toContainText('Argon2id');
		await expect(faq).toContainText('ソルトや計算コスト');
		await expect(faq).toContainText('安全性や配布元の真正性は保証できません');
		await expect(faq).toContainText('信頼できる配布元');
		await expect(faq).toContainText('ファイルと期待値の両方が置き換えられると');
		await expect(faq).not.toContainText('セキュリティ目的のハッシュ化');

		const howto = page.getByRole('region', { name: '使い方・手順' });
		await expect(howto).toContainText('配布元と同じアルゴリズム');
		await expect(howto).toContainText('「期待値との照合」欄');
		// HMAC（#472）: FAQ・使い方に説明があり、下の FAQPage 構造化データとも一致する
		await expect(faq).toContainText('HMACは、秘密鍵とメッセージを組み合わせて');
		await expect(faq).toContainText('外部へ送信・保存しません');
		await expect(howto).toContainText('「HMAC（鍵付きハッシュ）を計算」欄');

		const visibleAnswers = (await faq.locator('dd').allTextContents()).map(
			(answer) => answer.trim(),
		);
		const structuredAnswers = await page
			.locator('script[type="application/ld+json"]')
			.evaluateAll((scripts) => {
				type SchemaNode = {
					'@type': string;
					mainEntity?: { acceptedAnswer: { text: string } }[];
				};
				return scripts.flatMap((script) => {
					const data = JSON.parse(script.textContent ?? '{}') as {
						'@graph'?: SchemaNode[];
					};
					return (data['@graph'] ?? [])
						.filter((node) => node['@type'] === 'FAQPage')
						.flatMap((node) =>
							(node.mainEntity ?? []).map((item) => item.acceptedAnswer.text),
						);
				});
			});
		expect(structuredAnswers).toEqual(visibleAnswers);
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

	test('期待値照合: GNU形式のチェックサム行を貼り付けて照合できる', async ({
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
		const extracted = page.getByTestId('hash-verify-extracted');

		// テキストモード（空白2個）: 一致し、抽出値とファイル名が表示される
		await expectedInput.fill(`${ABC_SHA256}  sample.txt\n`);
		await expect(verifyResult).toContainText('一致');
		await expect(verifyResult).not.toContainText('不一致');
		await expect(extracted).toContainText(ABC_SHA256);
		await expect(extracted).toContainText('SHA-256');
		await expect(extracted).toContainText('sample.txt');

		// バイナリモード（空白＋*）
		await expectedInput.fill(`${ABC_SHA256} *sample.txt`);
		await expect(verifyResult).toContainText('一致');

		// 値を変更すると不一致
		await expectedInput.fill(`${ABC_SHA256.slice(0, 63)}0  sample.txt`);
		await expect(verifyResult).toContainText('不一致');

		// ファイル名はエスケープされテキストとして表示される
		await expectedInput.fill(`${ABC_SHA256}  <b>x</b>.txt`);
		await expect(extracted).toContainText('<b>x</b>.txt');
		await expect(extracted.locator('b')).toHaveCount(0);

		// 複数行は成功扱いにしない
		await expectedInput.fill(`${ABC_SHA256}  a.txt\n${ABC_SHA256}  b.txt`);
		await expect(verifyResult).toContainText('複数行は照合できません');
		await expect(verifyResult).not.toContainText('一致');
		await expect(extracted).toHaveCount(0);

		// 不完全な行は拒否
		await expectedInput.fill(`${ABC_SHA256} sample.txt`);
		await expect(verifyResult).toContainText('形式が正しくありません');
		await expect(extracted).toHaveCount(0);
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
	test.describe('HMAC（鍵付きハッシュ）', () => {
		// RFC 4231 Test Case 2（鍵 "Jefe"）
		const MESSAGE = 'what do ya want for nothing?';
		const SHA256_HEX =
			'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
		const SHA256_BASE64 = 'W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=';
		const SHA512_HEX =
			'164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737';

		test('既知のテストベクタを16進数とBase64で表示し、アルゴリズムと鍵の形式を切り替えられる', async ({
			page,
			createToolPage,
		}) => {
			await createToolPage('hash').goto();
			const panel = page.getByTestId('hmac-panel');
			const hex = panel.getByTestId('hmac-result-hex');
			const base64 = panel.getByTestId('hmac-result-base64');

			await panel.getByLabel('メッセージ').fill(MESSAGE);
			await panel.getByLabel('秘密鍵').fill('Jefe');
			await expect(hex).toContainText(SHA256_HEX);
			await expect(hex).toContainText('HMAC-SHA256');
			await expect(base64).toContainText(SHA256_BASE64);

			await panel.getByRole('combobox', { name: 'アルゴリズム' }).click();
			await page.getByRole('option', { name: 'HMAC-SHA512' }).click();
			await expect(hex).toContainText(SHA512_HEX);
			await expect(hex).toContainText('HMAC-SHA512');

			// 同じ鍵を16進数で入力しても結果は同じ（"Jefe" = 4a656665）
			await panel.getByRole('combobox', { name: '鍵の形式' }).click();
			await page.getByRole('option', { name: '16進数' }).click();
			await panel.getByLabel('秘密鍵').fill('4a656665');
			await expect(hex).toContainText(SHA512_HEX);

			// 上のハッシュ計算の入力とは独立している
			await expect(page.getByTestId('hash-result-sha256')).toContainText('—');
		});

		test('不正な16進数の鍵はエラーを表示し、結果を出さない', async ({
			page,
			createToolPage,
		}) => {
			await createToolPage('hash').goto();
			const panel = page.getByTestId('hmac-panel');
			await panel.getByRole('combobox', { name: '鍵の形式' }).click();
			await page.getByRole('option', { name: '16進数' }).click();
			await panel.getByLabel('メッセージ').fill(MESSAGE);
			await panel.getByLabel('秘密鍵').fill('abc');

			await expect(panel.getByTestId('hmac-key-error')).toContainText('偶数桁');
			await expect(panel.getByLabel('秘密鍵')).toHaveAttribute(
				'aria-invalid',
				'true',
			);
			await expect(panel.getByTestId('hmac-result-hex')).not.toContainText(
				/[0-9a-f]{40}/,
			);

			await panel.getByLabel('秘密鍵').fill('4a656665');
			await expect(panel.getByTestId('hmac-key-error')).toHaveCount(0);
			await expect(panel.getByTestId('hmac-result-hex')).toContainText(
				SHA256_HEX,
			);
		});

		test('鍵とメッセージをURL・localStorageに保存しない', async ({
			page,
			createToolPage,
		}) => {
			await createToolPage('hash').goto();
			const panel = page.getByTestId('hmac-panel');
			const secret = 'super-secret-key-12345';
			await panel.getByLabel('メッセージ').fill('秘密のメッセージ');
			await panel.getByLabel('秘密鍵').fill(secret);
			await expect(panel.getByTestId('hmac-result-hex')).toContainText(
				/[0-9a-f]{64}/,
			);

			expect(page.url()).not.toContain(secret);
			const stored = await page.evaluate(() =>
				JSON.stringify({ ...localStorage, ...sessionStorage }),
			);
			expect(stored).not.toContain(secret);
			expect(stored).not.toContain('秘密のメッセージ');
		});

		for (const width of [375, 1440]) {
			test(`${width}px で横にはみ出さない`, async ({
				page,
				createToolPage,
			}) => {
				await page.setViewportSize({ width, height: 900 });
				await createToolPage('hash').goto();
				const panel = page.getByTestId('hmac-panel');
				await panel.getByLabel('メッセージ').fill(MESSAGE);
				await panel.getByLabel('秘密鍵').fill('Jefe');
				await expect(panel.getByTestId('hmac-result-hex')).toContainText(
					SHA256_HEX,
				);
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
});
