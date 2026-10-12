import { exceedsMaxCharacters } from '../string-length.ts';
import { extractMermaidCode, protectQuotedStrings } from './mermaid-repair.ts';

export const MERMAID_RENDER_MAX_CHARACTERS = 5_000;
export const MERMAID_RENDER_MAX_STATEMENTS = 50;
export const MERMAID_RENDER_MAX_EDGES = 50;
export const MERMAID_RENDER_MAX_STATEMENT_CHARACTERS = 200;
export const MERMAID_RENDER_MAX_SVG_BYTES = 1024 * 1024;

/** flowchartのラベル・引用文字列内の区切りを文として数えない。 */
function splitFlowchartStatements(code: string): string[] {
	const statements: string[] = [];
	let start = 0;
	let quote = '';
	let escaped = false;
	let depth = 0;
	let pipe = false;
	for (let index = 0; index < code.length; index++) {
		const char = code[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === quote) quote = '';
			continue;
		}
		if (char === '#') {
			const entity = code.slice(index).match(/^#[A-Za-z0-9_]+;/);
			if (entity) {
				index += entity[0].length - 1;
				continue;
			}
		}
		if (depth === 0 && !pipe && char === '%' && code[index + 1] === '%') {
			const statement = code.slice(start, index).trim();
			if (statement) statements.push(statement);
			const newline = code.indexOf('\n', index);
			if (newline === -1) return statements;
			index = newline;
			start = newline + 1;
			continue;
		}
		if (char === '"') quote = char;
		else if (
			char === '>' &&
			depth === 0 &&
			/[\p{L}\p{N}_]/u.test(code[index - 1] ?? '')
		)
			depth++;
		else if ('[({'.includes(char)) depth++;
		else if ('])}'.includes(char)) depth = Math.max(0, depth - 1);
		else if (char === '|' && depth === 0) pipe = !pipe;
		else if (depth === 0 && !pipe && /[;\r\n]/.test(char)) {
			const statement = code.slice(start, index).trim();
			if (statement) statements.push(statement);
			start = index + 1;
		}
	}
	const last = code.slice(start).trim();
	if (last) statements.push(last);
	return statements;
}

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
	const isSequence = /^sequenceDiagram\b/i.test(extracted);
	const flowStatements = isSequence ? [] : splitFlowchartStatements(extracted);
	const checkedCode = isSequence
		? extracted.replace(/^\s*%%[^\r\n]*/gm, '')
		: flowStatements.join('\n');
	const statements = isSequence
		? checkedCode.split(/[;\r\n]+/).filter((part) => part.trim())
		: flowStatements;
	if (statements.length > MERMAID_RENDER_MAX_STATEMENTS)
		throw new Error('SVG描画は改行・セミコロン区切りで50文までです。');
	// 描画器の共有設定だけに頼らず、矢印記法も入口で保守的に数える。
	const syntax = protectQuotedStrings(checkedCode, () => '');
	const structuralSyntax = isSequence
		? syntax.replace(/:[^\r\n]*|\s+as\s+[^;\r\n]*|^\s*box\s+[^;\r\n]*/gm, '')
		: syntax
				.replace(
					/[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?>[^\]\r\n]*\]/gu,
					'',
				)
				.replace(
					/\[[^\]\r\n]*\]|\([^)\r\n]*\)|(?<!@)\{[^}\r\n]*\}|\|[^|\r\n]*\|/g,
					'',
				)
				.replace(/[-=.]{2}\s+[^;\r\n]*?\s+[-=.]{2}>/g, '-->')
				.replace(/^\s*subgraph\s+[^;\r\n]*/gm, 'subgraph');
	// sequenceは1文1メッセージで文数上限が仕事量を制限する。
	// ブロック見出しの矢印文字や&はリンク構文ではない。
	const arrows = isSequence
		? []
		: (structuralSyntax.match(/[-=~.]{2,}[<>|ox]?|->|<-|=>|<=/g) ?? []);
	if (arrows.length > MERMAID_RENDER_MAX_EDGES)
		throw new Error('SVG描画は50エッジまでです。');

	if (
		statements.some((statement) =>
			exceedsMaxCharacters(statement, MERMAID_RENDER_MAX_STATEMENT_CHARACTERS),
		)
	)
		throw new Error('SVG描画の各文は200文字までです。');
	if (checkedCode.includes('`'))
		throw new Error('SVG描画ではMarkdownラベルは利用できません。');
	if (code.includes('%%{') || code.trimStart().startsWith('---'))
		throw new Error(
			'SVG描画では設定ディレクティブ・frontmatterは利用できません。',
		);
	// 小型図の予算を超える並列リンク展開、外部画像やHTML描画を受け付けない。
	// &はラベル・メッセージ中では通常の文字。構造部分だけを検査する。

	if (
		(!isSequence && structuralSyntax.includes('&')) ||
		structuralSyntax.includes('@{') ||
		structuralSyntax.includes('![') ||
		/<\s*\/?\s*[A-Za-z][\w:-]*(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>[\]{}]+))?)*\s*\/?>/.test(
			checkedCode,
		)
	)
		throw new Error(
			'SVG描画では&による並列リンク・拡張シェイプ・画像・HTMLは利用できません。',
		);
}
