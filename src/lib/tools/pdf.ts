// pdf.ts — PDF結合・分割・ページ範囲パースのコアロジック（純粋関数中心）
// 処理はすべてブラウザ内で完結し、サーバーへの送信は行わない。
// pdf-lib は本モジュール内でのみ dynamic import し、他ツールのバンドルに影響させない。
// 用途は merge / split / image embed / page count detection に限定する
// （署名保持・暗号化処理・フォーム完全保持などの高度なPDF処理は対象外）。

export type MergeInput =
	| { kind: 'pdf'; name: string; bytes: Uint8Array }
	| {
			kind: 'image';
			name: string;
			bytes: Uint8Array;
			mime: 'image/jpeg' | 'image/png';
	  };

export type PdfInfo = { pageCount: number; encrypted: boolean };

export type ParseResult =
	| { ok: true; ranges: number[][]; normalizedInput: string }
	| {
			ok: false;
			errors: Array<{
				token: string;
				index: number;
				message: string;
			}>;
			normalizedInput: string;
	  };

export type PdfInputValidation =
	| {
			ok: true;
			kind: 'pdf' | 'image';
			mime: 'application/pdf' | 'image/jpeg' | 'image/png';
	  }
	| {
			ok: false;
			reason:
				| 'unsupported-type'
				| 'too-large'
				| 'too-many-files'
				| 'total-size-exceeded'
				| 'invalid-signature';
			message: string;
	  };

export type SplitResult = {
	bytes: Uint8Array;
	fileName: string; // {basename}_p{start}-{end}.pdf / {basename}_p{n}.pdf
	pageNumbers: number[];
};

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB/ファイル
export const MAX_MERGE_FILES = 20; // 結合は20ファイル/回
export const MAX_TOTAL_INPUT_BYTES = 300 * 1024 * 1024; // 合計入力300MB/回

export const TOTAL_SIZE_EXCEEDED_MESSAGE =
	'合計サイズが300MBを超えています。ブラウザのメモリ上限により処理できない可能性があります。ファイル数またはサイズを減らしてください。';
export const ENCRYPTED_PDF_MESSAGE =
	'パスワード付きPDFには対応していません。パスワードを解除してからお試しください。';

const IMAGE_MIMES = ['image/jpeg', 'image/png'] as const;

// 96dpi の画像ピクセルを PDF ポイント（72dpi）へ換算する係数
const PX_TO_PT = 72 / 96;

/** `%PDF-` シグネチャ（先頭5バイト）を確認する */
export function hasPdfSignature(bytes: Uint8Array): boolean {
	const sig = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
	return sig.every((b, i) => bytes[i] === b);
}

/**
 * 1ファイルの種別・サイズ・シグネチャを検証する。
 * PDF は先頭バイトの `%PDF-` シグネチャも確認するため async。
 */
export async function validatePdfFile(file: File): Promise<PdfInputValidation> {
	const name = file.name.toLowerCase();
	const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
	const imageMime = (IMAGE_MIMES as readonly string[]).includes(file.type)
		? (file.type as 'image/jpeg' | 'image/png')
		: name.endsWith('.jpg') || name.endsWith('.jpeg')
			? 'image/jpeg'
			: name.endsWith('.png')
				? 'image/png'
				: null;

	if (!isPdf && !imageMime) {
		return {
			ok: false,
			reason: 'unsupported-type',
			message:
				'対応していない形式です。PDF / JPEG / PNG を選択してください（GIF・WebP・SVGは非対応）。',
		};
	}
	if (file.size > MAX_FILE_SIZE_BYTES) {
		return {
			ok: false,
			reason: 'too-large',
			message: 'ファイルサイズが100MBを超えています。',
		};
	}
	if (isPdf) {
		const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
		if (!hasPdfSignature(head)) {
			return {
				ok: false,
				reason: 'invalid-signature',
				message:
					'PDFファイルとして読み込めません。ファイルが破損しているか、PDF形式ではない可能性があります。',
			};
		}
		return { ok: true, kind: 'pdf', mime: 'application/pdf' };
	}
	return {
		ok: true,
		kind: 'image',
		mime: imageMime as 'image/jpeg' | 'image/png',
	};
}

