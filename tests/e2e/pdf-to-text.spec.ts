import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	PDFArray,
	PDFDocument,
	PDFName,
	PDFNumber,
	PDFString,
	StandardFonts,
} from 'pdf-lib';
import { expect, test } from './fixtures/base';
import {
	blankPdf,
	ENCRYPTED_PDF,
	extractText,
	fixturePath,
	readDownload,
	recordRequests,
	storageSnapshot,
} from './helpers/pdf-expansion';

type Page = import('@playwright/test').Page;

const fileInput = (page: Page) => page.locator('input[type="file"]');
const runButton = (page: Page) =>
	page.getByRole('button', { name: 'テキストを抽出' });
const output = (page: Page) => page.getByTestId('pdf-to-text-output');
const heading = (n: number) => `--- ${n}ページ目 ---`;

async function upload(page: Page, name: string, pages: number) {
	await fileInput(page).setInputFiles(fixturePath(name));
	await expect(page.getByTestId('pdf-to-text-info')).toContainText(
		`全${pages}ページ`,
	);
}

/** 独立した期待値: text-ja.pdf の各ページ（生成スクリプトの文言から組み立てる） */
const textJaPage = (n: number) =>
	[
		'日本語テキストの抽出確認',
		`Page ${n} - Hello PDF link`,
		...Array.from(
			{ length: 24 },
			(_, row) => `圧縮テスト用の本文です。行番号${row + 1}`,
		),
	].join('\n');

async function setHeadings(page: Page, on: boolean) {
	const toggle = page.getByRole('switch', {
		name: 'ページ区切りの見出しを入れる',
	});
	if (((await toggle.getAttribute('aria-checked')) === 'true') !== on) {
		await toggle.click();
	}
}

async function extractAll(page: Page, name: string, pages: number) {
	await upload(page, name, pages);
	await runButton(page).click();
	await expect(page.getByTestId('pdf-to-text-results')).toBeVisible();
}

/**
 * ページ内に収まる複数行のテキストPDF（pdf-libで生成）。ページ外へはみ出した文字はPDF.jsが取り出さないため、
 * 1ページ lines 行 × 各 lineLen 文字を size 1 で描く。1ページの抽出文字数は lines*lineLen + (lines-1)（行間のLF）。
 */
async function linesPdf(
	pageCount: number,
	lines: number,
	lineLen: number,
	lastLineLen = lineLen,
) {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	for (let i = 0; i < pageCount; i++) {
		const page = doc.addPage([200, 200]);
		for (let row = 0; row < lines; row++) {
			page.drawText('A'.repeat(row === lines - 1 ? lastLineLen : lineLen), {
				x: 10,
				y: 190 - row * 1.2,
				size: 1,
				font,
			});
		}
	}
	return Buffer.from(await doc.save());
}

/** Windowsのクリップボードは改行をCRLFで返すため、LFに揃えて比較する */
const readClipboard = async (page: Page) =>
	(await page.evaluate(() => navigator.clipboard.readText())).replace(
		/\r\n/g,
		'\n',
	);

