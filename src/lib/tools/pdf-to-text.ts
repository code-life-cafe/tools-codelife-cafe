// pdf-to-text.ts — PDF→テキスト抽出のコアロジック（DOM非依存の純粋関数）
// ページ範囲・上限の検証、PDF.js が返すテキスト片の整形（2モード）、結果の組立、TXT出力を担う。
// テキストの取得は PdfTextSource（src/lib/pdf/render.ts の PDF.js 実装）を注入して行う。
// OCRはしない。文字データを持たないページは「取得できなかった」と扱い、画像PDFとは断定しない。

import {
	PdfToolError,
	throwIfAborted,
	validatePageCount,
} from '../pdf/common.ts';

import { inspectPdfForCompress } from './pdf-compress.ts';

export { allPagesInput, resolvePageSelection } from './pdf-to-image.ts';

/** 抽出後テキストの上限（UTF-16コード単位の累計。ページ見出しは含まない） */
export const MAX_TEXT_UNITS = 1_000_000;
/** TXTとして保存するUTF-8バイト数の上限（8MiB） */
export const MAX_TXT_BYTES = 8 * 1024 * 1024;
/** 受け取るテキスト片の個数の上限（空文字の改行マーカーだけで膨らむ入力への備え） */
export const MAX_TEXT_ITEMS = 2_000_000;
/** 編集後テキストに許す、ページ見出し等の追加分（1ページあたり、UTF-16コード単位） */
export const HEADING_ALLOWANCE_PER_PAGE = 64;

export type LineMode = 'internal' | 'lines';

export type PdfToTextSettings = {
	/** internal: PDF内部順＋改行情報に沿う / lines: 表示座標で同じ行をまとめる */
	lineMode: LineMode;
	/** ページ区切りの見出しを入れる */
	pageHeadings: boolean;
};

export const DEFAULT_PDF_TO_TEXT_SETTINGS: PdfToTextSettings = {
	lineMode: 'internal',
	pageHeadings: true,
};

function isLineMode(value: unknown): value is LineMode {
	return value === 'internal' || value === 'lines';
}

/** useToolSettings 用の検証関数。許可値のみ採用する（ページ範囲・本文は入力のため保持しない） */
export function sanitizePdfToTextSettings(
	value: unknown,
	defaults: PdfToTextSettings,
): PdfToTextSettings {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ...defaults };
	}
	const v = value as Record<string, unknown>;
	return {
		lineMode: isLineMode(v.lineMode) ? v.lineMode : defaults.lineMode,
		pageHeadings:
			typeof v.pageHeadings === 'boolean'
				? v.pageHeadings
				: defaults.pageHeadings,
	};
}

export function validateToTextSettings(
	settings: PdfToTextSettings,
): PdfToolError | null {
	if (!isLineMode(settings.lineMode)) {
		return new PdfToolError(
			'invalid-option',
			'改行の扱いが正しくありません。PDFの順序のまま、または横書きの行を整えるから選択してください。',
		);
	}
	if (typeof settings.pageHeadings !== 'boolean') {
		return new PdfToolError(
			'invalid-option',
			'ページ見出しの指定が正しくありません。',
		);
	}
	return null;
}

/** PDF.js から受け取るテキスト片（表示座標。取得できない値は null） */
export type TextChunkItem = {
	str: string;
	hasEOL: boolean;
	x: number | null;
	y: number | null;
	width: number | null;
	fontSize: number | null;
	horizontal: boolean;
};

/** テキストを取得する実装（PDF.js）。テストでは差し替える */
export interface PdfTextSource {
	readonly pageCount: number;
	streamPageText(
		pageNumber: number,
		signal?: AbortSignal,
	): AsyncIterable<TextChunkItem[]>;
}

export type PageText = {
	pageNumber: number;
	text: string;
	/** 空白・改行以外の文字を1文字以上取得できた */
	hasText: boolean;
};

export type ExtractedText = {
	pages: PageText[];
	/** 全ページ本文のUTF-16コード単位の合計（見出しを含まない） */
	totalUnits: number;
};

