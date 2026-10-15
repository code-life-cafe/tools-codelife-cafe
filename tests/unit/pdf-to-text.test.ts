import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PdfToolError } from '../../src/lib/pdf/common.ts';
import {
	assembleText,
	buildTxtBlob,
	countCharacters,
	DEFAULT_PDF_TO_TEXT_SETTINGS,
	extractPdfText,
	formatPageText,
	HEADING_ALLOWANCE_PER_PAGE,
	inspectPdfForText,
	MAX_TEXT_UNITS,
	MAX_TXT_BYTES,
	type PdfTextSource,
	type PdfToTextSettings,
	pageHeading,
	rejectUnsupportedStructure,
	resolvePageSelection,
	sanitizePdfToTextSettings,
	summarizePages,
	type TextChunkItem,
	txtFileName,
	validateOutputText,
	validateToTextSettings,
} from '../../src/lib/tools/pdf-to-text.ts';

const item = (
	str: string,
	extra: Partial<TextChunkItem> = {},
): TextChunkItem => ({
	str,
	hasEOL: false,
	x: null,
	y: null,
	width: null,
	fontSize: null,
	horizontal: false,
	...extra,
});

/** 表示座標つきの横書きテキスト片 */
const at = (
	str: string,
	x: number,
	y: number,
	width: number,
	fontSize = 12,
): TextChunkItem => item(str, { x, y, width, fontSize, horizontal: true });

const internal: PdfToTextSettings = {
	lineMode: 'internal',
	pageHeadings: true,
};
const lines: PdfToTextSettings = { lineMode: 'lines', pageHeadings: true };

/** ページごとのチャンク列を返す疑似ソース。終了処理（finally）の実行回数も数える */
function fakeSource(
	pagesChunks: Record<number, TextChunkItem[][]>,
	pageCount = Object.keys(pagesChunks).length,
) {
	const state = { opened: [] as number[], closed: [] as number[] };
	const source: PdfTextSource = {
		pageCount,
		async *streamPageText(pageNumber, signal) {
			state.opened.push(pageNumber);
			try {
				for (const chunk of pagesChunks[pageNumber] ?? []) {
					if (signal?.aborted) {
						throw new PdfToolError('cancelled', '処理をキャンセルしました。');
					}
					yield chunk;
					await Promise.resolve();
				}
			} finally {
				state.closed.push(pageNumber);
			}
		},
	};
	return { source, state };
}

describe('設定の検証', () => {
	it('許可値のみ採用し、不正値は既定へ戻す', () => {
		const d = DEFAULT_PDF_TO_TEXT_SETTINGS;
		assert.deepEqual(
			sanitizePdfToTextSettings({ lineMode: 'lines', pageHeadings: false }, d),
			{ lineMode: 'lines', pageHeadings: false },
		);
		assert.deepEqual(
			sanitizePdfToTextSettings({ lineMode: 'x', pageHeadings: 'yes' }, d),
			d,
		);
		assert.deepEqual(sanitizePdfToTextSettings(null, d), d);
		assert.deepEqual(sanitizePdfToTextSettings([1], d), d);
		// ページ範囲・本文など想定外のキーは保持しない
		assert.deepEqual(
			Object.keys(sanitizePdfToTextSettings({ pages: '1-3', text: 'a' }, d)),
			['lineMode', 'pageHeadings'],
		);
	});

	it('validateToTextSettings は不正値を日本語で拒否する', () => {
		assert.equal(validateToTextSettings(internal), null);
		assert.equal(validateToTextSettings(lines), null);
		const bad = validateToTextSettings({
			lineMode: 'x',
			pageHeadings: true,
		} as unknown as PdfToTextSettings);
		assert.equal(bad?.code, 'invalid-option');
		const bad2 = validateToTextSettings({
			lineMode: 'lines',
			pageHeadings: 1,
		} as unknown as PdfToTextSettings);
		assert.equal(bad2?.code, 'invalid-option');
	});
});