test.describe('PDFテキスト抽出', () => {
	test.beforeEach(async ({ createToolPage }) => {
		await createToolPage('pdf-to-text').goto();
	});

	test('ページ表示とSafetyBadge・プライバシー注記・非対応の案内', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('pdf-to-text');
		await toolPage.expectTitle('PDFテキスト抽出');
		await toolPage.expectSafetyBadge();
		await expect(
			page.getByText('PDFはサーバーに送信されません', { exact: false }).first(),
		).toBeVisible();
		await expect(
			page.getByText('OCR（画像の文字認識）はしない', { exact: false }),
		).toBeVisible();
	});

	test('日本語・英語・複数ページを抽出し、見出し付きで編集可能なテキストにする', async ({
		page,
		baseURL,
	}) => {
		const recorder = recordRequests(page);
		await extractAll(page, 'text-ja.pdf', 3);
		await expect(page.getByLabel('抽出するページ')).toHaveValue('1-3');
		const expected = [1, 2, 3]
			.map((n) => `${heading(n)}\n${textJaPage(n)}`)
			.join('\n\n');
		await expect(output(page)).toHaveValue(expected);
		await expect(page.getByTestId('pdf-to-text-page-list')).toContainText(
			'3ページ目',
		);
		await expect(page.getByLabel('抽出結果（編集できます）')).toBeVisible();

		// 抽出結果は単体のPDF.js（Node）の出力とも一致する（独立照合）
		const reference = await extractText(
			new Uint8Array(fs.readFileSync(fixturePath('text-ja.pdf'))),
		);
		expect(reference[0].replace(/\s/g, '')).toBe(
			textJaPage(1).replace(/\s/g, ''),
		);

		recorder.assertNoLeak(baseURL ?? '', ['text-ja', '%PDF', '圧縮テスト']);
		// 日本語（非埋め込みCIDフォント）のCMapと PDF.js Worker は同一オリジンの静的資産から取得する
		const origin = new URL(baseURL ?? '').origin;
		const urls = recorder.requests.map((request) => request.url());
		expect(
			urls.some(
				(url) => url.startsWith(origin) && /UniJIS-UCS2-H.*\.bcmap/.test(url),
			),
		).toBe(true);
		expect(
			urls.some(
				(url) => url.startsWith(origin) && /pdf\.worker\.min.*\.js/.test(url),
			),
		).toBe(true);
		const storage = await storageSnapshot(page);
		expect(storage.url).not.toContain('text-ja');
		expect(JSON.stringify(storage.local)).not.toContain('text-ja');
		expect(JSON.stringify(storage.local)).not.toContain('圧縮テスト');
		expect(JSON.stringify(storage.local)).not.toContain('1-3');
	});

	test('ページ範囲: 重複・逆順は昇順の1回にまとめ、見出しOFFで本文だけにする', async ({
		page,
	}) => {
		await upload(page, 'text-ja.pdf', 3);
		await page.getByLabel('抽出するページ').fill('3,１、3');
		await runButton(page).click();
		await expect(output(page)).toHaveValue(
			`${heading(1)}\n${textJaPage(1)}\n\n${heading(3)}\n${textJaPage(3)}`,
		);
		await expect(page.getByTestId('pdf-to-text-page-list')).not.toContainText(
			'2ページ目',
		);

		// 設定変更で古い結果を消し、再抽出で見出しなしの結果になる
		await setHeadings(page, false);
		await expect(page.getByTestId('pdf-to-text-results')).toHaveCount(0);
		await runButton(page).click();
		await expect(output(page)).toHaveValue(
			`${textJaPage(1)}\n\n${textJaPage(3)}`,
		);
	});

	test('ページ範囲: 不正な指定は日本語エラーで実行できない', async ({
		page,
	}) => {
		await upload(page, 'text-ja.pdf', 3);
		const range = page.getByLabel('抽出するページ');
		for (const [value, message] of [
			['0', '1以上で指定してください'],
			['4', 'このPDFは全3ページです'],
			['2-1', ''],
			['a', '解釈できません'],
		] as const) {
			await range.fill(value);
			await expect(page.getByTestId('pdf-to-text-range-errors')).toContainText(
				message,
			);
			await expect(runButton(page)).toBeDisabled();
		}
		await range.fill('');
		await expect(
			page.getByText('抽出するページを入力してください'),
		).toBeVisible();
		await expect(runButton(page)).toBeDisabled();
	});

	test('コピーと保存: 編集後のテキストをクリップボードとUTF-8(BOMなし・LF)のTXTへ出す', async ({
		page,
		context,
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await extractAll(page, 'text-ja.pdf', 3);
		await page.getByLabel('抽出するページ').fill('1');
		await runButton(page).click();
		await expect(output(page)).toHaveValue(`${heading(1)}\n${textJaPage(1)}`);

		const edited = '編集後の日本語 ABC\n2行目 🎌𠮷\n末尾';
		await output(page).fill(edited);
		await expect(page.getByTestId('pdf-to-text-count')).toContainText('21文字');

		await page.getByRole('button', { name: 'すべてコピー' }).click();
		await expect(page.getByText('コピーしました')).toBeVisible();
		expect(await readClipboard(page)).toBe(edited);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'TXTで保存' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('text-ja_text.txt');
		const bytes = await readDownload(download);
		expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
		expect(bytes.toString('utf8')).toBe(edited);
		expect(bytes.includes(0x0d)).toBe(false);
	});

	test('設定を変える・再抽出すると編集内容と古い結果は残らない', async ({
		page,
	}) => {
		await extractAll(page, 'text-ja.pdf', 3);
		await output(page).fill('編集した内容');
		await page.getByRole('radio', { name: '横書きの行を整える' }).click();
		await expect(page.getByTestId('pdf-to-text-results')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'すべてコピー' }),
		).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'TXTで保存' })).toHaveCount(
			0,
		);
		await runButton(page).click();
		await expect(output(page)).not.toHaveValue(/編集した内容/);
		await expect(output(page)).toHaveValue(/^--- 1ページ目 ---\n日本語/);
	});

	test('回転0/90/180/270度の横書きを、どちらの改行モードでも見たままの順で抽出する', async ({
		page,
	}) => {
		const expected = [0, 90, 180, 270]
			.map(
				(angle, i) =>
					`${heading(i + 1)}\nRotation ${angle} ABC\n回転${angle}度`,
			)
			.join('\n\n');
		await extractAll(page, 'text-rotated.pdf', 4);
		await expect(output(page)).toHaveValue(expected);

		await page.getByRole('radio', { name: '横書きの行を整える' }).click();
		await runButton(page).click();
		await expect(output(page)).toHaveValue(expected);
	});

	test('同一行の分割text itemと描画順: 内部順と行整形で結果が異なり、どちらも文字は欠けない', async ({
		page,
	}) => {
		await setHeadingsAfterLoad(page, false);
		await upload(page, 'text-lines.pdf', 1);
		await runButton(page).click();
		// 内部順: 描画順どおり（2行目→1行目、語は描画順）
		await expect(output(page)).toHaveValue(
			'Second line: 句読点、です。\nWorldHello 日本語です。',
		);
		await page.getByRole('radio', { name: '横書きの行を整える' }).click();
		await runButton(page).click();
		// 行整形: 上の行から、左から右へ。日本語の間に不自然な空白は入らない
		await expect(output(page)).toHaveValue(
			'Hello World日本語です。\nSecond line: 句読点、です。',
		);
	});

	test('段組み・表・縦書き・ルビ: 文字は欠落・重複せず、読み順は保証しない旨を表示する', async ({
		page,
	}) => {
		await setHeadingsAfterLoad(page, false);
		await upload(page, 'text-layout.pdf', 4);
		const reference = await extractText(
			new Uint8Array(fs.readFileSync(fixturePath('text-layout.pdf'))),
		);
		const chars = (s: string) => [...s.replace(/\s/g, '')].sort().join('');
		for (const mode of ['PDFの順序のまま', '横書きの行を整える']) {
			await page.getByRole('radio', { name: mode }).click();
			await runButton(page).click();
			await expect(output(page)).not.toHaveValue('');
			const value = await output(page).inputValue();
			expect(chars(value), mode).toBe(chars(reference.join('')));
		}
		await expect(
			page.getByText('段組み・表・縦書き・ルビの読み順は保証せず', {
				exact: false,
			}),
		).toBeVisible();
		// 実測の記録用（縦書き・ルビ・段組みの出力）
		const text = await output(page).inputValue();
		console.log(`LAYOUT_OUTPUT_LINES: ${JSON.stringify(text)}`);
	});

	test('白紙・画像のみ・混在: 文字を取得できなかったページを警告し、取得できたページは保持する', async ({
		page,
	}) => {
		await extractAll(page, 'text-mixed.pdf', 4);
		await expect(output(page)).toHaveValue(
			[
				`${heading(1)}\nMixed page one`,
				heading(2),
				heading(3),
				`${heading(4)}\nMixed page four`,
			].join('\n\n'),
		);
		const warning = page.getByTestId('pdf-to-text-empty-warning');
		await expect(warning).toContainText('2、3ページ目');
		await expect(warning).toContainText('画像PDFや空白ページの可能性');
		await expect(page.getByTestId('pdf-to-text-page-list')).toContainText(
			'文字データを取得できませんでした',
		);
		// 取得できたページがあるので保存できる
		await expect(page.getByRole('button', { name: 'TXTで保存' })).toBeEnabled();
	});

	for (const name of ['text-empty.pdf', 'scan.pdf']) {
		test(`全ページ文字なし(${name}): 成功扱いにせず、コピー・保存できない`, async ({
			page,
		}) => {
			await upload(page, name, 2);
			await runButton(page).click();
			const alert = page.getByTestId('pdf-to-text-no-text');
			await expect(alert).toContainText('文字データを取得できませんでした');
			await expect(alert).toContainText('可能性があります');
			await expect(alert).toContainText('OCRをしない');
			await expect(output(page)).toHaveCount(0);
			await expect(
				page.getByRole('button', { name: 'すべてコピー' }),
			).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'TXTで保存' })).toHaveCount(
				0,
			);
		});
	}

	test('暗号化・破損・空・ページ数超過・署名・フォーム・サイズ超過を日本語で拒否する', async ({
		page,
	}) => {
		const alert = page.getByRole('alert');
		await fileInput(page).setInputFiles(ENCRYPTED_PDF);
		await expect(alert).toContainText('パスワード付きPDFには対応していません');
		await fileInput(page).setInputFiles({
			name: 'broken.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.7\nこれはPDFではありません'),
		});
		await expect(alert).toContainText('PDFを読み込めませんでした');
		await fileInput(page).setInputFiles({
			name: 'empty.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.alloc(0),
		});
		await expect(alert).toContainText('ファイルが空です');
		await fileInput(page).setInputFiles({
			name: 'pages101.pdf',
			mimeType: 'application/pdf',
			buffer: await blankPdf(101),
		});
		await expect(alert).toContainText('全101ページ');
		await fileInput(page).setInputFiles(fixturePath('signed.pdf'));
		await expect(alert).toContainText('テキスト抽出できません');
		await fileInput(page).setInputFiles(fixturePath('form.pdf'));
		await expect(alert).toContainText('入力フォーム');
		await expect(page.getByTestId('pdf-to-text-info')).toHaveCount(0);

		// 50MiBちょうどはサイズ判定を通り（PDFとして読めずに破損扱い）、1バイト超過はサイズ超過。
		// Playwright のバッファ引数は50MB超を渡せないため、一時ファイルのパスで渡す
		const limit = 50 * 1024 * 1024;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-to-text-'));
		const sized = (name: string, size: number) => {
			const file = path.join(dir, name);
			const buffer = Buffer.alloc(size, 0x20);
			buffer.write('%PDF-1.7\n');
			fs.writeFileSync(file, buffer);
			return file;
		};
		try {
			await fileInput(page).setInputFiles(sized('limit.pdf', limit));
			await expect(alert).toContainText('PDFを読み込めませんでした');
			await fileInput(page).setInputFiles(sized('over.pdf', limit + 1));
			await expect(alert).toContainText('50MBを超えています');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('100ページちょうどは読み込め、抽出して全ページ文字なしを案内する', async ({
		page,
	}) => {
		await fileInput(page).setInputFiles({
			name: 'pages100.pdf',
			mimeType: 'application/pdf',
			buffer: await blankPdf(100),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全100ページ',
		);
		await runButton(page).click();
		await expect(page.getByTestId('pdf-to-text-no-text')).toContainText(
			'対象100ページすべて',
		);
	});

	test('抽出テキスト100万文字相当ちょうどは成功し、1文字超えると日本語エラーで止まる', async ({
		page,
	}) => {
		test.setTimeout(150_000);
		// 1ページ = 73行 × 136文字 + 行間LF 72 = 10,000。100ページでちょうど 1,000,000
		const pageText = Array.from({ length: 73 }, () => 'A'.repeat(136)).join(
			'\n',
		);
		expect(pageText.length).toBe(10_000);
		await fileInput(page).setInputFiles({
			name: 'exact.pdf',
			mimeType: 'application/pdf',
			buffer: await linesPdf(100, 73, 136),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全100ページ',
		);
		await runButton(page).click();
		await expect(page.getByTestId('pdf-to-text-results')).toBeVisible({
			timeout: 120_000,
		});
		const expected = Array.from(
			{ length: 100 },
			(_, i) => `${heading(i + 1)}\n${pageText}`,
		).join('\n\n');
		expect(await output(page).inputValue()).toBe(expected);
		await expect(page.getByRole('alert')).toHaveCount(0);

		// 最終行を1文字ずつ長くして合計 1,000,100（上限超過）
		await fileInput(page).setInputFiles({
			name: 'over.pdf',
			mimeType: 'application/pdf',
			buffer: await linesPdf(100, 73, 136, 137),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'over.pdf',
		);
		await runButton(page).click();
		await expect(page.getByRole('alert')).toContainText('100万文字相当', {
			timeout: 120_000,
		});
		await expect(page.getByTestId('pdf-to-text-results')).toHaveCount(0);
		await expect(output(page)).toHaveCount(0);
		await expect(runButton(page)).toBeEnabled();
	});

	test('編集で上限を超えると警告し、コピー・保存を無効にする。戻すと再び使える', async ({
		page,
	}) => {
		await extractAll(page, 'text-ja.pdf', 3);
		await output(page).fill('a'.repeat(1_000_000 + 3 * 64 + 1));
		await expect(page.getByRole('alert')).toContainText('長すぎます');
		await expect(
			page.getByRole('button', { name: 'すべてコピー' }),
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'TXTで保存' }),
		).toBeDisabled();
		await output(page).fill('a'.repeat(1_000_000 + 3 * 64));
		await expect(page.getByRole('button', { name: 'TXTで保存' })).toBeEnabled();
		await output(page).fill('  \n ');
		await expect(
			page.getByRole('button', { name: 'TXTで保存' }),
		).toBeDisabled();
	});

	test('抽出中にキャンセルでき、部分結果を表示・保存させず、再実行できる', async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await fileInput(page).setInputFiles({
			name: 'heavy.pdf',
			mimeType: 'application/pdf',
			buffer: await linesPdf(100, 73, 136),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全100ページ',
		);
		// 読み込み後にCPUを絞り、抽出を確実に途中で止められるようにする
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
		await runButton(page).click();
		await expect(page.getByText(/抽出中…/)).toBeVisible();
		await page.getByRole('button', { name: 'キャンセル' }).click();
		await expect(page.getByText('抽出をキャンセルしました')).toBeVisible();
		await expect(page.getByTestId('pdf-to-text-results')).toHaveCount(0);
		await expect(output(page)).toHaveCount(0);
		await expect(runButton(page)).toBeEnabled();
		// 古い抽出が後から成功・失敗として現れない
		await page.waitForTimeout(1500);
		await expect(page.getByTestId('pdf-to-text-results')).toHaveCount(0);
		await expect(page.getByRole('alert')).toHaveCount(0);

		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		await page.getByLabel('抽出するページ').fill('1');
		await runButton(page).click();
		await expect(output(page)).toHaveValue(
			`${heading(1)}\n${Array.from({ length: 73 }, () => 'A'.repeat(136)).join('\n')}`,
		);
	});

	test('新しいファイルを選ぶと前の結果・コピー内容を表示しない', async ({
		page,
	}) => {
		await extractAll(page, 'text-ja.pdf', 3);
		await fileInput(page).setInputFiles(fixturePath('text-rotated.pdf'));
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'text-rotated.pdf',
		);
		await expect(page.getByTestId('pdf-to-text-results')).toHaveCount(0);
		await expect(output(page)).toHaveCount(0);
		await expect(page.getByLabel('抽出するページ')).toHaveValue('1-4');
	});

	test('ファイルを外す（×）と結果・コピー・保存が消える', async ({ page }) => {
		await extractAll(page, 'text-ja.pdf', 3);
		await page.getByRole('button', { name: '選択をクリア' }).first().click();
		await expect(page.getByTestId('pdf-to-text-results')).toHaveCount(0);
		await expect(page.getByTestId('pdf-to-text-info')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'TXTで保存' })).toHaveCount(
			0,
		);
	});

	test('設定（改行の扱い・見出し）だけを保持し、ページ範囲・本文・ファイル名は保持しない', async ({
		page,
	}) => {
		await upload(page, 'text-ja.pdf', 3);
		await page.getByRole('radio', { name: '横書きの行を整える' }).click();
		await setHeadings(page, false);
		await page.getByLabel('抽出するページ').fill('2');
		await runButton(page).click();
		await expect(output(page)).toHaveValue(textJaPage(2));
		const storage = await storageSnapshot(page);
		expect(
			JSON.parse(storage.local['tool_settings_pdf-to-text'] ?? '{}'),
		).toEqual({
			lineMode: 'lines',
			pageHeadings: false,
		});
		expect(JSON.stringify(storage.local)).not.toContain('text-ja');
		expect(JSON.stringify(storage.local)).not.toContain('圧縮');
		expect(storage.url).not.toContain('text-ja');

		await page.goto('/pdf-to-text');
		await upload(page, 'text-ja.pdf', 3);
		await expect(
			page.getByRole('radio', { name: '横書きの行を整える' }),
		).toBeChecked();
		await expect(
			page.getByRole('switch', { name: 'ページ区切りの見出しを入れる' }),
		).toHaveAttribute('aria-checked', 'false');
		await expect(page.getByLabel('抽出するページ')).toHaveValue('1-3');
	});

	test('共有URL(settings)の不正値は既定へ戻り、正しい値は復元される', async ({
		page,
	}) => {
		const encode = (value: unknown) =>
			Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
		await page.goto(
			`/pdf-to-text?settings=${encodeURIComponent(encode({ lineMode: 'lines', pageHeadings: false }))}`,
		);
		await expect(
			page
				.getByRole('radio', { name: '横書きの行を整える' })
				.or(page.getByText('横書きの行を整える').first()),
		).toBeVisible();
		await upload(page, 'text-ja.pdf', 3);
		await expect(
			page.getByRole('radio', { name: '横書きの行を整える' }),
		).toBeChecked();
		await page.goto(
			`/pdf-to-text?settings=${encodeURIComponent(encode({ lineMode: '<script>', pageHeadings: 'x' }))}`,
		);
		await upload(page, 'text-ja.pdf', 3);
		await expect(
			page.getByRole('radio', { name: 'PDFの順序のまま' }),
		).toBeChecked();
		await expect(
			page.getByRole('switch', { name: 'ページ区切りの見出しを入れる' }),
		).toHaveAttribute('aria-checked', 'true');
	});

	test('キーボードだけで範囲指定・抽出・コピーボタンまで操作できる', async ({
		page,
		context,
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await upload(page, 'text-ja.pdf', 3);
		const range = page.getByLabel('抽出するページ');
		await range.focus();
		await range.fill('2');
		await runButton(page).focus();
		await page.keyboard.press('Enter');
		await expect(output(page)).toHaveValue(`${heading(2)}\n${textJaPage(2)}`);
		await output(page).focus();
		await expect(output(page)).toBeFocused();
		await page.getByRole('button', { name: 'すべてコピー' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByText('コピーしました')).toBeVisible();
		expect(await readClipboard(page)).toBe(`${heading(2)}\n${textJaPage(2)}`);
		await expect(page.getByRole('status').first()).toBeAttached();
	});

	test('375px / 1440px で横にはみ出さない', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await extractAll(page, 'text-mixed.pdf', 4);
		const overflow = () =>
			page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth,
			);
		expect(await overflow()).toBe(false);
		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(output(page)).toBeVisible();
		expect(await overflow()).toBe(false);
	});

	test('抽出文字はHTML・スクリプトとして解釈せず、埋め込みJavaScript・リンクを実行しない', async ({
		page,
		baseURL,
	}) => {
		const dialogs: string[] = [];
		page.on('dialog', (dialog) => {
			dialogs.push(dialog.message());
			void dialog.dismiss();
		});
		const recorder = recordRequests(page);
		const doc = await PDFDocument.create();
		const font = await doc.embedFont(StandardFonts.Helvetica);
		const payload = '<img src=x onerror="window.__xss=1"> <b>bold</b>';
		const pdfPage = doc.addPage([400, 200]);
		pdfPage.drawText(payload, { x: 10, y: 100, size: 8, font });
		// 埋め込みJavaScript（OpenAction）と外部リンク注釈。どちらも実行・取得されてはならない
		doc.catalog.set(
			PDFName.of('OpenAction'),
			doc.context.obj({
				S: 'JavaScript',
				JS: PDFString.of('app.alert("pdf-js-ran")'),
			}),
		);
		const link = doc.context.register(
			doc.context.obj({
				Type: 'Annot',
				Subtype: 'Link',
				Rect: [10, 90, 200, 120],
				A: {
					S: 'URI',
					URI: PDFString.of('https://attacker.invalid/pdf-link-secret'),
				},
			}),
		);
		pdfPage.node.set(PDFName.of('Annots'), PDFArray.withContext(doc.context));
		(pdfPage.node.get(PDFName.of('Annots')) as PDFArray).push(link);
		await fileInput(page).setInputFiles({
			name: 'xss-secret-name.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from(await doc.save()),
		});
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全1ページ',
		);
		await runButton(page).click();
		await expect(output(page)).toHaveValue(`${heading(1)}\n${payload}`);
		expect(
			await page.evaluate(() => (window as { __xss?: number }).__xss),
		).toBeUndefined();
		await expect(
			page.getByTestId('pdf-to-text-results').locator('b'),
		).toHaveCount(0);
		await expect(
			page.getByTestId('pdf-to-text-results').locator('img'),
		).toHaveCount(0);
		expect(dialogs).toEqual([]);
		recorder.assertNoLeak(baseURL ?? '', [
			'xss-secret-name',
			'pdf-link-secret',
			'attacker.invalid',
			'__xss',
			'%PDF',
		]);
	});

	test('PDF.js資産の読込に失敗するとエラーを表示し、資産が戻って再読み込みすれば使える', async ({
		page,
	}) => {
		await page.route('**/_astro/pdf.*.js', (route) => route.abort());
		await fileInput(page).setInputFiles(fixturePath('text-ja.pdf'));
		await expect(page.getByRole('alert')).toContainText(
			'PDFを読み込めませんでした',
		);
		await expect(page.getByTestId('pdf-to-text-info')).toHaveCount(0);
		await expect(page.getByText('PDFを読み込み中…')).toHaveCount(0);
		await page.unroute('**/_astro/pdf.*.js');
		await page.goto('/pdf-to-text');
		await upload(page, 'text-ja.pdf', 3);
		await expect(runButton(page)).toBeEnabled();
	});
});

