// text-output.ts — 抽出・認識したテキストの表示とTXT保存で共用する純粋関数。
// 画像文字起こし（image-ocr）とPDFテキスト抽出（pdf-to-text）で使う。

/** 改行コードをLFに統一する。文字や空白は変更しない */
export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

/** 文字数（コードポイント数）。サロゲートペアを1文字として数える */
export function countCharacters(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

/** 保存用のUTF-8（BOMなし）Blob。改行はLFに統一する */
export function buildTxtBlob(text: string): Blob {
	return new Blob([normalizeNewlines(text)], {
		type: 'text/plain;charset=utf-8',
	});
}
