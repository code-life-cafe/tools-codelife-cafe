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
	/** 入力が上限を超えた等で修復を実行しなかった場合の理由 */
	error?: string;
}

/** 修復を受け付ける入力の最大文字数（超える入力は修復せずそのまま返す） */
export const MAX_REPAIR_INPUT_LENGTH = 100_000;

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
 * `A -- text --> B` 形式のエッジラベル本文を protect で置換する。
 * 以前の正規表現
 *   (?<![-=.>])((?:--|==|-\.)\s+)([^\n]*?)(\s+)(?=<終端コネクタ>)
 * と同じ結果を、単一パスで返す。未対応の開始 `--` ごとに後続を再走査すると
 * 二乗時間になるため、終端コネクタ位置を先に1回だけ収集し、開始位置の
 * 単調増加に合わせて cursor で消費する。
 *   終端コネクタ: -{2,}[>xo]? / ={2,}[>xo]? / -?\.+->[xo]? / \.- / → / ー+[>＞]
 */
export function protectDashedEdgeLabels(
	s: string,
	protect: (label: string) => string,
): string {
	const n = s.length;
	const isWs = (i: number): boolean => /\s/.test(s[i]);

	// '.' / 'ー' の連続の直後が "->" / ">＞" かを後ろから1回で求める（連続長に依存しない）
	const dotOk = new Uint8Array(n + 1);
	const dashOk = new Uint8Array(n + 1);
	for (let i = n - 1; i >= 0; i--) {
		if (s[i] === '.') {
			dotOk[i] =
				s[i + 1] === '.' ? dotOk[i + 1] : s.startsWith('->', i + 1) ? 1 : 0;
		} else if (s[i] === 'ー') {
			dashOk[i] =
				s[i + 1] === 'ー'
					? dashOk[i + 1]
					: s[i + 1] === '>' || s[i + 1] === '＞'
						? 1
						: 0;
		}
	}
	const isConnector = (c: number): boolean => {
		switch (s[c]) {
			case '-':
				return s[c + 1] === '-' || (s[c + 1] === '.' && dotOk[c + 1] === 1);
			case '=':
				return s[c + 1] === '=';
			case '.':
				return dotOk[c] === 1 || s[c + 1] === '-';
			case '→':
				return true;
			case 'ー':
				return dashOk[c] === 1;
			default:
				return false;
		}
	};

	// 直前が空白で始まる終端コネクタ位置、空白連続の開始位置、次の改行位置
	const closers: number[] = [];
	const wsStart = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		wsStart[i] = isWs(i) ? (i > 0 && isWs(i - 1) ? wsStart[i - 1] : i) : i;
		if (i > 0 && isWs(i - 1) && isConnector(i)) closers.push(i);
	}
	const nextNewline = new Int32Array(n + 1);
	nextNewline[n] = n;
	for (let i = n - 1; i >= 0; i--) {
		nextNewline[i] = s[i] === '\n' ? i : nextNewline[i + 1];
	}

	let out = '';
	let last = 0;
	let cursor = 0;
	let i = 0;
	while (i < n - 2) {
		const isOpen =
			(s.startsWith('--', i) ||
				s.startsWith('==', i) ||
				s.startsWith('-.', i)) &&
			(i === 0 || !'-=.>'.includes(s[i - 1]));
		if (!isOpen || !isWs(i + 2)) {
			i++;
			continue;
		}
		let w = i + 2;
		while (w < n && isWs(w)) w++;
		while (cursor < closers.length && closers[cursor] <= w) cursor++;

		let textEnd = -1;
		let closer = -1;
		let textStart = w;
		if (cursor < closers.length) {
			const c = closers[cursor];
			const t = wsStart[c - 1];
			if (nextNewline[w] >= t) {
				textEnd = t;
				closer = c;
			}
		}
		if (closer === -1 && w < n && w - (i + 2) >= 2 && isConnector(w)) {
			// 開始直後の空白を1文字だけ後ろへ譲り、本文が空のラベルとして扱う
			textStart = w - 1;
			textEnd = w - 1;
			closer = w;
		}
		if (closer === -1) {
			i++;
			continue;
		}
		out += s.slice(last, textStart) + protect(s.slice(textStart, textEnd));
		last = textEnd;
		i = closer;
	}
	return out + s.slice(last);
}

