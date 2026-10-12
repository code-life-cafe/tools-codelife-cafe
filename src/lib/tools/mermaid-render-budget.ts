import { exceedsMaxCharacters } from '../string-length.ts';
import { extractMermaidCode } from './mermaid-repair.ts';

export const MERMAID_RENDER_MAX_CHARACTERS = 5_000;
export const MERMAID_RENDER_MAX_STATEMENTS = 50;
export const MERMAID_RENDER_MAX_EDGES = 50;
export const MERMAID_RENDER_MAX_STATEMENT_CHARACTERS = 200;
export const MERMAID_RENDER_MAX_SVG_BYTES = 1024 * 1024;

/** DOM描画に入る前に、小型図に限定する。Promiseのタイマーでは同期描画を中断できない。 */
export function assertMermaidRenderBudget(code: string): void {
	if (exceedsMaxCharacters(code, MERMAID_RENDER_MAX_CHARACTERS))
		throw new Error(
			'SVG描画の上限は5000文字です。大きな図は修復のみを利用してください。',
		);
	const extracted = extractMermaidCode(code).code;
	if (
		!/^(?:(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b)/i.test(
			extracted,
		)
	)
		throw new Error(
			'SVG描画はフローチャート（flowchart/graph）とシーケンス図のみ対応しています。他の図種は修復または通常UIを利用してください。',
		);
	const statements = code.split(/[;\r\n]+/).filter((part) => part.trim());
	if (statements.length > MERMAID_RENDER_MAX_STATEMENTS)
		throw new Error('SVG描画は改行・セミコロン区切りで50文までです。');
	// 描画器の共有設定だけに頼らず、矢印記法も入口で保守的に数える。
	const syntax = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
	const structuralSyntax = /^sequenceDiagram\b/i.test(extracted)
		? syntax.replace(/:[^\r\n]*|\s+as\s+[^;\r\n]*|^\s*box\s+[^;\r\n]*/gm, '')
		: syntax
				.replace(
					/\[[^\]\r\n]*\]|\([^)\r\n]*\)|\{[^}\r\n]*\}|\|[^|\r\n]*\|/g,
					'',
				)
				.replace(/[-=.]{2}\s+[^;\r\n]*?\s+[-=.]{2}>/g, '-->')
				.replace(/^\s*subgraph\s+[^;\r\n]*/gm, 'subgraph');
	const arrows =
		structuralSyntax.match(/[-=~.]{2,}[<>|ox]?|->|<-|=>|<=/g) ?? [];
	if (arrows.length > MERMAID_RENDER_MAX_EDGES)
		throw new Error('SVG描画は50エッジまでです。');

	if (
		statements.some((statement) =>
			exceedsMaxCharacters(statement, MERMAID_RENDER_MAX_STATEMENT_CHARACTERS),
		)
	)
		throw new Error('SVG描画の各文は200文字までです。');
	if (extracted.includes('`'))
		throw new Error('SVG描画ではMarkdownラベルは利用できません。');
	if (code.includes('%%{') || code.trimStart().startsWith('---'))
		throw new Error(
			'SVG描画では設定ディレクティブ・frontmatterは利用できません。',
		);
	// 小型図の予算を超える並列リンク展開、外部画像やHTML描画を受け付けない。
	// &はラベル・メッセージ中では通常の文字。構造部分だけを検査する。

	if (
		structuralSyntax.includes('&') ||
		code.includes('@{') ||
		code.includes('![') ||
		/<\s*\/?\s*[A-Za-z][\w:-]*(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>[\]{}]+))?)*\s*\/?>/.test(
			code,
		)
	)
		throw new Error(
			'SVG描画では&による並列リンク・拡張シェイプ・画像・HTMLは利用できません。',
		);
}