describe('ページ範囲', () => {
	it('重複を除き昇順にする', () => {
		const sel = resolvePageSelection('5,1-3,2,8-', 9);
		assert.deepEqual(sel, { ok: true, pages: [1, 2, 3, 5, 8, 9] });
	});

	it('空・範囲外・不正書式を拒否する', () => {
		assert.equal(resolvePageSelection('', 3).ok, false);
		assert.equal(resolvePageSelection('4', 3).ok, false);
		assert.equal(resolvePageSelection('0', 3).ok, false);
		assert.equal(resolvePageSelection('3-1', 3).ok, false);
		assert.equal(resolvePageSelection('a', 3).ok, false);
		assert.equal(resolvePageSelection('1,,2', 3).ok, false);
	});
});

describe('整形: 内部順', () => {
	it('hasEOL に沿って改行し、文字は削らない', () => {
		const text = formatPageText(
			[
				item('日本語テキスト'),
				item('', { hasEOL: true }),
				item('Hello ', {}),
				item('World', { hasEOL: true }),
			],
			'internal',
		);
		assert.equal(text, '日本語テキスト\nHello World');
	});

	it('末尾の改行だけを除き、先頭・途中の空行は残す。CRはLFに統一する', () => {
		assert.equal(
			formatPageText(
				[
					item('a', { hasEOL: true }),
					item('', { hasEOL: true }),
					item('b\r\nc\rd', { hasEOL: true }),
				],
				'internal',
			),
			'a\n\nb\nc\nd',
		);
		assert.equal(formatPageText([], 'internal'), '');
	});

	it('Unicode互換正規化・ハイフン削除・単語補完をしない', () => {
		const original = 'ﬁｱＡ①㌔ re-\nport';
		assert.equal(formatPageText([item(original)], 'internal'), original);
		assert.equal(formatPageText([item(original)], 'lines'), original);
	});
});

describe('整形: 横書きの行を整える', () => {
	it('同じ行の分割itemを左から右へ連結し、日本語の間に空白を入れない', () => {
		// 描画順は逆だが、表示座標では左から「日本」「語です。」
		const text = formatPageText(
			[at('語です。', 74, 100, 48), at('日本', 50, 100, 24)],
			'lines',
		);
		assert.equal(text, '日本語です。');
	});

	it('英語の語間は隙間があるときだけ空白を入れる', () => {
		assert.equal(
			formatPageText([at('Hel', 50, 100, 20), at('lo', 70, 100, 12)], 'lines'),
			'Hello',
		);
		assert.equal(
			formatPageText(
				[at('Hello', 50, 100, 30), at('World', 83.5, 100, 30)],
				'lines',
			),
			'Hello World',
		);
		// すでに空白で終わる／始まる場合は重ねない
		assert.equal(
			formatPageText(
				[at('Hello ', 50, 100, 33), at('World', 90, 100, 30)],
				'lines',
			),
			'Hello World',
		);
	});

	it('日本語と英語の隣接は近ければ空白なし、1文字分より離れていれば空白あり', () => {
		assert.equal(
			formatPageText(
				[at('Hello', 50, 100, 30), at('日本語', 82, 100, 36)],
				'lines',
			),
			'Hello日本語',
		);
		assert.equal(
			formatPageText(
				[at('Hello', 50, 100, 30), at('日本語', 120, 100, 36)],
				'lines',
			),
			'Hello 日本語',
		);
	});

	it('描画順に関わらず上の行から並べる。基準線の小さなずれは同じ行にする', () => {
		const text = formatPageText(
			[
				at('二行目', 50, 120, 36),
				at('一行目', 50, 100, 36),
				at('です', 86, 102, 24),
			],
			'lines',
		);
		assert.equal(text, '一行目です\n二行目');
	});

	it('2段組みは同じ高さの左右を1行にまとめる（非保証・文字は欠落しない）', () => {
		const text = formatPageText(
			[
				at('左1', 50, 100, 24),
				at('右1', 320, 100, 24),
				at('左2', 50, 120, 24),
				at('右2', 320, 120, 24),
			],
			'lines',
		);
		assert.equal(text, '左1 右1\n左2 右2');
		assert.equal(
			countCharacters(text.replace(/\s/g, '')),
			countCharacters('左1右1左2右2'),
		);
	});

	it('座標が欠損・不正、または横書き以外が含まれるときは内部順に戻す', () => {
		const missing = [item('B', { hasEOL: true }), at('A', 50, 100, 10)];
		assert.equal(formatPageText(missing, 'lines'), 'B\nA');
		const vertical = [
			at('A', 50, 100, 10),
			item('縦', { x: 500, y: 60, fontSize: 12, horizontal: false }),
		];
		assert.equal(formatPageText(vertical, 'lines'), 'A縦');
		const nan = [at('X', Number.NaN, 1, 1), at('Y', 1, 1, 1)];
		assert.equal(formatPageText(nan, 'lines'), 'XY');
		const zeroFont = [at('Z', 1, 1, 1, 0)];
		assert.equal(formatPageText(zeroFont, 'lines'), 'Z');
	});

	it('空文字だけ（改行マーカーのみ）の入力は空文字', () => {
		assert.equal(formatPageText([item('', { hasEOL: true })], 'lines'), '');
	});
});