/**
 * 文字列リテラル（"..." / '...'）を一時保護し、構文位置のみを処理するヘルパー
 */
function markerPrefix(line: string, kind: string): string {
	// 行内の `__MERMAID_<kind>_<n>_` 形式の nonce を1回の線形走査で集め、
	// 最小の未使用 nonce を接頭辞に使う。接頭辞は行内に現れないため衝突せず、
	// 長さは出現数の桁数程度（入力サイズの対数）で、アンダースコア列の長さに依存しない。
	const used = new Set<string>();
	for (const m of line.matchAll(new RegExp(`__MERMAID_${kind}_(\\d+)_`, 'g'))) {
		used.add(m[1]);
	}
	let nonce = 0;
	while (used.has(String(nonce))) nonce++;
	return `__MERMAID_${kind}_${nonce}_`;
}

/**
 * `${prefix}<数字>__` 形式のマーカーを values の値へ戻す。
 * 接頭辞長に比例する巨大なRegExpをコンパイルせず、indexOfで線形に走査する。
 */
function restoreMarkers(
	text: string,
	prefix: string,
	values: readonly string[],
): string {
	let out = '';
	let pos = 0;
	while (pos < text.length) {
		const at = text.indexOf(prefix, pos);
		if (at === -1) break;
		const digitsStart = at + prefix.length;
		let end = digitsStart;
		while (
			end < text.length &&
			text.charCodeAt(end) >= 48 &&
			text.charCodeAt(end) <= 57
		) {
			end++;
		}
		if (end > digitsStart && text.startsWith('__', end)) {
			out += text.slice(pos, at);
			out += values[Number(text.slice(digitsStart, end))] ?? '';
			pos = end + 2;
		} else {
			out += text.slice(pos, at + 1);
			pos = at + 1;
		}
	}
	return out + text.slice(pos);
}

function withProtectedStrings(
	line: string,
	transformSyntax: (syntaxOnlyLine: string) => string,
): string {
	const literals: string[] = [];
	const prefix = markerPrefix(line, 'STR');
	const protectedLine = line.replace(
		/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
		(match) => {
			literals.push(match);
			return `${prefix}${literals.length - 1}__`;
		},
	);

	const transformed = transformSyntax(protectedLine);

	return restoreMarkers(transformed, prefix, literals);
}

/**
 * ノード定義 `ID<開き括弧>本文<閉じ括弧>` の本文を protect の戻り値へ置換する。
 * 以前の正規表現
 *   (\b[A-Za-z0-9_]+|[^\s\->|;:[({]+)(\[{1,2}|\({1,2}|\{{1,2}|\[\([/\\<]|>)([\s\S]*?)
 *   (\]{1,2}|\){1,2}|\}{1,2}|[/\\>]\)\])(?=<後続>)
 * と同じ結果を線形時間で返す。旧実装は未対応の開き括弧ごとに後続全体を再走査し、
 * 長いID連続でも開始位置ごとに短いIDへバックトラックしていた。
 *   - 閉じ括弧の候補（括弧種別 + 後続lookahead成立）は開き側と無関係なので、
 *     位置ごとに1回だけ求め、各開き括弧は「oEnd以降で最初の候補」をO(1)で引く。
 *   - IDは開き括弧の直前まで続く連続(最大長)以外は必ず失敗するため、
 *     各開始位置の候補は高々2つ(ASCII語連続 / 除外文字を含まない連続)で、
 *     開き括弧位置ごとの結果はメモ化する。
 */
