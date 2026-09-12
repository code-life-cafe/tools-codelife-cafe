/**
 * Mermaidコード内の修正履歴
 */
export interface RepairChange {
	lineNumber: number;
	rule: string;
	description: string;
	original: string;
	fixed: string;
}

/**
 * 自動修復結果
 */
export interface MermaidRepairResult {
	originalCode: string;
	repairedCode: string;
	isModified: boolean;
	changes: RepairChange[];
}

/**
 * サポートするMermaidダイアグラム宣言の先頭パターン
 */
const DIAGRAM_HEADER_REGEX =
	/^(?:(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram(?:-v2)?\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|pie(?:\s+title)?\b|gitGraph\b|mindmap\b|quadrantChart\b|timeline\b|c4Context\b|sankey-beta\b|kanban\b|architecture-beta\b|block-beta\b|packet-beta\b|requirementDiagram\b)/i;

/**
 * AIが出力したMarkdownコードフェンスや前後の会話テキストを検出し、
 * 純粋なMermaidコードブロックを抽出する
 */
export function extractMermaidCode(rawText: string): {
	code: string;
	extracted: boolean;
	fenceRemoved: boolean;
} {
	const trimmed = rawText.trim();
	let code = trimmed;
	let fenceRemoved = false;
	let extracted = false;

	// 1. ```mermaid ... ``` を優先探索（複数コードブロックがあってもmermaid指定を優先）
	const mermaidFenceMatch = /```mermaid\s*([\s\S]*?)```/i.exec(code);
	if (mermaidFenceMatch?.[1]) {
		code = mermaidFenceMatch[1].trim();
		fenceRemoved = true;
		extracted = true;
	} else {
		// mermaid指定がない場合、ダイアグラム宣言を含む ``` ... ``` を探索
		const allFencesRegex = /```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/gi;
		let fenceMatch: RegExpExecArray | null = allFencesRegex.exec(code);
		while (fenceMatch !== null) {
			const candidate = fenceMatch[1].trim();
			const firstLine = candidate.split(/\r?\n/)[0]?.trim() ?? '';
			if (DIAGRAM_HEADER_REGEX.test(firstLine)) {
				code = candidate;
				fenceRemoved = true;
				extracted = true;
				break;
			}
			fenceMatch = allFencesRegex.exec(code);
		}

		if (!extracted) {
			// 先頭の ```mermaid や ``` のみの除去
			if (/^```(?:mermaid)?\s*/i.test(code)) {
				code = code.replace(/^```(?:mermaid)?\s*/i, '');
				fenceRemoved = true;
			}
			if (/```\s*$/.test(code)) {
				code = code.replace(/```\s*$/, '');
				fenceRemoved = true;
			}
		}
	}

	// 2. 前後の会話テキストのトリム（厳格なMermaid宣言行で検出）
	const lines = code.split(/\r?\n/);
	let startIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (DIAGRAM_HEADER_REGEX.test(line)) {
			startIndex = i;
			break;
		}
	}

	if (startIndex > 0) {
		lines.splice(0, startIndex);
		extracted = true;
	}

	// 末尾の会話文（典型的なAIの挨拶・確認文）をトリム
	while (lines.length > 1) {
		const lastLine = lines[lines.length - 1].trim();
		if (!lastLine) {
			lines.pop();
			continue;
		}
		if (
			/^(?:以上(?:です|となります|でございます)?|ご確認(?:ください|よろしく|お願い)|いかがでしょうか)[。！!]*$/i.test(
				lastLine,
			)
		) {
			lines.pop();
			extracted = true;
			continue;
		}
		break;
	}

	return {
		code: lines.join('\n').trim(),
		extracted,
		fenceRemoved,
	};
}

/**
 * スマートクォート（“” ‘’）を標準のクォート（" '）に置換する
 */
export function normalizeSmartQuotes(line: string): string {
	return line.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

/**
 * 文字列リテラル（"..." / '...'）を一時保護し、構文位置のみを処理するヘルパー
 */
function withProtectedStrings(
	line: string,
	transformSyntax: (syntaxOnlyLine: string) => string,
): string {
	const literals: string[] = [];
	const protectedLine = line.replace(
		/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
		(match) => {
			literals.push(match);
			return `__MERMAID_STR_${literals.length - 1}__`;
		},
	);

	const transformed = transformSyntax(protectedLine);

	return transformed.replace(
		/__MERMAID_STR_(\d+)__/g,
		(_match, index) => literals[Number(index)] ?? '',
	);
}

/**
 * 未クォートのノード定義（[...]、(...)、{...}等）のラベル本文を一時保護するヘルパー
 */
function withProtectedNodeLabels(
	line: string,
	transformSyntax: (syntaxOnlyLine: string) => string,
): string {
	const labels: string[] = [];
	// ノードID + 開き括弧 + 中身 + 閉じ括弧
	// 例: A[ラベル], node1(ラベル), A{ラベル}, A([ラベル]), A[[ラベル]], A((ラベル))
	const protectedLine = line.replace(
		/(\b[A-Za-z0-9_]+|[^\s\->|;:[({]+)(\[{1,2}|\({1,2}|\{{1,2}|\[\([/\\<])([\s\S]*?)(\]{1,2}|\){1,2}|\}{1,2}|[/\\>]\)\])(?=\s*(?:-->|---|==>|-\.->|--|==|&|;|$))/g,
		(_match, id, openBrackets, content, closeBrackets) => {
			labels.push(content);
			return `${id}${openBrackets}__MERMAID_LABEL_${labels.length - 1}__${closeBrackets}`;
		},
	);

	const transformed = transformSyntax(protectedLine);

	return transformed.replace(
		/__MERMAID_LABEL_(\d+)__/g,
		(_match, index) => labels[Number(index)] ?? '',
	);
}

/**
 * 構文位置にある全角記号を半角に置換する。
 * 【重要制約】クォートされた文字列およびノードラベル本文内の「：」「（）」などの日本語本文は一切変更しない。
 */
export function replaceSyntaxZenkaku(line: string): string {
	return withProtectedStrings(line, (syntaxLine) => {
		let res = syntaxLine;

		// 1. 全角スペース（インデント・矢印周辺）
		res = res.replace(/^[　]+/g, (m) => '  '.repeat(m.length));
		res = res.replace(/　+(?=(?:-->|---|==>|-\.->|--|==))/g, ' ');
		res = res.replace(/(?:-->|---|==>|-\.->|--|==)　+/g, (m) =>
			m.replace(/　/g, ' '),
		);

		// 2. 全角矢印・長音混入矢印
		res = res.replace(/ーー＞/g, '-->');
		res = res.replace(/ーー>>/g, '-->>');
		res = res.replace(/ー+>/g, '-->');
		res = res.replace(/--＞/g, '-->');
		res = res.replace(/→/g, '-->');
		res = res.replace(/==＞/g, '==>');

		// 3. ノード定義括弧の全角ブラケット・全角丸括弧・全角波括弧を半角化
		res = res.replace(/(\b[A-Za-z0-9_]+)［([\s\S]*?)］/g, '$1[$2]');
		res = res.replace(/(\b[A-Za-z0-9_]+)（([\s\S]*?)）/g, '$1($2)');
		res = res.replace(/(\b[A-Za-z0-9_]+)｛([\s\S]*?)｝/g, '$1{$2}');
		res = res.replace(/｛([\s\S]*?)｝/g, '{$1}');

		// 4. ノードラベル本文を保護した上で、構文位置のコロン・カンマを置換
		res = withProtectedNodeLabels(res, (nodeProtected) => {
			let s = nodeProtected;

			// 構文位置の全角コロン（ラベル本文は上記で保護済み）
			s = s.replace(/(>>|-->>|->|-->|--|==|--x|-x)：/g, '$1: ');
			s = s.replace(/(\S)\s*：\s*/g, '$1: ');

			// gantt: 全角カンマ
			s = s.replace(/，/g, ', ');

			return s;
		});

		return res;
	});
}

/**
 * ノードラベル内に未クォートの丸括弧・角括弧・セミコロン・スラッシュ等が含まれている場合、
 * ラベル全体を安全に ["..."] で囲む
 */
export function safeQuoteNodeLabels(line: string): string {
	let res = line;

	// 1. 角括弧ノード: ID[...] を安全にクォート
	res = res.replace(
		/(\b[A-Za-z0-9_]+)\[([\s\S]*?)\](?=\s*(?:-->|---|==>|-\.->|--|==|&|;|$))/g,
		(_match, id, content) => {
			const trimmed = content.trim();
			if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
				return `${id}[${content}]`;
			}
			if (/[();/:,\s[\]]/.test(trimmed)) {
				return `${id}["${trimmed.replace(/"/g, "'")}"]`;
			}
			return `${id}[${content}]`;
		},
	);

	// 2. 丸括弧ノード（角丸ノード）: ID(...)
	res = res.replace(
		/(\b[A-Za-z0-9_]+)\(([\s\S]*?)\)(?=\s*(?:-->|---|==>|-\.->|--|==|&|;|$))/g,
		(_match, id, content) => {
			const trimmed = content.trim();
			if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
				return `${id}(${content})`;
			}
			if (/[();/:,\s]/.test(trimmed)) {
				return `${id}("${trimmed.replace(/"/g, "'")}")`;
			}
			return `${id}(${content})`;
		},
	);

	// 3. ER図の未クォート日本語リレーション名
	res = res.replace(
		/(\|\|--o\{|\|\|--\|\||\}\|--o\{|\}\|--\|\|)\s*([A-Za-z0-9_]+)\s*:\s*([^"\n\r]+)$/,
		(match, rel, entity, label) => {
			const trimmedLabel = label.trim();
			if (!trimmedLabel.startsWith('"') || !trimmedLabel.endsWith('"')) {
				return `${rel} ${entity} : "${trimmedLabel.replace(/"/g, "'")}"`;
			}
			return match;
		},
	);

	// 4. ガントチャートの日付行に混入した日本語曜日 (月) (火) などを除去
	res = res.replace(/(\d{4}-\d{2}-\d{2})\s*\([日月火水木金土]\)/g, '$1');

	// 5. ノードID自体に日本語括弧が直接使われている場合の補正（始点・終点の双方に対応）
	// 始点ノード: ユーザー登録(仮) -->
	res = res.replace(
		/^(\s*)([^\s\->[({]+)\(([^)]+)\)(\s*(?:-->|---|==>|-\.->|--|==))/,
		'$1node_$2["$2($3)"]$4',
	);
	// 終点ノード: --> マイページ(本会員)
	res = res.replace(
		/((?:-->|---|==>|-\.->|--|==)\s*)([^\s\->[({;]+)\(([^)]+)\)(\s*(?:-->|---|==>|-\.->|--|==|;|$))/,
		'$1node_$2["$2($3)"]$4',
	);

	return res;
}

interface BlockScope {
	type: 'subgraph' | 'brace' | 'sequence_block';
	indent: string;
}

/**
 * 未完了ブロック（subgraphのend閉じ忘れ、class/stateの{}閉じ忘れ）を
 * ネストスタックに基づいて堅牢に追跡・補完する
 */
export function autoCloseBlocks(lines: string[]): {
	lines: string[];
	added: string[];
} {
	const result = [...lines];
	const added: string[] = [];
	const stack: BlockScope[] = [];

	for (const rawLine of result) {
		const line = rawLine.trim();
		// コメント行 %% はスキップ
		if (line.startsWith('%%')) continue;

		const indentMatch = rawLine.match(/^(\s*)/);
		const indent = indentMatch ? indentMatch[1] : '';

		// 1. subgraph 開始
		if (/^subgraph\b/.test(line)) {
			stack.push({ type: 'subgraph', indent });
			continue;
		}

		// 2. sequenceDiagram のブロック構文 (opt, alt, loop, rect, par, critical, break)
		if (/^(?:opt|alt|loop|rect|par|critical|break)\b/.test(line)) {
			stack.push({ type: 'sequence_block', indent });
			continue;
		}

		// 3. 中括弧ブロック開始 (class ... { / state ... {) ※同一行で閉じていないもの
		if (/^(?:class|state)\b.*\{$/.test(line)) {
			stack.push({ type: 'brace', indent });
			continue;
		}

		// 4. end 終了行
		if (line === 'end') {
			// スタックを末尾から探索し、直近の subgraph または sequence_block を pop
			for (let i = stack.length - 1; i >= 0; i--) {
				if (
					stack[i].type === 'subgraph' ||
					stack[i].type === 'sequence_block'
				) {
					stack.splice(i, 1);
					break;
				}
			}
			continue;
		}

		// 5. } 終了行
		if (line === '}') {
			// スタックを末尾から探索し、直近の brace を pop
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].type === 'brace') {
					stack.splice(i, 1);
					break;
				}
			}
		}
	}

	// スタックに残っている未終了ブロックを後ろから補完
	while (stack.length > 0) {
		const unclosed = stack.pop();
		if (!unclosed) break;

		if (unclosed.type === 'subgraph' || unclosed.type === 'sequence_block') {
			const indent = unclosed.indent || '    ';
			result.push(`${indent}end`);
			added.push(`末尾に閉じタグ \`end\` を補完しました`);
		} else if (unclosed.type === 'brace') {
			const indent = unclosed.indent || '';
			result.push(`${indent}}`);
			added.push(`末尾に閉じ括弧 \`}\` を補完しました`);
		}
	}

	return { lines: result, added };
}

/**
 * Mermaidコード全体の自動修復を実行するメイン純粋関数
 */
export function repairMermaidCode(rawInput: string): MermaidRepairResult {
	const changes: RepairChange[] = [];

	// Step 1: フェンス・会話文の抽出
	const {
		code: extractedCode,
		extracted,
		fenceRemoved,
	} = extractMermaidCode(rawInput);
	if (fenceRemoved || extracted) {
		changes.push({
			lineNumber: 1,
			rule: 'extract-diagram',
			description:
				'Markdownコードフェンスまたは前後の会話テキストを除去しました',
			original: rawInput.slice(0, 40),
			fixed: extractedCode.slice(0, 40),
		});
	}

	const rawLines = extractedCode.split(/\r?\n/);
	const processedLines: string[] = [];

	for (let i = 0; i < rawLines.length; i++) {
		const origLine = rawLines[i];
		let curLine = origLine;

		// Step 2: スマートクォート正規化
		const normalizedQuote = normalizeSmartQuotes(curLine);
		if (normalizedQuote !== curLine) {
			changes.push({
				lineNumber: i + 1,
				rule: 'smart-quotes',
				description:
					'スマートクォート（“” ‘’）を標準の半角引用符に置換しました',
				original: curLine.trim(),
				fixed: normalizedQuote.trim(),
			});
			curLine = normalizedQuote;
		}

		// Step 3: 全角記号の置換（構文位置のみ）
		const syntaxNormalized = replaceSyntaxZenkaku(curLine);
		if (syntaxNormalized !== curLine) {
			changes.push({
				lineNumber: i + 1,
				rule: 'zenkaku-syntax',
				description:
					'構文位置の全角記号（矢印・括弧・コロン・スペース）を半角に置換しました',
				original: curLine.trim(),
				fixed: syntaxNormalized.trim(),
			});
			curLine = syntaxNormalized;
		}

		// Step 4: 未クォートノードラベルの安全なクォート
		const quotedLine = safeQuoteNodeLabels(curLine);
		if (quotedLine !== curLine) {
			changes.push({
				lineNumber: i + 1,
				rule: 'safe-quotes',
				description:
					'特殊記号や括弧を含むノードラベルを安全に二重引用符で囲みました',
				original: curLine.trim(),
				fixed: quotedLine.trim(),
			});
			curLine = quotedLine;
		}

		processedLines.push(curLine);
	}

	// Step 5: ブロックの閉じ忘れ補完
	const { lines: finalLines, added } = autoCloseBlocks(processedLines);
	for (const addMsg of added) {
		changes.push({
			lineNumber: finalLines.length,
			rule: 'auto-close',
			description: addMsg,
			original: '(未終了ブロック)',
			fixed: finalLines[finalLines.length - 1],
		});
	}

	const repairedCode = finalLines.join('\n');
	const isModified = repairedCode !== rawInput.trim();

	return {
		originalCode: rawInput,
		repairedCode,
		isModified,
		changes,
	};
}
