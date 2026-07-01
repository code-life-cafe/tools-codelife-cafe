import { type ToolCatalogItem, toolCatalog } from './catalog.ts';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export type WorkflowSet = {
	/** セットの一意識別子 (例: 'csv-preprocessing') */
	id: string;
	/** 表示名 (例: 'CSV前処理') */
	name: string;
	/** 一連の作業目的の説明文 */
	description: string;
	/** ツールIDの順序配列（前工程→後工程） */
	steps: readonly string[];
};

export type WorkflowContext = {
	/** 所属セット */
	set: WorkflowSet;
	/** セット内での現在ツールのインデックス (0-based) */
	currentIndex: number;
	/** 前工程ツール（先頭の場合は null） */
	prev: ToolCatalogItem | null;
	/** 後工程ツール（末尾の場合は null） */
	next: ToolCatalogItem | null;
	/** 順序通りの全ステップのカタログ情報 */
	allSteps: ToolCatalogItem[];
};

// ---------------------------------------------------------------------------
// ワークフローセット定義（初期4セット）
// ---------------------------------------------------------------------------

export const workflowSets: readonly WorkflowSet[] = [
	{
		id: 'csv-preprocessing',
		name: 'CSV前処理',
		description:
			'CSVファイルの文字化けやフォーマットの乱れを修復し、データを表形式で編集・整形して、システムやデータベースへインポートしやすいデータに整備します。',
		steps: ['csv-fixer', 'csv-editor', 'json-csv'],
	},
	{
		id: 'image-processing',
		name: '画像最適化',
		description:
			'Webサイトや資料への掲載用に画像を圧縮し、必要な比率で切り抜き、不要なEXIFメタデータを削除してファイル容量とプライバシーを最適化します。',
		steps: ['image-compress', 'image-crop', 'exif'],
	},
	{
		id: 'invoice-document',
		name: '請求・帳票作成',
		description:
			'請求書や見積書の消費税計算（内税・外税）を行い、PDF形式で書き出した複数の書類を結合または分割して、取引先への提出用に整理します。',
		steps: ['tax', 'pdf-merge', 'pdf-split'],
	},
	{
		id: 'developer',
		name: '開発者ツール',
		description:
			'JSONの整形、ハッシュ値的計算、Base64エンコード、正規表現の検証など、開発作業中に頻出するデータのデバッグやエンコードを行います。',
		steps: ['json-formatter', 'hash', 'base64', 'regex-tester'],
	},
];

// ---------------------------------------------------------------------------
// ビルド時バリデーション
// ---------------------------------------------------------------------------

const catalogIds = new Set(toolCatalog.map((t) => t.id));
for (const set of workflowSets) {
	for (const step of set.steps) {
		if (!catalogIds.has(step)) {
			throw new Error(
				`[workflow-sets] ツールID "${step}" が catalog に存在しません（セット: ${set.name}）`,
			);
		}
	}
}

// カタログの高速検索用 Map（モジュールスコープで一度だけ構築）
const catalogById = new Map(toolCatalog.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

/**
 * 指定ツールIDが属するワークフローセットと前後ツールを返す。
 * セット未所属の場合は null。
 */
export function getWorkflowContext(toolId: string): WorkflowContext | null {
	for (const set of workflowSets) {
		const idx = set.steps.indexOf(toolId);
		if (idx === -1) continue;

		const allSteps = set.steps
			.map((id) => catalogById.get(id))
			.filter((t): t is ToolCatalogItem => t !== undefined);

		return {
			set,
			currentIndex: idx,
			prev: idx > 0 ? (catalogById.get(set.steps[idx - 1]) ?? null) : null,
			next:
				idx < set.steps.length - 1
					? (catalogById.get(set.steps[idx + 1]) ?? null)
					: null,
			allSteps,
		};
	}
	return null;
}

/**
 * 指定ツールIDのワークフローで表示されるツールID一覧を返す。
 * RelatedTools の重複排除用。自分自身は含まない。
 */
export function getWorkflowToolIds(toolId: string): string[] {
	const ctx = getWorkflowContext(toolId);
	if (!ctx) return [];
	return ctx.set.steps.filter((id) => id !== toolId);
}
