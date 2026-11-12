// format-bytes.ts — バイト数を人が読める表記（B / KB / MB）にする共通関数。
// ファイルサイズ表示を行う複数ツール（PDF系・画像系）で共用する。

/** 1024未満は「B」、1MiB未満は小数1桁の「KB」、それ以上は小数2桁の「MB」で返す */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