export const TEXT_TOO_LONG_MESSAGE =
	'抽出されるテキストが多すぎます（上限は100万文字相当、UTF-16コード単位）。ページ範囲を分けて抽出してください。';

function textTooLong(): PdfToolError {
	return new PdfToolError('text-too-long', TEXT_TOO_LONG_MESSAGE);
}

const CJK_PATTERN = /[\p{Script=Han}ᄀ-ᇿ⺀-ㄯ㄰-㆏㆐-鿿ꥠ-꥿가-퟿豈-﫿＀-￯]/u;

function isCjkChar(char: string | undefined): boolean {
	return char !== undefined && char !== '' && CJK_PATTERN.test(char);
}

function lastChar(text: string): string {
	return text === '' ? '' : (Array.from(text.slice(-2)).pop() ?? '');
}

function firstChar(text: string): string {
	return text === '' ? '' : (Array.from(text.slice(0, 2))[0] ?? '');
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

function endTrim(text: string): string {
	return text.replace(/\n+$/, '');
}

/**
 * 1つのテキスト片が整形後のページ本文に最低限残す長さ（早期の上限判定用の下限）。
 * 整形はCRLFをLF1文字へ縮め、ページ末尾の改行を削るため、生の長さでは過大評価になる。
 * 整形後の文字は各片の（改行正規化後・末尾改行を除いた）文字を必ず含むので、その合計は
 * 最終長の下限になる（空白・改行の追加は下限に含めず、最終判定で確認する）。
 */
function retainedLength(str: string): number {
	if (!str.includes('\r') && !str.endsWith('\n')) return str.length;
	return endTrim(normalizeNewlines(str)).length;
}

/** PDF内部の出現順に、改行情報（hasEOL）に沿って連結する */
function formatInternal(items: readonly TextChunkItem[]): string {
	let out = '';
	for (const item of items) {
		out += normalizeNewlines(item.str);
		if (item.hasEOL) out += '\n';
	}
	return endTrim(out);
}

type PositionedItem = TextChunkItem & {
	x: number;
	y: number;
	fontSize: number;
	order: number;
};

function isPositioned(item: TextChunkItem): boolean {
	return (
		item.horizontal &&
		item.x !== null &&
		item.y !== null &&
		item.fontSize !== null &&
		Number.isFinite(item.x) &&
		Number.isFinite(item.y) &&
		Number.isFinite(item.fontSize) &&
		item.fontSize > 0
	);
}

/**
 * 表示座標で同じ行（基準線がほぼ一致）にある横書きのテキスト片をまとめ、上から下・左から右へ並べる。
 * 座標が欠けている／横書き以外のテキスト片がある場合は、本文を落とさないよう内部順に戻す。
 * 段組み・表・縦書き・ルビは再現しない（同じ高さの別段が1行に並ぶことがある）。
 */
function formatLines(items: readonly TextChunkItem[]): string {
	const texts = items.filter((item) => item.str !== '');
	if (!texts.every(isPositioned)) return formatInternal(items);
	const positioned: PositionedItem[] = texts.map((item, order) => ({
		...(item as PositionedItem),
		order,
	}));
	positioned.sort((a, b) => a.y - b.y || a.order - b.order);

	const lines: PositionedItem[][] = [];
	let anchor: PositionedItem | null = null;
	for (const item of positioned) {
		const tolerance =
			0.5 * Math.min(anchor?.fontSize ?? item.fontSize, item.fontSize);
		if (anchor && Math.abs(item.y - anchor.y) <= tolerance) {
			lines[lines.length - 1].push(item);
		} else {
			lines.push([item]);
			anchor = item;
		}
	}

	return endTrim(
		lines
			.map((line) => {
				line.sort((a, b) => a.x - b.x || a.order - b.order);
				let out = '';
				let prev: PositionedItem | null = null;
				for (const item of line) {
					const str = normalizeNewlines(item.str);
					if (prev) {
						const end = prev.x + (prev.width ?? 0);
						const gap = item.x - end;
						// 日本語との隣接は語間空白を入れない（隙間が1文字分を超える離れた配置のみ空白を入れる）
						const cjkAdjacent =
							isCjkChar(lastChar(out)) || isCjkChar(firstChar(str));
						const needsSpace =
							gap > item.fontSize * (cjkAdjacent ? 1 : 0.2) &&
							!/\s$/.test(out) &&
							!/^\s/.test(str);
						if (needsSpace) out += ' ';
					}
					out += str;
					prev = item;
				}
				return out;
			})
			.join('\n'),
	);
}

/** 1ページ分のテキスト片を、選択された改行モードで文字列にする */
export function formatPageText(
	items: readonly TextChunkItem[],
	mode: LineMode,
): string {
	return mode === 'lines' ? formatLines(items) : formatInternal(items);
}

export type ExtractOptions = {
	signal?: AbortSignal;
	onProgress?: (done: number, total: number) => void;
	/** 上限の差し替え（テスト用） */
	maxTextUnits?: number;
	maxTextItems?: number;
};

/**
 * 選択ページを1ページずつ取得・整形する。チャンクごとに累計を確認し、上限（ちょうどは許可）を
 * 超えた時点で、読み取りを止めて日本語エラーにする（無言で切り捨てない）。
 * 中断・失敗時は部分結果を返さず例外にする。
 */
export async function extractPdfText(
	source: PdfTextSource,
	pages: readonly number[],
	settings: PdfToTextSettings,
	options: ExtractOptions = {},
): Promise<ExtractedText> {
	const { signal, onProgress } = options;
	const maxUnits = options.maxTextUnits ?? MAX_TEXT_UNITS;
	const maxItems = options.maxTextItems ?? MAX_TEXT_ITEMS;
	const settingsError = validateToTextSettings(settings);
	if (settingsError) throw settingsError;
	const pageCountError = validatePageCount(source.pageCount);
	if (pageCountError) throw pageCountError;
	if (pages.length === 0) {
		throw new PdfToolError(
			'invalid-option',
			'ページを1つ以上指定してください。',
		);
	}
	const outOfRange = pages.find(
		(p) => !Number.isInteger(p) || p < 1 || p > source.pageCount,
	);
	if (outOfRange !== undefined) {
		throw new PdfToolError(
			'invalid-option',
			`ページ番号 ${outOfRange} は範囲外です（全${source.pageCount}ページ）。`,
		);
	}
	const ordered = [...new Set(pages)].sort((a, b) => a - b);

	const results: PageText[] = [];
	let totalUnits = 0;
	let totalItems = 0;
	onProgress?.(0, ordered.length);
	for (const [index, pageNumber] of ordered.entries()) {
		throwIfAborted(signal);
		const items: TextChunkItem[] = [];
		let rawUnits = 0;
		for await (const chunk of source.streamPageText(pageNumber, signal)) {
			throwIfAborted(signal);
			for (const item of chunk) {
				totalItems++;
				rawUnits += retainedLength(item.str);
				// 下限（retainedLength）の累計が上限超過なら、整形後も超過が確定する
				if (totalUnits + rawUnits > maxUnits || totalItems > maxItems) {
					throw textTooLong();
				}
				items.push(item);
			}
		}
		throwIfAborted(signal);
		const text = formatPageText(items, settings.lineMode);
		totalUnits += text.length;
		if (totalUnits > maxUnits) throw textTooLong();
		results.push({ pageNumber, text, hasText: /\S/u.test(text) });
		onProgress?.(index + 1, ordered.length);
	}
	return { pages: results, totalUnits };
}

/** ページ区切り見出し（編集後も手で消せる通常のテキスト） */
export function pageHeading(pageNumber: number): string {
	return `--- ${pageNumber}ページ目 ---`;
}

/**
 * ページ本文を1つのテキストにまとめる（改行はLF）。
 * 見出しONでは全ページに見出しを付け、文字がないページも位置が分かるよう残す。
 * 見出しOFFでは文字がないページは出力しない。
 */
export function assembleText(
	pages: readonly PageText[],
	options: { pageHeadings: boolean },
): string {
	const blocks: string[] = [];
	for (const page of pages) {
		if (options.pageHeadings) {
			blocks.push(
				page.hasText
					? `${pageHeading(page.pageNumber)}\n${page.text}`
					: pageHeading(page.pageNumber),
			);
		} else if (page.hasText) {
			blocks.push(page.text);
		}
	}
	return blocks.join('\n\n');
}

export type TextSummary = {
	targetPages: number;
	textPages: number;
	/** 文字データを取得できなかったページ番号 */
	emptyPages: number[];
	hasAnyText: boolean;
};

export function summarizePages(pages: readonly PageText[]): TextSummary {
	const emptyPages = pages.filter((p) => !p.hasText).map((p) => p.pageNumber);
	return {
		targetPages: pages.length,
		textPages: pages.length - emptyPages.length,
		emptyPages,
		hasAnyText: emptyPages.length < pages.length,
	};
}

/** 文字数（コードポイント数）。サロゲートペアを1文字として数える */
export function countCharacters(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

export function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

/**
 * コピー・保存してよいテキストか確認する（編集後のテキストにも適用）。問題があれば日本語メッセージ。
 * 抽出上限 + ページ見出し分を超える長さ、またはUTF-8で8MiBを超えるものは保存させない。
 */
export function validateOutputText(
	text: string,
	targetPageCount: number,
	options: { maxTextUnits?: number; maxTxtBytes?: number } = {},
): string | null {
	const maxUnits =
		(options.maxTextUnits ?? MAX_TEXT_UNITS) +
		targetPageCount * HEADING_ALLOWANCE_PER_PAGE;
	const maxBytes = options.maxTxtBytes ?? MAX_TXT_BYTES;
	if (text.length > maxUnits) {
		return `テキストが長すぎます（上限は約100万文字相当）。不要な部分を削除してください。`;
	}
	if (utf8ByteLength(text) > maxBytes) {
		return 'TXTのサイズが8MBを超えるため、コピー・保存できません。不要な部分を削除してください。';
	}
	return null;
}

/** 保存用のUTF-8（BOMなし）Blob。改行はLFに統一する */
export function buildTxtBlob(text: string): Blob {
	return new Blob([normalizeNewlines(text)], {
		type: 'text/plain;charset=utf-8',
	});
}

export function txtFileName(baseName: string): string {
	return `${baseName}_text.txt`;
}

export const SIGNED_PDF_TEXT_MESSAGE =
	'電子署名（デジタル署名・タイムスタンプ）を含むPDFはテキスト抽出できません。署名の検証やパスワード解除は行いません。';
export const FORM_PDF_TEXT_MESSAGE =
	'入力フォーム（フォームフィールド）を含むPDFはテキスト抽出できません。';

/** PDF.js が検出した構造フラグから、初回非対応の文書を拒否する */
export function rejectUnsupportedStructure(flags: {
	signatures: boolean;
	acroForm: boolean;
	xfa: boolean;
}): PdfToolError | null {
	if (flags.signatures)
		return new PdfToolError('signed', SIGNED_PDF_TEXT_MESSAGE);
	if (flags.acroForm || flags.xfa) {
		return new PdfToolError('form', FORM_PDF_TEXT_MESSAGE);
	}
	return null;
}

/**
 * PDF圧縮と同じバイト検査（参照されない署名辞書・圧縮オブジェクトストリーム内の署名/フォームを含む）で
 * 署名・フォーム付きPDFを拒否する。PDF.jsのフラグ（rejectUnsupportedStructure）では拾えない
 * 痕跡を補うもので、両方を併用する。署名・フォームは抽出ツール用の日本語文言に置き換え、
 * 暗号化・破損・ページ数の判定は圧縮と共通のエラーをそのまま返す（検査できない場合は拒否）。
 */
export async function inspectPdfForText(
	bytes: Uint8Array,
): Promise<{ pageCount: number }> {
	try {
		return await inspectPdfForCompress(bytes);
	} catch (error) {
		if (error instanceof PdfToolError) {
			if (error.code === 'signed') {
				throw new PdfToolError('signed', SIGNED_PDF_TEXT_MESSAGE);
			}
			if (error.code === 'form') {
				throw new PdfToolError('form', FORM_PDF_TEXT_MESSAGE);
			}
		}
		throw error;
	}
}