export function protectNodeLabelBodies(
	s: string,
	protect: (content: string) => string,
): string {
	const n = s.length;
	const code = (i: number): number => s.charCodeAt(i);
	const isAsciiWord = (i: number): boolean => {
		const c = code(i);
		return (
			(c >= 48 && c <= 57) ||
			(c >= 65 && c <= 90) ||
			(c >= 97 && c <= 122) ||
			c === 95
		);
	};
	const wsTest = /\s/;
	const isWs = new Uint8Array(n + 1);
	for (let i = 0; i < n; i++) isWs[i] = wsTest.test(s[i]) ? 1 : 0;

	// 後ろ向きに各種連続の終端を求める
	const wsEnd = new Int32Array(n + 2);
	const wordEnd = new Int32Array(n + 2); // [\w-] の連続
	const idEnd = new Int32Array(n + 2); // [A-Za-z0-9_] の連続
	const classEnd = new Int32Array(n + 2); // [^\s\->|;:[({] の連続
	const dashOk = new Uint8Array(n + 2); // ー+ の直後が > / ＞
	wsEnd[n] = wsEnd[n + 1] = wordEnd[n] = wordEnd[n + 1] = n;
	idEnd[n] = idEnd[n + 1] = classEnd[n] = classEnd[n + 1] = n;
	const excluded = '->|;:[({';
	for (let i = n - 1; i >= 0; i--) {
		wsEnd[i] = isWs[i] ? wsEnd[i + 1] : i;
		wordEnd[i] = isAsciiWord(i) || s[i] === '-' ? wordEnd[i + 1] : i;
		idEnd[i] = isAsciiWord(i) ? idEnd[i + 1] : i;
		classEnd[i] = isWs[i] || excluded.includes(s[i]) ? i : classEnd[i + 1];
		if (s[i] === 'ー') {
			dashOk[i] =
				s[i + 1] === 'ー'
					? dashOk[i + 1]
					: s[i + 1] === '>' || s[i + 1] === '＞'
						? 1
						: 0;
		}
	}

	// 後続lookahead: (?::::[\w-]+)?\s*(?:[\w-]+@\s*)?(?:接続子|区切り|行末)
	const altAt = new Uint8Array(n + 1);
	const altPrefix = new Int32Array(n + 2);
	for (let z = 0; z <= n; z++) {
		let ok = z === n;
		if (!ok) {
			const c = s[z];
			const c1 = s[z + 1];
			ok =
				(c === '-' && (c1 === '-' || c1 === '.')) ||
				(c === '=' && c1 === '=') ||
				(c === '~' && c1 === '~' && s[z + 2] === '~') ||
				(c === '<' && (c1 === '-' || c1 === '=')) ||
				((c === 'o' || c === 'x') &&
					((c1 === '-' && s[z + 2] === '-') ||
						(c1 === '=' && s[z + 2] === '='))) ||
				c === '→' ||
				c === '&' ||
				c === ';' ||
				(c === 'ー' && dashOk[z] === 1);
		}
		altAt[z] = ok ? 1 : 0;
		altPrefix[z + 1] = altPrefix[z] + altAt[z];
	}
	/** クラス名の後: \s*(?:[\w-]+@\s*)?ALT */
	const afterClass = (y: number): boolean => {
		const w = wsEnd[y];
		if (altAt[w]) return true;
		if (w < n) {
			const we = wordEnd[w];
			if (we > w && we < n && s[we] === '@') return altAt[wsEnd[we + 1]] === 1;
		}
		return false;
	};
	const lookaheadOk = (x: number): boolean => {
		if (afterClass(x)) return true;
		if (s.startsWith(':::', x)) {
			const y0 = x + 3;
			const we0 = wordEnd[y0];
			if (we0 > y0) {
				// クラス名 = y0 から k(>=1) 文字。名前の途中(y<we0)では語連続が we0 まで続く
				const lo = y0 + 1;
				const hi = we0 - 1;
				if (hi >= lo) {
					const atSign =
						we0 < n && s[we0] === '@' && altAt[wsEnd[we0 + 1]] === 1;
					if (atSign || altPrefix[hi + 1] - altPrefix[lo] > 0) return true;
				}
				if (afterClass(we0)) return true;
			}
		}
		return false;
	};

	// 閉じ括弧の候補長(0=候補なし)と、位置以降で最初の候補位置
	const closeLen = new Uint8Array(n + 1);
	const nextClose = new Int32Array(n + 2).fill(-1);
	for (let e = n - 1; e >= 0; e--) {
		const c = s[e];
		let len = 0;
		if (c === ']' || c === ')' || c === '}') {
			if (s[e + 1] === c && lookaheadOk(e + 2)) len = 2;
			else if (lookaheadOk(e + 1)) len = 1;
		} else if (
			(c === '/' || c === '\\' || c === '>') &&
			s[e + 1] === ')' &&
			s[e + 2] === ']' &&
			lookaheadOk(e + 3)
		) {
			len = 3;
		}
		closeLen[e] = len;
		nextClose[e] = len > 0 ? e : nextClose[e + 1];
	}

	// 開き括弧位置ごとの結果(メモ化): [oEnd, closeStart] / null
	const memo = new Map<number, [number, number] | null>();
	const openAt = (q: number): [number, number] | null => {
		const cached = memo.get(q);
		if (cached !== undefined) return cached;
		const c = s[q];
		const ends: number[] = [];
		if (c === '[' || c === '(' || c === '{') {
			if (s[q + 1] === c) ends.push(q + 2);
			ends.push(q + 1);
			if (c === '[' && s[q + 1] === '(' && '/\\<'.includes(s[q + 2] ?? '')) {
				ends.push(q + 3);
			}
		} else if (c === '>') {
			ends.push(q + 1);
		}
		let result: [number, number] | null = null;
		for (const oEnd of ends) {
			const e = oEnd <= n ? nextClose[oEnd] : -1;
			if (e !== -1) {
				result = [oEnd, e];
				break;
			}
		}
		memo.set(q, result);
		return result;
	};

	let out = '';
	let last = 0;
	let p = 0;
	while (p < n) {
		const q1 =
			isAsciiWord(p) && (p === 0 || !isAsciiWord(p - 1)) ? idEnd[p] : -1;
		const q2 = classEnd[p] > p ? classEnd[p] : -1;
		let q = q1;
		let m = q1 > p && q1 < n ? openAt(q1) : null;
		if (!m && q2 > p && q2 < n && q2 !== q1) {
			q = q2;
			m = openAt(q2);
		}
		if (!m) {
			p++;
			continue;
		}
		const [oEnd, e] = m;
		const len = closeLen[e];
		out += s.slice(last, q) + s.slice(q, oEnd);
		out += protect(s.slice(oEnd, e));
		out += s.slice(e, e + len);
		last = e + len;
		p = last;
	}
	return out + s.slice(last);
}