/** 結合対象のファイル数上限（20ファイル）を検証する */
export function validateMergeFileCount(count: number): PdfInputValidation {
	if (count > MAX_MERGE_FILES) {
		return {
			ok: false,
			reason: 'too-many-files',
			message: `一度に結合できるのは${MAX_MERGE_FILES}ファイルまでです。`,
		};
	}
	return { ok: true, kind: 'pdf', mime: 'application/pdf' };
}

/** 合計入力サイズの上限（300MB）を検証する */
export function validateTotalInputSize(totalBytes: number): PdfInputValidation {
	if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
		return {
			ok: false,
			reason: 'total-size-exceeded',
			message: TOTAL_SIZE_EXCEEDED_MESSAGE,
		};
	}
	return { ok: true, kind: 'pdf', mime: 'application/pdf' };
}

/**
 * ページ数と暗号化有無を返す。
 * パスワード付き（暗号化）PDFは `encrypted: true`（pageCount は 0）を返し、
 * `ignoreEncryption` での強行読み込みは行わない。
 */
export async function loadPdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
	const { PDFDocument } = await import('pdf-lib');
	try {
		const doc = await PDFDocument.load(bytes, { updateMetadata: false });
		return { pageCount: doc.getPageCount(), encrypted: false };
	} catch (error) {
		// pdf-lib の EncryptedPDFError は ES5 ダウンレベルの影響で instanceof 判定が
		// 効かないため、暗号化有無の検出に限り ignoreEncryption で再読込して判定する
		// （暗号化PDFの結合・分割処理には使わない）。
		try {
			const doc = await PDFDocument.load(bytes, {
				updateMetadata: false,
				ignoreEncryption: true,
			});
			if (doc.isEncrypted) {
				return { pageCount: 0, encrypted: true };
			}
		} catch {
			// 再読込も失敗した場合は元のエラーを投げる（破損PDFなど）
		}
		throw error;
	}
}

/** マイクロタスク連投によるUIフリーズを避けるため、イベントループへ一度返す */
function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 複数のPDF・画像（JPEG / PNG）を1つのPDFへ結合する。
 * 画像は画像ピクセル寸法を 96dpi 換算した pt サイズの単一ページとして挿入する。
 * 暗号化PDF・破損PDFは pdf-lib の load エラーがそのまま throw される。
 */
export async function mergePdfs(
	inputs: MergeInput[],
	onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
	const { PDFDocument } = await import('pdf-lib');
	const merged = await PDFDocument.create();
	let done = 0;
	for (const input of inputs) {
		if (input.kind === 'pdf') {
			const src = await PDFDocument.load(input.bytes, {
				updateMetadata: false,
			});
			const pages = await merged.copyPages(src, src.getPageIndices());
			for (const page of pages) {
				merged.addPage(page);
			}
		} else {
			const image =
				input.mime === 'image/jpeg'
					? await merged.embedJpg(input.bytes)
					: await merged.embedPng(input.bytes);
			const width = image.width * PX_TO_PT;
			const height = image.height * PX_TO_PT;
			const page = merged.addPage([width, height]);
			page.drawImage(image, { x: 0, y: 0, width, height });
		}
		done++;
		onProgress?.(done, inputs.length);
		await yieldToEventLoop();
	}
	return merged.save();
}

/**
 * `1-3,5,8-` 形式のページ範囲指定をパースする。
 * 全角数字・全角カンマ・空白を許容して正規化する。1始まり・順不同・重複可。
 * 不正トークンは正規化後文字列内の位置つきでエラーを返す。
 */