describe('extractPdfText', () => {
	it('指定ページを昇順・重複なしで抽出し、進捗を通知する', async () => {
		const { source, state } = fakeSource(
			{
				1: [[item('p1')]],
				2: [[item('p2')]],
				3: [[item('日本語', { hasEOL: false })]],
			},
			3,
		);
		const progress: Array<[number, number]> = [];
		const result = await extractPdfText(source, [3, 1, 3], internal, {
			onProgress: (d, t) => progress.push([d, t]),
		});
		assert.deepEqual(
			result.pages.map((p) => [p.pageNumber, p.text, p.hasText]),
			[
				[1, 'p1', true],
				[3, '日本語', true],
			],
		);
		assert.deepEqual(state.opened, [1, 3]);
		assert.deepEqual(state.closed, [1, 3]);
		assert.deepEqual(progress, [
			[0, 2],
			[1, 2],
			[2, 2],
		]);
		assert.equal(result.totalUnits, 'p1'.length + '日本語'.length);
	});

	it('文字がないページは hasText=false（画像PDFとは断定しない）', async () => {
		const { source } = fakeSource({
			1: [[item('本文')]],
			2: [],
			3: [[item('  ', { hasEOL: true }), item('\n')]],
		});
		const result = await extractPdfText(source, [1, 2, 3], internal);
		assert.deepEqual(
			result.pages.map((p) => p.hasText),
			[true, false, false],
		);
		const summary = summarizePages(result.pages);
		assert.deepEqual(summary, {
			targetPages: 3,
			textPages: 1,
			emptyPages: [2, 3],
			hasAnyText: true,
		});
		const allEmpty = summarizePages([
			{ pageNumber: 1, text: '', hasText: false },
		]);
		assert.equal(allEmpty.hasAnyText, false);
	});

	it('チャンクを複数に分けて受け取っても連結する', async () => {
		const { source } = fakeSource({
			1: [[item('Hel')], [item('lo', { hasEOL: true })], [item('World')]],
		});
		const result = await extractPdfText(source, [1], internal);
		assert.equal(result.pages[0].text, 'Hello\nWorld');
	});

	it('範囲外・空のページ指定・設定不正・ページ数超過を拒否する', async () => {
		const { source } = fakeSource({ 1: [] }, 1);
		await assert.rejects(
			extractPdfText(source, [2], internal),
			(e: PdfToolError) => e.code === 'invalid-option',
		);
		await assert.rejects(
			extractPdfText(source, [], internal),
			(e: PdfToolError) => e.code === 'invalid-option',
		);
		await assert.rejects(
			extractPdfText(source, [1], {
				lineMode: 'x',
				pageHeadings: true,
			} as unknown as PdfToTextSettings),
			(e: PdfToolError) => e.code === 'invalid-option',
		);
		const tooMany = { ...source, pageCount: 101 };
		await assert.rejects(
			extractPdfText(tooMany, [1], internal),
			(e: PdfToolError) => e.code === 'too-many-pages',
		);
		const none = { ...source, pageCount: 0 };
		await assert.rejects(
			extractPdfText(none, [1], internal),
			(e: PdfToolError) => e.code === 'no-pages',
		);
	});

	it('100ページちょうどは許可する', async () => {
		const chunks: Record<number, TextChunkItem[][]> = {};
		for (let p = 1; p <= 100; p++) chunks[p] = [[item(`P${p}`)]];
		const { source } = fakeSource(chunks, 100);
		const pages = Array.from({ length: 100 }, (_, i) => i + 1);
		const result = await extractPdfText(source, pages, internal);
		assert.equal(result.pages.length, 100);
	});

	it('累計100万コード単位ちょうどは許可し、1つ超えると日本語エラー（実上限・チャンク分割）', async () => {
		// 25万 × 4 チャンクでちょうど100万
		const quarter = 'あ'.repeat(250_000);
		const ok = fakeSource({
			1: [[item(quarter)], [item(quarter)], [item(quarter)], [item(quarter)]],
		});
		const result = await extractPdfText(ok.source, [1], internal);
		assert.equal(result.totalUnits, MAX_TEXT_UNITS);
		assert.equal(result.pages[0].text.length, MAX_TEXT_UNITS);

		const over = fakeSource({
			1: [
				[item(quarter)],
				[item(quarter)],
				[item(quarter)],
				[item(`${quarter}あ`)],
			],
		});
		await assert.rejects(
			extractPdfText(over.source, [1], internal),
			(e: PdfToolError) =>
				e.code === 'text-too-long' && /100万/.test(e.message),
		);
		// 超過を検知した時点で読み取りを止める（終了処理が呼ばれる）
		assert.deepEqual(over.state.closed, [1]);
	});

	it('累計はページをまたいで数え、空白・改行の追加分も上限に含める', async () => {
		const split = fakeSource({
			1: [[item('a'.repeat(6))]],
			2: [[item('b'.repeat(5))]],
		});
		const ok = await extractPdfText(split.source, [1, 2], internal, {
			maxTextUnits: 11,
		});
		assert.equal(ok.totalUnits, 11);
		const split2 = fakeSource({
			1: [[item('a'.repeat(6))]],
			2: [[item('b'.repeat(5))]],
		});
		await assert.rejects(
			extractPdfText(split2.source, [1, 2], internal, { maxTextUnits: 10 }),
			(e: PdfToolError) => e.code === 'text-too-long',
		);
		// 素の文字数は上限内でも、改行(hasEOL)の追加で超えるなら拒否
		const eol = fakeSource({
			1: [[item('ab', { hasEOL: true }), item('cd')]],
		});
		await assert.rejects(
			extractPdfText(eol.source, [1], internal, { maxTextUnits: 4 }),
			(e: PdfToolError) => e.code === 'text-too-long',
		);
		const eol2 = fakeSource({
			1: [[item('ab', { hasEOL: true }), item('cd')]],
		});
		const exact = await extractPdfText(eol2.source, [1], internal, {
			maxTextUnits: 5,
		});
		assert.equal(exact.pages[0].text, 'ab\ncd');
	});

	it('空文字の改行マーカーだけの入力も個数上限で止める', async () => {
		const markers = Array.from({ length: 6 }, () => item('', { hasEOL: true }));
		const { source, state } = fakeSource({ 1: [markers] });
		await assert.rejects(
			extractPdfText(source, [1], internal, { maxTextItems: 5 }),
			(e: PdfToolError) => e.code === 'text-too-long',
		);
		assert.deepEqual(state.closed, [1]);
	});

	it('中断済みなら読み取りを開始せず cancelled', async () => {
		const { source, state } = fakeSource({ 1: [[item('a')]] });
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(
			extractPdfText(source, [1], internal, { signal: controller.signal }),
			(e: PdfToolError) => e.code === 'cancelled',
		);
		assert.deepEqual(state.opened, []);
	});

	it('処理中の中断は部分結果を返さず、読み取りを終了する', async () => {
		const { source, state } = fakeSource({
			1: [[item('a')]],
			2: [[item('b')], [item('c')]],
			3: [[item('d')]],
		});
		const controller = new AbortController();
		await assert.rejects(
			extractPdfText(source, [1, 2, 3], internal, {
				signal: controller.signal,
				onProgress: (done) => {
					if (done === 1) controller.abort();
				},
			}),
			(e: PdfToolError) => e.code === 'cancelled',
		);
		assert.deepEqual(state.opened, [1]);
		assert.deepEqual(state.closed, [1]);
	});

	it('ストリーム中の失敗は部分結果を返さず、そのまま伝える', async () => {
		const source: PdfTextSource = {
			pageCount: 2,
			async *streamPageText(pageNumber) {
				if (pageNumber === 2) {
					throw new PdfToolError('corrupt', 'broken');
				}
				yield [item('ok')];
			},
		};
		await assert.rejects(
			extractPdfText(source, [1, 2], internal),
			(e: PdfToolError) => e.code === 'corrupt',
		);
	});

	it('改行モード lines でも座標が整っていれば並べ替える', async () => {
		const { source } = fakeSource({
			1: [[at('下', 50, 120, 12), at('上', 50, 100, 12)]],
		});
		const result = await extractPdfText(source, [1], lines);
		assert.equal(result.pages[0].text, '上\n下');
	});
});