/**
 * 未クォートのノード定義（[...]、(...)、{...}等）のラベル本文を一時保護するヘルパー
 */
function withProtectedNodeLabels(
	line: string,
	transformSyntax: (syntaxOnlyLine: string) => string,
): string {
	const labels: string[] = [];
	const prefix = markerPrefix(line, 'LABEL');
	// ノードID + 開き括弧 + 中身 + 閉じ括弧
	// 例: A[ラベル], node1(ラベル), A{ラベル}, A([ラベル]), A[[ラベル]], A((ラベル))
	// 閉じ括弧の直後は、インラインクラス（:::name）に続いて接続子・区切り・行末のいずれかが続く場合に限る。
	// 接続子: -- / -. / == / ~~~（不可視リンク）/ <- <=（双方向）/ o-- x--（丸・バツ端）/ 全角矢印
	const protectedLine = protectNodeLabelBodies(line, (content) => {
		labels.push(content);
		return `${prefix}${labels.length - 1}__`;
	});

	const transformed = transformSyntax(protectedLine);

	return restoreMarkers(transformed, prefix, labels);
}

/**
 * 構文位置にある全角記号を半角に置換する。
 * 【重要制約】クォートされた文字列およびノードラベル本文内の「：」「（）」などの日本語本文は一切変更しない。
 */
