import { exceedsMaxCharacters } from '../string-length.ts';

export const MERMAID_RENDER_MAX_CHARACTERS = 5_000;
export const MERMAID_RENDER_MAX_STATEMENTS = 50;
export const MERMAID_RENDER_MAX_EDGES = 50;
export const MERMAID_RENDER_MAX_SVG_BYTES = 1024 * 1024;

/** DOM描画に入る前に、小型図に限定する。Promiseのタイマーでは同期描画を中断できない。 */
export function assertMermaidRenderBudget(code: string): void {
	if (exceedsMaxCharacters(code, MERMAID_RENDER_MAX_CHARACTERS))
		throw new Error(
			'SVG描画の上限は5000文字です。大きな図は修復のみを利用してください。',
		);
	const statements = code.split(/[;\r\n]+/).filter((part) => part.trim());
	if (statements.length > MERMAID_RENDER_MAX_STATEMENTS)
		throw new Error('SVG描画は改行・セミコロン区切りで50文までです。');
	if (code.includes('%%{') || code.trimStart().startsWith('---'))
		throw new Error(
			'SVG描画では設定ディレクティブ・frontmatterは利用できません。',
		);
	// 小型図の予算を超える並列リンク展開、外部画像やHTML描画を受け付けない。
	if (
		code.includes('&') ||
		code.includes('@{') ||
		code.includes('![') ||
		/<\s*\/?\s*[A-Za-z]/.test(code)
	)
		throw new Error(
			'SVG描画では&による並列リンク・拡張シェイプ・画像・HTMLは利用できません。',
		);
}