export function parsePageRanges(input: string, pageCount: number): ParseResult {
	// 全角→半角の正規化: 数字・カンマ・ハイフン類。空白（全角含む）は除去
	const normalizedInput = input
		.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
		.replace(/[，、]/g, ',')
		.replace(/[－ー―‐−〜~]/g, '-')
		.replace(/[\s　]+/g, '');

	const errors: Array<{ token: string; index: number; message: string }> = [];
	const ranges: number[][] = [];

	if (normalizedInput === '') {
		return {
			ok: false,
			errors: [
				{ token: '', index: 0, message: 'ページ範囲を入力してください。' },
			],
			normalizedInput,
		};
	}

	let index = 0;
	for (const token of normalizedInput.split(',')) {
		const tokenIndex = index;
		index += token.length + 1; // 次トークンの開始位置（カンマ分 +1）

		if (token === '') {
			errors.push({
				token,
				index: tokenIndex,
				message:
					'空の指定があります。カンマの間にページ番号を入力してください。',
			});
			continue;
		}
		const match = token.match(/^(\d+)(-(\d*))?$/);
		if (!match) {
			errors.push({
				token,
				index: tokenIndex,
				message: `「${token}」を解釈できません。「1-3」「5」「8-」の形式で入力してください。`,
			});
			continue;
		}
		const start = Number.parseInt(match[1], 10);
		const end =
			match[2] === undefined
				? start
				: match[3] === ''
					? pageCount
					: Number.parseInt(match[3], 10);

		if (start < 1) {
			errors.push({
				token,
				index: tokenIndex,
				message: `「${token}」: ページ番号は1以上で指定してください。`,
			});
			continue;
		}
		if (start > pageCount || end > pageCount) {
			errors.push({
				token,
				index: tokenIndex,
				message: `「${token}」: このPDFは全${pageCount}ページです。${pageCount}以下で指定してください。`,
			});
			continue;
		}
		if (end < start) {
			errors.push({
				token,
				index: tokenIndex,
				message: `「${token}」: 範囲の終了は開始以上で指定してください。`,
			});
			continue;
		}
		const pages: number[] = [];
		for (let p = start; p <= end; p++) {
			pages.push(p);
		}
		ranges.push(pages);
	}

	if (errors.length > 0) {
		return { ok: false, errors, normalizedInput };
	}
	return { ok: true, ranges, normalizedInput };
}

/** 1ページずつ分割するための範囲リスト（[[1],[2],...,[n]]）を生成する */
export function singlePageRanges(pageCount: number): number[][] {
	return Array.from({ length: pageCount }, (_, i) => [i + 1]);
}

/** 分割出力のファイル名を組み立てる（連続範囲は p{start}-{end}、単一ページは p{n}） */
export function splitFileName(baseName: string, pageNumbers: number[]): string {
	if (pageNumbers.length === 1) {
		return `${baseName}_p${pageNumbers[0]}.pdf`;
	}
	const isContiguous = pageNumbers.every(
		(p, i) => i === 0 || p === pageNumbers[i - 1] + 1,
	);
	if (isContiguous) {
		return `${baseName}_p${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}.pdf`;
	}
	// ページ抽出（非連続）は範囲列挙だと長くなるため extract 表記にする
	return `${baseName}_extract.pdf`;
}

/**
 * 1つのPDFを範囲ごとに新規PDFへ分割する。
 * ranges の各要素は 1始まりのページ番号配列（非連続可 = ページ抽出にも使用）。
 */
export async function splitPdf(
	bytes: Uint8Array,
	ranges: number[][],
	baseName = 'document',
	onProgress?: (done: number, total: number) => void,
): Promise<SplitResult[]> {
	const { PDFDocument } = await import('pdf-lib');
	const src = await PDFDocument.load(bytes, { updateMetadata: false });
	const pageCount = src.getPageCount();
	const results: SplitResult[] = [];
	let done = 0;
	for (const pageNumbers of ranges) {
		const invalid = pageNumbers.find((p) => p < 1 || p > pageCount);
		if (invalid !== undefined) {
			throw new Error(
				`ページ番号 ${invalid} は範囲外です（全${pageCount}ページ）。`,
			);
		}
		const out = await PDFDocument.create();
		const pages = await out.copyPages(
			src,
			pageNumbers.map((p) => p - 1),
		);
		for (const page of pages) {
			out.addPage(page);
		}
		results.push({
			bytes: await out.save(),
			fileName: splitFileName(baseName, pageNumbers),
			pageNumbers: [...pageNumbers],
		});
		done++;
		onProgress?.(done, ranges.length);
		await yieldToEventLoop();
	}
	return results;
}