describe('結果の組立', () => {
	const pages = [
		{ pageNumber: 1, text: 'A', hasText: true },
		{ pageNumber: 2, text: '', hasText: false },
		{ pageNumber: 3, text: 'C\nD', hasText: true },
	];

	it('見出しONは全ページに見出しを付け、文字がないページも残す', () => {
		assert.equal(
			assembleText(pages, { pageHeadings: true }),
			[`${pageHeading(1)}\nA`, pageHeading(2), `${pageHeading(3)}\nC\nD`].join(
				'\n\n',
			),
		);
		assert.equal(pageHeading(12), '--- 12ページ目 ---');
	});

	it('見出しOFFは文字があるページだけを空行区切りにする', () => {
		assert.equal(assembleText(pages, { pageHeadings: false }), 'A\n\nC\nD');
		assert.equal(
			assembleText([{ pageNumber: 1, text: '', hasText: false }], {
				pageHeadings: false,
			}),
			'',
		);
	});
});

describe('出力テキストの検証（編集後を含む）', () => {
	it('文字数は100万＋見出し分まで。ちょうどは許可し超過は日本語エラー', () => {
		const limit = MAX_TEXT_UNITS + 2 * HEADING_ALLOWANCE_PER_PAGE;
		assert.equal(validateOutputText('a'.repeat(limit), 2), null);
		const over = validateOutputText('a'.repeat(limit + 1), 2);
		assert.match(over ?? '', /長すぎます/);
	});

	it('UTF-8で8MiBちょうどは許可し、1バイト超過は拒否（1・3バイト文字）', () => {
		const big = { maxTextUnits: 20_000_000 };
		assert.equal(validateOutputText('a'.repeat(MAX_TXT_BYTES), 1, big), null);
		assert.match(
			validateOutputText('a'.repeat(MAX_TXT_BYTES + 1), 1, big) ?? '',
			/8MB/,
		);
		const jp = '日'.repeat(Math.floor(MAX_TXT_BYTES / 3));
		assert.equal(validateOutputText(jp, 1, big), null);
		assert.match(validateOutputText(`${jp}日`, 1, big) ?? '', /8MB/);
	});

	it('空文字は検証を通る（コピー可否は呼び出し側が判断）', () => {
		assert.equal(validateOutputText('', 1), null);
	});
});