export function replaceSyntaxZenkaku(
	line: string,
	diagramKind?: 'sequence' | 'other',
): string {
	// Sequenceのメッセージ/Noteはコロン以降が本文。構文修復はその手前だけに適用する。
	// 図種がsequenceと確定していれば、actor IDや矢印の許容リストは不要。
	// Lexerと同様、コロンから本文を切り出す。図種不明の単一行だけは推測する。
	// 図種が 'other' と確定している場合、結果は下の分岐で必ず捨てられるため推測regexは実行しない
	const sequence =
		diagramKind === 'other'
			? null
			: diagramKind === 'sequence'
				? line.match(/^([^:：\n]*[:：])([\s\S]+)$/)
				: line.match(
						/^(\s*(?:[\p{L}\p{N}\p{M}_. -]+\s*(?:[-</\\(][-><x)o+(|/\\]+|→|ー+[>＞])\s*[\p{L}\p{N}\p{M}_. -]+|Note\s+(?:left of|right of|over)\s+[^:：]+)\s*[:：])([\s\S]+)$/iu,
					);
	if (diagramKind !== 'other' && sequence) {
		return withProtectedStrings(sequence[2], (body) => {
			// セミコロンは次の文の開始。Mermaidの文字参照（#59;など）の
			// 終端とクォート内のセミコロンはメッセージ本文に残す。
			const separators = [...body.matchAll(/#[\w]+;|;/g)].filter(
				(match) => match[0] === ';',
			);
			let result = replaceSyntaxZenkaku(sequence[1], 'other');
			let start = 0;
			for (let i = 0; i <= separators.length; i++) {
				const end = separators[i]?.index ?? body.length;
				const statement = body.slice(start, end);
				result +=
					i === 0 ? statement : replaceSyntaxZenkaku(statement, diagramKind);
				if (i < separators.length) result += ';';
				start = end + 1;
			}
			return result;
		});
	}
	return withProtectedStrings(line, (syntaxLine) => {
		let res = syntaxLine;

		// 1. 全角スペース（インデント・矢印周辺）
		res = res.replace(/^[　]+/g, (m) => '  '.repeat(m.length));
		res = res.replace(/　+(?=(?:-->|---|==>|-\.->|--|==))/g, ' ');
		res = res.replace(/(?:-->|---|==>|-\.->|--|==)　+/g, (m) =>
			m.replace(/　/g, ' '),
		);

		// 2. 全角矢印・長音混入矢印はラベル本文を保護してから置換する（下記の4.）

		// 3. ノード定義括弧の全角ブラケット・全角丸括弧・全角波括弧を半角化
		res = res.replace(/(\b[A-Za-z0-9_]+)［([\s\S]*?)］/g, '$1[$2]');
		res = res.replace(/(\b[A-Za-z0-9_]+)（([\s\S]*?)）/g, '$1($2)');
		res = res.replace(/(\b[A-Za-z0-9_]+)｛([\s\S]*?)｝/g, '$1{$2}');
		res = res.replace(/｛([\s\S]*?)｝/g, '{$1}');

		// 4. ノードラベル本文を保護した上で、構文位置の矢印・コロン・カンマを置換
		res = withProtectedNodeLabels(res, (nodeProtected) => {
			let s = nodeProtected;

			// 構文位置の全角矢印・長音混入矢印（ノードラベル本文は上記で保護済み。
			// エッジラベルの本文も保護して、構文部分だけを置換する。
			// 対象: 接続子直後の |...| と、A -- text --> B 形式の text）
			const edgeLabels: string[] = [];
			const edgePrefix = markerPrefix(s, 'EDGE');
			const protectEdgeLabel = (label: string) => {
				edgeLabels.push(label);
				return `${edgePrefix}${edgeLabels.length - 1}__`;
			};
			s = s.replace(/(?<=[-=>.ox~→＞])\|[^|\n]*\|/g, protectEdgeLabel);
			s = protectDashedEdgeLabels(s, protectEdgeLabel);
			s = s.replace(/ーー＞/g, '-->');
			s = s.replace(/ーー>>/g, '-->>');
			s = s.replace(/ー+>/g, '-->');
			s = s.replace(/--＞/g, '-->');
			s = s.replace(/→/g, '-->');
			s = s.replace(/==＞/g, '==>');
			s = restoreMarkers(s, edgePrefix, edgeLabels);

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
 * `ID<open>本文<close>` を fn(id, 本文) の戻り値へ置換する。以前の正規表現
 *   (\b[A-Za-z0-9_]+)<open>([\s\S]*?)<close>(?=\s*(?:-->|---|==>|-\.->|--|==|&|;|$))
 * と同じ結果を線形時間で返す。
 *   - IDは語連続の先頭(\b)から連続の終端までで、直後が open のときだけ成立する
 *     （語連続の途中や短いIDは必ず失敗するため試さない）。
 *   - 閉じ括弧の候補（後続lookahead成立）を位置ごとに1回だけ求め、
 *     各開き括弧は「本文開始以降で最初の候補」を事前計算から引く。
 */
function replaceBracketedNodes(
	s: string,
	open: string,
	close: string,
	fn: (id: string, content: string) => string,
): string {
	const n = s.length;
	const isWord = (i: number): boolean => {
		const c = s.charCodeAt(i);
		return (
			(c >= 48 && c <= 57) ||
			(c >= 65 && c <= 90) ||
			(c >= 97 && c <= 122) ||
			c === 95
		);
	};
	const wsTest = /\s/;
	const wsEnd = new Int32Array(n + 2);
	wsEnd[n] = wsEnd[n + 1] = n;
	const idEnd = new Int32Array(n + 2);
	idEnd[n] = idEnd[n + 1] = n;
	for (let i = n - 1; i >= 0; i--) {
		wsEnd[i] = wsTest.test(s[i]) ? wsEnd[i + 1] : i;
		idEnd[i] = isWord(i) ? idEnd[i + 1] : i;
	}
	// \s*(?:--|==|-\.->|&|;|$) （-->, ---, ==> は -- / == に含まれる）
	const followOk = (x: number): boolean => {
		const z = wsEnd[x];
		return (
			z === n ||
			s[z] === '&' ||
			s[z] === ';' ||
			s.startsWith('--', z) ||
			s.startsWith('==', z) ||
			s.startsWith('-.->', z)
		);
	};
	const nextClose = new Int32Array(n + 2).fill(-1);
	for (let e = n - 1; e >= 0; e--) {
		nextClose[e] = s[e] === close && followOk(e + 1) ? e : nextClose[e + 1];
	}

	let out = '';
	let last = 0;
	let p = 0;
	while (p < n) {
		if (!isWord(p) || (p > 0 && isWord(p - 1))) {
			p++;
			continue;
		}
		const re = idEnd[p];
		if (s[re] === open && re + 1 <= n && nextClose[re + 1] !== -1) {
			const e = nextClose[re + 1];
			out += s.slice(last, p) + fn(s.slice(p, re), s.slice(re + 1, e));
			last = e + 1;
			p = last;
		} else {
			p = re;
		}
	}
	return out + s.slice(last);
}

/**
 * ノードラベル内に未クォートの丸括弧・角括弧・セミコロン・スラッシュ等が含まれている場合、
 * ラベル全体を安全に ["..."] で囲む
 */
export function safeQuoteNodeLabels(line: string): string {
	let res = line;

	// 1. 角括弧ノード: ID[...] を安全にクォート
	res = replaceBracketedNodes(res, '[', ']', (id, content) => {
		const trimmed = content.trim();
		if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
			return `${id}[${content}]`;
		}
		if (/[();/:,\s[\]]/.test(trimmed)) {
			return `${id}["${trimmed.replace(/"/g, "'")}"]`;
		}
		return `${id}[${content}]`;
	});

	// 2. 丸括弧ノード（角丸ノード）: ID(...)
	res = replaceBracketedNodes(res, '(', ')', (id, content) => {
		const trimmed = content.trim();
		if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
			return `${id}(${content})`;
		}
		if (/[();/:,\s]/.test(trimmed)) {
			return `${id}("${trimmed.replace(/"/g, "'")}")`;
		}
		return `${id}(${content})`;
	});

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

	// 5. ノードID自体に日本語括弧が直接使われている場合の補正
	// 行頭・矢印の直後（始点）かつ行末・矢印の直前（終点）のいずれの位置でも検出する
	// （例: A(x) --> B(y) --> C(z) のような3ノード以上の連鎖でも中間ノードを取りこぼさない）
	res = res.replace(
		/(?:^|(?<=-->|---|==>|-\.->|--|==))(\s*)([^\s\->[({;]+)\(([^)]+)\)(?=\s*(?:-->|---|==>|-\.->|--|==|;|$))/g,
		(match, ws, name, note) => {
			// ASCII/underscoreのみのIDはルール2で既にクォート済みのため対象外（多重ラップ防止）
			if (/^[A-Za-z0-9_]+$/.test(name)) return match;
			return `${ws}node_${name}["${name}(${note})"]`;
		},
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
	if (rawInput.length > MAX_REPAIR_INPUT_LENGTH) {
		return {
			originalCode: rawInput,
			repairedCode: rawInput,
			isModified: false,
			changes: [],
			error: `入力が大きすぎるため自動修復を行いませんでした（上限${MAX_REPAIR_INPUT_LENGTH.toLocaleString('ja-JP')}文字）`,
		};
	}
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
	const diagramHeader = rawLines.find((line) =>
		DIAGRAM_HEADER_REGEX.test(line.trim()),
	);
	// 同じ「actor arrow actor:」形でも、flowchartではclass指定等の構文。
	// 実際の図種が分かる場合はsequenceの本文保護を他の文法へ適用しない。
	const diagramKind =
		diagramHeader === undefined
			? undefined
			: /^sequenceDiagram\b/i.test(diagramHeader.trim())
				? 'sequence'
				: 'other';
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
		const syntaxNormalized = replaceSyntaxZenkaku(curLine, diagramKind);
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
