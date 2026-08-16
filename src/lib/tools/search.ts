import { type ToolCatalogItem, toolCatalog } from './catalog';

// マッチ箇所ごとの重み（大きいほど優先）
const SCORE_TITLE_PREFIX = 100;
const SCORE_TITLE_PARTIAL = 80;
const SCORE_KEYWORD = 60;
const SCORE_CATEGORY_DESCRIPTION = 40;

/**
 * 検索用にテキストを正規化する。
 * 小文字化に加え、ひらがなをカタカナに変換することで
 * 「かうんと」→「カウント」のような表記ゆれを吸収する。
 */
export function normalizeSearchText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/**
 * 正規化済みの単一検索語に対するツール1件のスコアを返す（0 = 不一致）。
 * 優先順: タイトル前方一致 > タイトル部分一致 > キーワード一致 > カテゴリ・説明文一致
 */
function scoreSingleTerm(tool: ToolCatalogItem, term: string): number {
	const title = normalizeSearchText(tool.title);
	if (title.startsWith(term)) return SCORE_TITLE_PREFIX;
	if (title.includes(term)) return SCORE_TITLE_PARTIAL;

	if (
		tool.keywords.some((keyword) => normalizeSearchText(keyword).includes(term))
	) {
		return SCORE_KEYWORD;
	}

	const rest = normalizeSearchText(
		`${tool.categories.join(' ')} ${tool.description}`,
	);
	if (rest.includes(term)) return SCORE_CATEGORY_DESCRIPTION;

	return 0;
}

/**
 * クエリを空白（半角・全角）区切りで検索語に分割し、それぞれを正規化する。
 */
function splitQueryTerms(query: string): string[] {
	return query
		.split(/[\s　]+/)
		.map((term) => normalizeSearchText(term.trim()))
		.filter((term) => term.length > 0);
}

/**
 * ツール1件に対するクエリの関連度スコアを返す（0 = 不一致）。
 *
 * クエリが空白区切りの複数語を含む場合は AND セマンティクスで評価する:
 * すべての検索語がいずれかのフィールド（タイトル / キーワード /
 * カテゴリ・説明文）にマッチした場合のみスコアを返し、各語の最良マッチの
 * 重みを合算する。1語でも一致しなければ 0（不一致）。
 *
 * 優先順: タイトル前方一致 > タイトル部分一致 > キーワード一致 > カテゴリ・説明文一致
 */
export function scoreToolMatch(tool: ToolCatalogItem, query: string): number {
	const terms = splitQueryTerms(query);
	if (terms.length === 0) return 0;

	let total = 0;
	for (const term of terms) {
		const termScore = scoreSingleTerm(tool, term);
		if (termScore === 0) return 0; // 1語でも不一致なら全体を不一致とする
		total += termScore;
	}
	return total;
}

/**
 * クエリに一致するツールを関連度の降順で返す。
 * 同スコアの場合はカタログ定義順を維持する（安定ソート）。
 * クエリが空の場合はカタログ全件をそのまま返す。
 */
export function searchTools(
	query: string,
	catalog: readonly ToolCatalogItem[] = toolCatalog,
): readonly ToolCatalogItem[] {
	const trimmed = query.trim();
	if (!trimmed) return catalog;

	return catalog
		.map((tool, index) => ({
			tool,
			index,
			score: scoreToolMatch(tool, trimmed),
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((entry) => entry.tool);
}