describe('TXT出力', () => {
	it('UTF-8（BOMなし）・LFで、日本語を含めて往復できる', async () => {
		const blob = buildTxtBlob('日本語 ABC\r\n行2\r行3\n末尾');
		assert.match(blob.type, /^text\/plain;charset=utf-8$/);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		assert.notDeepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
		const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		assert.equal(decoded, '日本語 ABC\n行2\n行3\n末尾');
		assert.ok(!decoded.includes('\r'));
	});

	it('ファイル名は元の名前＋_text.txt', () => {
		assert.equal(txtFileName('資料'), '資料_text.txt');
	});

	it('サロゲートペアを1文字として数える', () => {
		assert.equal(countCharacters('a𠮷b'), 3);
		assert.equal('a𠮷b'.length, 4);
	});
});

describe('非対応のPDF構造', () => {
	it('署名・フォーム・XFA を日本語で拒否し、通常のPDFは通す', () => {
		const none = { signatures: false, acroForm: false, xfa: false };
		assert.equal(rejectUnsupportedStructure(none), null);
		assert.equal(
			rejectUnsupportedStructure({ ...none, signatures: true })?.code,
			'signed',
		);
		assert.equal(
			rejectUnsupportedStructure({ ...none, acroForm: true })?.code,
			'form',
		);
		assert.equal(
			rejectUnsupportedStructure({ ...none, xfa: true })?.code,
			'form',
		);
		// 署名とフォームが両方ある場合は署名を優先する
		assert.equal(
			rejectUnsupportedStructure({
				signatures: true,
				acroForm: true,
				xfa: false,
			})?.code,
			'signed',
		);
	});
});