/** 設定の初期値を変える（読み込み前でも切替できるよう、一度ファイルを選ばずに保存値を直接設定して再訪） */
async function setHeadingsAfterLoad(page: Page, on: boolean) {
	await page.evaluate((value) => {
		localStorage.setItem(
			'tool_settings_pdf-to-text',
			JSON.stringify({ lineMode: 'internal', pageHeadings: value }),
		);
	}, on);
	await page.goto('/pdf-to-text');
}

// 遅いファイル読み込みの途中で別のPDFへ再選択した場合のstale状態を再現する。
test.describe('読み込みの競合', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			const read = File.prototype.arrayBuffer;
			File.prototype.arrayBuffer = async function (this: File) {
				if (this.name.startsWith('slow')) {
					await new Promise<void>((resolve) => {
						(
							window as typeof window & { releaseSlow?: () => void }
						).releaseSlow = resolve;
					});
				}
				return read.call(this);
			};
		});
	});

	const release = (page: Page) =>
		page.evaluate(() =>
			(window as typeof window & { releaseSlow?: () => void }).releaseSlow?.(),
		);
	const waitSlow = (page: Page) =>
		page.waitForFunction(
			() =>
				!!(window as typeof window & { releaseSlow?: () => void }).releaseSlow,
		);

	test('遅い有効PDFの後に選んだ有効PDFを、古い読み込みで上書きしない', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('pdf-to-text').goto();
		await fileInput(page).setInputFiles({
			name: 'slow.pdf',
			mimeType: 'application/pdf',
			buffer: fs.readFileSync(fixturePath('text-ja.pdf')),
		});
		await waitSlow(page);
		await fileInput(page).setInputFiles(fixturePath('text-rotated.pdf'));
		const info = page.getByTestId('pdf-to-text-info');
		await expect(info).toContainText('text-rotated.pdf');
		await release(page);
		await page.waitForTimeout(800);
		await expect(info).toContainText('text-rotated.pdf');
		await expect(info).toContainText('全4ページ');
		await expect(info).not.toContainText('slow.pdf');
		await expect(page.getByRole('alert')).toHaveCount(0);
		await runButton(page).click();
		await expect(output(page)).toHaveValue(
			/^--- 1ページ目 ---\nRotation 0 ABC/,
		);
	});

	test('遅い破損PDFのエラーは、後に選んだ有効PDFの後から現れない', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('pdf-to-text').goto();
		await fileInput(page).setInputFiles({
			name: 'slow-broken.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.7\n壊れています'),
		});
		await waitSlow(page);
		await fileInput(page).setInputFiles(fixturePath('text-ja.pdf'));
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全3ページ',
		);
		await release(page);
		await page.waitForTimeout(800);
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'text-ja.pdf',
		);
		await expect(
			page.getByText('PDFを読み込み中…', { exact: true }),
		).toHaveCount(0);
	});

	test('遅い有効PDFの読み込み中に空PDFを選ぶと読み込み表示を終了し、次のPDFを処理できる', async ({
		page,
		createToolPage,
	}) => {
		await createToolPage('pdf-to-text').goto();
		await fileInput(page).setInputFiles({
			name: 'slow.pdf',
			mimeType: 'application/pdf',
			buffer: fs.readFileSync(fixturePath('text-ja.pdf')),
		});
		await waitSlow(page);
		await fileInput(page).setInputFiles({
			name: 'empty.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.alloc(0),
		});
		await expect(page.getByRole('alert')).toContainText('空');
		await release(page);
		await page.waitForTimeout(800);
		await expect(page.getByTestId('pdf-to-text-info')).toHaveCount(0);
		await expect(
			page.getByText('PDFを読み込み中…', { exact: true }),
		).toHaveCount(0);
		await fileInput(page).setInputFiles(fixturePath('text-ja.pdf'));
		await expect(page.getByTestId('pdf-to-text-info')).toContainText(
			'全3ページ',
		);
	});
});

