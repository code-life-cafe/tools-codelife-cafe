export type ToolCategory =
	| 'テキスト変換'
	| 'テキスト解析'
	| '開発ツール'
	| '生成ツール'
	| 'ユーティリティ'
	| 'エンコード/デコード'
	| 'データ処理'
	| 'AI/画像';

export type ToolCatalogItem = {
	id: string;
	title: string;
	description: string;
	href: string;
	icon: string;
	category: ToolCategory;
	categoryColor: string;
	span?: 2;
	keywords: readonly string[];
};

export const toolCatalog: readonly ToolCatalogItem[] = [
	{
		id: 'zenkaku-hankaku',
		title: '全角↔半角変換',
		description:
			'カタカナ・英数字・記号の全角半角を一括変換。カテゴリ別に細かく制御できます。',
		href: '/zenkaku-hankaku',
		icon: '🔄',
		category: 'テキスト変換',
		categoryColor: 'border-l-primary',
		span: 2,
		keywords: ['全角', '半角', 'カタカナ'],
	},
	{
		id: 'char-count',
		title: '文字数カウント',
		description:
			'文字数・バイト数・行数をリアルタイムカウント。Shift-JIS対応。',
		href: '/char-count',
		icon: '🔢',
		category: 'テキスト解析',
		categoryColor: 'border-l-accent',
		keywords: ['文字数', 'バイト数', '行数', 'Shift-JIS'],
	},
	{
		id: 'json-formatter',
		title: 'JSON整形',
		description: 'JSONの整形・圧縮・構文チェック。インデント幅も選べます。',
		href: '/json-formatter',
		icon: '{ }',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: ['JSON', 'フォーマット', 'バリデーション'],
	},
	{
		id: 'text-diff',
		title: 'テキスト差分比較',
		description:
			'2つのテキストの違いをハイライト表示。行単位・文字単位の切替対応。',
		href: '/text-diff',
		icon: '📝',
		category: 'テキスト解析',
		categoryColor: 'border-l-accent',
		span: 2,
		keywords: ['diff', '比較', '差分'],
	},
	{
		id: 'qr-generator',
		title: 'QRコード生成',
		description:
			'URLやテキストからQRコードを即座に生成。サイズ・色のカスタマイズ可能。',
		href: '/qr-generator',
		icon: '📱',
		category: '生成ツール',
		categoryColor: 'border-l-chart-3',
		keywords: ['QR', 'コード'],
	},
	{
		id: 'wareki-converter',
		title: '和暦↔西暦変換',
		description: '明治〜令和の和暦と西暦を相互変換。干支・年齢も同時表示。',
		href: '/wareki-converter',
		icon: '🎌',
		category: 'ユーティリティ',
		categoryColor: 'border-l-chart-2',
		keywords: ['和暦', '西暦', '元号', '年齢'],
	},
	{
		id: 'url-encoder',
		title: 'URLエンコード/デコード',
		description:
			'日本語を含むURLやクエリを安全に双方向変換。コンポーネント/フルURLモード対応。',
		href: '/url-encoder',
		icon: '🔗',
		category: 'エンコード/デコード',
		categoryColor: 'border-l-primary',
		keywords: ['URL', 'encodeURI', 'decodeURI', 'パーセントエンコード'],
	},
	{
		id: 'base64',
		title: 'Base64エンコード/デコード',
		description:
			'テキスト・ファイルのBase64エンコード/デコードをブラウザ内で実行。',
		href: '/base64',
		icon: '🔐',
		category: 'ユーティリティ',
		categoryColor: 'border-l-chart-2',
		keywords: ['Base64', 'エンコード', 'デコード'],
	},
	{
		id: 'regex-tester',
		title: '正規表現テスター',
		description:
			'正規表現のリアルタイムテスト・マッチ確認・置換。よく使うパターン集付き。',
		href: '/regex-tester',
		icon: '✨',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: ['正規表現', 'regex', '置換'],
	},
	{
		id: 'sql-formatter',
		title: 'SQL整形・フォーマッター',
		description:
			'SQLの整形・圧縮をブラウザ内で実行。MySQL/PostgreSQL等の方言対応。',
		href: '/sql-formatter',
		icon: '💾',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: ['SQL', 'MySQL', 'PostgreSQL'],
	},
	{
		id: 'dummy-data',
		title: 'ダミーデータ生成',
		description:
			'日本語の氏名・住所・電話番号等のダミーデータを一括生成。JSON/CSVなど出力。',
		href: '/dummy-data',
		icon: '🎲',
		category: '生成ツール',
		categoryColor: 'border-l-chart-3',
		keywords: ['テストデータ', 'JSON', 'CSV'],
	},
	{
		id: 'masking',
		title: '個人情報マスキング',
		description:
			'メール・電話番号・カード番号等の個人情報を自動検出してマスキング。',
		href: '/masking',
		icon: '🛡️',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		keywords: ['個人情報', 'マスキング', 'メール', '電話番号'],
	},
	{
		id: 'csv-editor',
		title: 'CSVビューア/エディタ',
		description:
			'ブラウザ上でCSV/TSVをテーブル形式で閲覧・編集。データの加工からエクスポートまで。',
		href: '/csv-editor',
		icon: '📊',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		span: 2,
		keywords: ['CSV', 'TSV', '表', '編集'],
	},
	{
		id: 'unicode-converter',
		title: 'ユニコード変換',
		description:
			'テキストとユニコードエスケープシーケンス（\\uXXXX）を相互変換。',
		href: '/unicode-converter',
		icon: '🔣',
		category: 'テキスト変換',
		categoryColor: 'border-l-primary',
		keywords: ['Unicode', 'ユニコード', '\\uXXXX'],
	},
	{
		id: 'csv-fixer',
		title: 'CSV文字化け修復',
		description:
			'CSVのShift_JIS文字化けをブラウザで即座に修復。自動検出・BOM付与対応。',
		href: '/csv-fixer',
		icon: '📝',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		keywords: ['CSV', '文字化け', 'Shift_JIS', 'BOM'],
	},
	{
		id: 'phone-formatter',
		title: '電話番号フォーマッタ',
		description:
			'日本の電話番号をE.164・国際表記・国内表記に即変換。CSV一括変換対応。',
		href: '/phone-formatter',
		icon: '📞',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		keywords: ['電話番号', 'E.164', 'CSV'],
	},
	{
		id: 'cipher',
		title: '暗号化・難読化',
		description:
			'シーザー暗号・ROT13・モールス信号などをブラウザ内で相互変換。',
		href: '/cipher',
		icon: '🔑',
		category: 'ユーティリティ',
		categoryColor: 'border-l-chart-2',
		keywords: ['暗号', '難読化', 'ROT13', 'モールス信号', 'シーザー暗号'],
	},
	{
		id: 'bg-remove',
		title: '背景削除',
		description:
			'AIがブラウザ内で画像の背景を自動削除。画像はアップロードされません。',
		href: '/bg-remove',
		icon: '✂️',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: ['背景削除', '透過', 'AI', '画像', 'アップロード不要'],
	},
];

// カテゴリーサマリーのチップ色（categoryColor の border-l-* と対になる bg/text クラス）
// Tailwind の静的解析に拾わせるため、クラス名は literal で保持する
const categoryChipColor: Record<ToolCategory, string> = {
	テキスト変換: 'bg-primary/10 text-primary',
	テキスト解析: 'bg-accent/10 text-accent',
	開発ツール: 'bg-chart-1/10 text-chart-1',
	生成ツール: 'bg-chart-3/10 text-chart-3',
	ユーティリティ: 'bg-chart-2/10 text-chart-2',
	'エンコード/デコード': 'bg-primary/10 text-primary',
	データ処理: 'bg-chart-4/10 text-chart-4',
	'AI/画像': 'bg-chart-5/10 text-chart-5',
};

export const toolCategories = [
	...new Set(toolCatalog.map((t) => t.category)),
].map((name) => ({ name, color: categoryChipColor[name] }));

export const toolSlugs = toolCatalog.map((tool) => tool.id);