describe('バイト検査（PDF圧縮と同じ署名・フォーム検出）', () => {
	const read = (name: string) =>
		new Uint8Array(
			fs.readFileSync(path.join('tests', 'fixtures', 'pdf-expansion', name)),
		);

	it('未参照の署名辞書だけを持つ signed-hidden.pdf を署名付きとして拒否する', async () => {
		await assert.rejects(
			inspectPdfForText(read('signed-hidden.pdf')),
			(e: PdfToolError) =>
				e.code === 'signed' && /テキスト抽出できません/.test(e.message),
		);
	});

	it('署名・フォームは抽出ツール用の文言で拒否し、通常のPDFは通す', async () => {
		await assert.rejects(
			inspectPdfForText(read('signed.pdf')),
			(e: PdfToolError) => e.code === 'signed',
		);
		await assert.rejects(
			inspectPdfForText(read('form.pdf')),
			(e: PdfToolError) => e.code === 'form' && !/圧縮/.test(e.message),
		);
		for (const name of ['text-ja.pdf', 'text-mixed.pdf', 'compact.pdf']) {
			assert.ok((await inspectPdfForText(read(name))).pageCount >= 1, name);
		}
	});

	it('破損PDFは破損として拒否する（fail closed）', async () => {
		await assert.rejects(
			inspectPdfForText(new TextEncoder().encode('%PDF-1.7\nbroken')),
			(e: PdfToolError) => e.code === 'corrupt',
		);
	});
});

