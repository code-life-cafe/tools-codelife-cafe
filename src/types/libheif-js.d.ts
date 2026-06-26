// libheif-js（LGPL-3.0）のブラウザ向けバンドル `libheif-js/wasm-bundle` の最小型宣言。
// 本パッケージは型定義を同梱しないため、HEICデコードで使う API のみを宣言する。
// 実体は /image-convert でのみ dynamic import される（共通バンドルには含めない）。

declare module 'libheif-js/wasm-bundle' {
	export interface HeifImage {
		get_width(): number;
		get_height(): number;
		/** imageData に RGBA を書き込み、完了後にコールバックへ同じ ImageData（失敗時は null）を渡す */
		display(
			imageData: ImageData,
			callback: (displayData: ImageData | null) => void,
		): void;
		free?(): void;
	}

	export interface HeifDecoder {
		decode(buffer: Uint8Array | ArrayBuffer): HeifImage[];
	}

	export interface LibHeif {
		HeifDecoder: new () => HeifDecoder;
	}

	const libheif: LibHeif;
	export default libheif;
}