test.describe('署名の検出と読み込み失敗', () => {
	test.beforeEach(async ({ createToolPage }) => {
		await createToolPage('pdf-to-text').goto();
	});

	test('PDF.jsのフラグに出ない未参照の署名辞書(signed-hidden.pdf)も、PDF圧縮と同じ検出で拒否する', async ({
		page,
	}) => {
		await fileInput(page).setInputFiles(fixturePath('signed-hidden.pdf'));
		await expect(page.getByRole('alert')).toContainText(
			'電子署名（デジタル署名・タイムスタンプ）を含むPDFはテキスト抽出できません',
		);
		await expect(page.getByTestId('pdf-to-text-info')).toHaveCount(0);
		await expect(runButton(page)).toHaveCount(0);
		// 通常のPDFには影響しない
		await upload(page, 'text-ja.pdf', 3);
	});

	for (const target of ['head', 'body'] as const) {
		test(`ファイルの読み取りに失敗(${target})しても日本語エラーを表示し、未処理の例外なく次のPDFを処理できる`, async ({
			page,
		}) => {
			await page.evaluate((where) => {
				const w = window as typeof window & { __unhandled?: string[] };
				w.__unhandled = [];
				window.addEventListener('unhandledrejection', (event) => {
					w.__unhandled?.push(String(event.reason));
				});
				const fail = () =>
					Promise.reject(new DOMException('read failed', 'NotReadableError'));
				if (where === 'head') {
					const slice = File.prototype.slice;
					File.prototype.slice = function (this: File, ...args) {
						const blob = slice.apply(this, args as never);
						if (this.name === 'unreadable.pdf') blob.arrayBuffer = fail;
						return blob;
					};
				} else {
					const read = File.prototype.arrayBuffer;
					File.prototype.arrayBuffer = function (this: File) {
						return this.name === 'unreadable.pdf' && this.size > 5
							? fail()
							: read.call(this);
					};
				}
			}, target);
			const pageErrors: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));

			await fileInput(page).setInputFiles({
				name: 'unreadable.pdf',
				mimeType: 'application/pdf',
				buffer: fs.readFileSync(fixturePath('text-ja.pdf')),
			});
			await expect(page.getByRole('alert')).toContainText(
				'ファイルを読み込めませんでした',
			);
			await expect(page.getByTestId('pdf-to-text-info')).toHaveCount(0);
			await expect(
				page.getByText('PDFを読み込み中…', { exact: true }),
			).toHaveCount(0);

			await upload(page, 'text-ja.pdf', 3);
			await expect(page.getByRole('alert')).toHaveCount(0);
			await runButton(page).click();
			await expect(output(page)).toHaveValue(/^--- 1ページ目 ---\n日本語/);
			await page.waitForTimeout(300);
			expect(
				await page.evaluate(
					() => (window as { __unhandled?: string[] }).__unhandled,
				),
			).toEqual([]);
			expect(pageErrors).toEqual([]);
		});
	}
});

test('UserUnit=2でも文字の幅と座標を揃え、隣接する英単語に空白を足さない', async ({
	page,
	createToolPage,
}) => {
	await createToolPage('pdf-to-text').goto();
	const doc = await PDFDocument.create();
	const pdfPage = doc.addPage([300, 200]);
	pdfPage.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
	const firstFont = await doc.embedFont(StandardFonts.Helvetica);
	const secondFont = await doc.embedFont(StandardFonts.TimesRoman);
	pdfPage.drawText('Hello', { x: 20, y: 100, size: 12, font: firstFont });
	pdfPage.drawText('World', {
		x: 20 + firstFont.widthOfTextAtSize('Hello', 12),
		y: 100,
		size: 12,
		font: secondFont,
	});
	await fileInput(page).setInputFiles({
		name: 'user-unit.pdf',
		mimeType: 'application/pdf',
		buffer: Buffer.from(await doc.save()),
	});
	await expect(page.getByTestId('pdf-to-text-info')).toContainText('全1ページ');
	await page.getByRole('radio', { name: '横書きの行を整える' }).click();
	await runButton(page).click();
	await expect(output(page)).toHaveValue('--- 1ページ目 ---\nHelloWorld');
});