describe('上限の早期判定は整形後の長さを過大評価しない', () => {
	const run = async (
		chunks: TextChunkItem[][],
		maxTextUnits: number,
		settings: PdfToTextSettings = internal,
	) => {
		const { source, state } = fakeSource({ 1: chunks });
		const result = await extractPdfText(source, [1], settings, {
			maxTextUnits,
		});
		return { result, state };
	};
	const rejects = (
		chunks: TextChunkItem[][],
		maxTextUnits: number,
		settings: PdfToTextSettings = internal,
	) =>
		assert.rejects(
			run(chunks, maxTextUnits, settings),
			(e: PdfToolError) => e.code === 'text-too-long',
		);

	it('CRLFはLF1文字になるため、整形後が上限ちょうどなら許可する（直前/ちょうど/超過）', async () => {
		// 'a\r\nb' は整形後 'a\nb'（3）。生の長さは4
		assert.equal(
			(await run([[item('a\r\nb')]], 3)).result.pages[0].text,
			'a\nb',
		);
		assert.equal(
			(await run([[item('a\r\nb')]], 4)).result.pages[0].text,
			'a\nb',
		);
		await rejects([[item('a\r\nb')]], 2);
		// 整形後が上限+1なら拒否: 'ab\r\ncd' → 'ab\ncd'（5）
		await rejects([[item('ab\r\ncd')]], 4);
		assert.equal(
			(await run([[item('ab\r\ncd')]], 5)).result.pages[0].text,
			'ab\ncd',
		);
		// 'a\r\nb\r\nc' は生7→整形後5
		assert.equal(
			(await run([[item('a\r\nb\r\nc')]], 5)).result.pages[0].text,
			'a\nb\nc',
		);
	});

	it('末尾の改行は削られるため、削除後の長さで判定する', async () => {
		assert.equal((await run([[item('abc\n')]], 3)).result.pages[0].text, 'abc');
		assert.equal(
			(await run([[item('abc\r\n')]], 3)).result.pages[0].text,
			'abc',
		);
		assert.equal(
			(await run([[item('abc', { hasEOL: true })]], 3)).result.pages[0].text,
			'abc',
		);
		await rejects([[item('abcd\n')]], 3);
		await rejects([[item('abcd', { hasEOL: true })]], 3);
	});

	it('lines モードでも同じ（CRLF・末尾改行）', async () => {
		const items = [at('a\r\nb', 10, 10, 20)];
		assert.equal((await run([items], 3, lines)).result.pages[0].text, 'a\nb');
		await rejects([items], 2, lines);
		assert.equal(
			(await run([[at('abc\n', 10, 10, 20)]], 3, lines)).result.pages[0].text,
			'abc',
		);
	});

	it('チャンクをまたいでも累計で判定し、超過時は読み取りを止める', async () => {
		const ok = await run([[item('a\r\nb')], [item('c')]], 4);
		assert.equal(ok.result.pages[0].text, 'a\nbc');
		const over = fakeSource({
			1: [[item('ab\r\ncd')], [item('e')], [item('f')]],
		});
		await assert.rejects(
			extractPdfText(over.source, [1], internal, { maxTextUnits: 5 }),
			(e: PdfToolError) => e.code === 'text-too-long',
		);
		assert.deepEqual(over.state.closed, [1]);
	});

	it('素の文字数が明らかに上限を超える場合は、最初のチャンクで止める', async () => {
		const over = fakeSource({
			1: [[item('abcdef')], [item('x')], [item('y')]],
		});
		await assert.rejects(
			extractPdfText(over.source, [1], internal, { maxTextUnits: 5 }),
			(e: PdfToolError) => e.code === 'text-too-long',
		);
		assert.deepEqual(over.state.closed, [1]);
	});

	it('整形で増える分（改行）は最終判定で上限に含め、実上限100万ちょうどは維持する', async () => {
		await rejects([[item('ab', { hasEOL: true }), item('cd')]], 4);
		const quarter = 'あ'.repeat(250_000);
		const exact = fakeSource({
			1: [[item(quarter)], [item(quarter)], [item(quarter)], [item(quarter)]],
		});
		const result = await extractPdfText(exact.source, [1], internal);
		assert.equal(result.totalUnits, MAX_TEXT_UNITS);
		// 生の長さは1,000,001だが、CRLF→LFで整形後はちょうど1,000,000（許可）
		const crlf = fakeSource({
			1: [
				[
					item(`${quarter}
`),
				],
				[item(quarter)],
				[item(quarter)],
				[item('あ'.repeat(249_999))],
			],
		});
		const r2 = await extractPdfText(crlf.source, [1], internal);
		assert.equal(r2.totalUnits, MAX_TEXT_UNITS);
		// 整形後が1,000,001なら拒否
		const over = fakeSource({
			1: [
				[
					item(`${quarter}
`),
				],
				[item(quarter)],
				[item(quarter)],
				[item(quarter)],
			],
		});
		await assert.rejects(
			extractPdfText(over.source, [1], internal),
			(e: PdfToolError) => e.code === 'text-too-long',
		);
	});
});

describe('拡張漢字の語間', () => {
	it('サロゲートペア領域の漢字同士と英字の隣接に不要な空白を入れない', () => {
		assert.equal(
			formatPageText([at('𠮷', 0, 10, 12), at('𠮟', 15, 10, 12)], 'lines'),
			'𠮷𠮟',
		);
		assert.equal(
			formatPageText([at('𠮷', 0, 10, 12), at('A', 15, 10, 8)], 'lines'),
			'𠮷A',
		);
	});
});
