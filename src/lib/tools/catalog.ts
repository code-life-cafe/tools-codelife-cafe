export type ToolCategory =
	| 'テキスト変換'
	| 'テキスト解析'
	| '開発ツール'
	| '生成ツール'
	| 'ユーティリティ'
	| 'エンコード/デコード'
	| 'データ処理'
	| 'AI/画像'
	| 'PDF';

export type ToolLlmsFullInfo = {
	useCase: string;
	inputs: string;
	outputs: string;
	options?: string;
};

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
	published?: boolean;
	// 関連ツールのidを優先順で指定（回遊カードで使用）。
	// 省略時・件数不足時は getRelatedTools が同カテゴリで自動補完する。
	related?: readonly string[];
	llmsFull?: ToolLlmsFullInfo;
};

export type PurposeTool = {
	id: string;
	name: string;
	href: string;
};

export type PurposeCategory = {
	title: string;
	icon: string;
	tools: readonly PurposeTool[];
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
		related: ['char-count', 'unicode-converter'],
		llmsFull: {
			useCase: 'カタカナ・英数字・記号の全角と半角を相互変換',
			inputs: 'text（変換対象文字列）',
			outputs: '変換後の文字列',
			options: 'カタカナ、英数字、記号ごとの個別変換フラグ切替',
		},
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
		related: ['text-diff', 'zenkaku-hankaku'],
		llmsFull: {
			useCase:
				'入力テキストの文字数、バイト数、行数、原稿用紙換算枚数をリアルタイム計測',
			inputs: 'text（解析対象文字列）',
			outputs: '{ charCount: number, byteCount: number, lineCount: number }',
			options: '文字エンコーディング（UTF-8, Shift-JIS）選択',
		},
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
		related: ['json-csv', 'csv-editor'],
		llmsFull: {
			useCase: 'JSON文字列の構文チェック、整形（Pretty Print）、minify（圧縮）',
			inputs: 'jsonString（JSON文字列）',
			outputs: '整形または圧縮されたJSON文字列、エラー詳細',
			options: 'インデントスペース数（2, 4, タブ）切替',
		},
	},
	{
		id: 'jwt-decoder',
		title: 'JWTデコーダー',
		description:
			'JWTのヘッダー・ペイロードをブラウザ内でデコード。署名検証なしで内容確認に使えます。',
		href: '/jwt-decoder',
		icon: '🎫',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: ['JWT', 'JSON Web Token', 'デコード', '認証', 'トークン'],
		related: ['base64', 'url-encoder'],
		llmsFull: {
			useCase:
				'JSON Web Token (JWT) のHeaderおよびPayloadをブラウザ内でBase64URLデコードし表示',
			inputs: 'tokenString（JWTトークン文字列）',
			outputs: '{ header: object, payload: object, isExpired: boolean }',
		},
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
		related: ['char-count', 'json-formatter'],
		llmsFull: {
			useCase:
				'2つのテキスト（比較元・比較先）の差分を計算し視覚的にハイライト表示',
			inputs: 'originalText（比較元）, modifiedText（比較先）',
			outputs: '差分ハイライト結果',
			options: '比較単位（行単位、文字単位）の切替',
		},
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
		related: ['dummy-data', 'url-encoder'],
		llmsFull: {
			useCase: '入力されたURLやテキストからQRコード画像を生成しダウンロード',
			inputs: 'text（URLまたは文字列）',
			outputs: 'PNG/SVG形式のQRコード画像',
			options: '画像サイズ、前景色/背景色、誤り訂正レベル指定',
		},
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
		related: ['tax', 'cipher'],
		llmsFull: {
			useCase:
				'和暦（明治・大正・昭和・平成・令和）と西暦の相互変換および年齢・干支計算',
			inputs: 'year（年数値または和暦表記）',
			outputs:
				'{ westernYear: number, japaneseYear: string, eto: string, age: number }',
		},
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
		related: ['base64', 'unicode-converter'],
		llmsFull: {
			useCase: '文字列のパーセントエンコード（URLエンコード）およびデコード',
			inputs: 'text（対象文字列）, mode（encode | decode）',
			outputs: '変換後文字列',
			options: 'encodeURI component / full URI モード切替',
		},
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
		related: ['url-encoder', 'image-base64', 'cipher'],
		llmsFull: {
			useCase: 'テキストやバイナリファイルのBase64エンコードおよびデコード',
			inputs: 'content（テキストまたはファイル）, mode（encode | decode）',
			outputs: 'Base64文字列またはデコード結果データ',
		},
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
		related: ['sql-formatter', 'json-formatter'],
		llmsFull: {
			useCase:
				'JavaScript正規表現のマッチングテスト、キャプチャグループ検証、文字列置換',
			inputs: 'pattern（正規表現）, flags（フラグ）, text（対象文字列）',
			outputs: 'マッチ結果一覧、グループ抽出値、置換後文字列',
		},
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
		related: ['json-formatter', 'regex-tester'],
		llmsFull: {
			useCase: 'SQLクエリの自動インデント整形および1行圧縮（minify）',
			inputs: 'sqlText（SQLクエリ文字列）',
			outputs: '整形済みSQL文字列',
			options: 'SQL方言（Standard, MySQL, PostgreSQL）指定',
		},
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
		related: ['csv-editor', 'json-csv'],
		llmsFull: {
			useCase:
				'テスト開発用の日本語ダミー情報（名前、住所、メール、電話番号等）の一括生成',
			inputs: 'count（件数）, fields（取得フィールド一覧）',
			outputs: 'JSONまたはCSV形式のテストデータセット',
		},
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
		related: ['image-mosaic', 'dummy-data'],
		llmsFull: {
			useCase:
				'テキスト中の個人情報（メール、電話番号、クレジットカード番号、マイナンバー等）を自動検出・伏字化',
			inputs: 'text（対象文章）',
			outputs: 'マスキング済み文章',
			options: '対象項目の選択、伏字文字（*や[MASK]）の変更',
		},
	},
	{
		id: 'ai-spreadsheet-prompt',
		title: 'AI表データプロンプト生成',
		description:
			'CSV・TSV・Excel貼り付けデータを、AIに渡しやすい分析プロンプトへ変換。',
		href: '/ai-spreadsheet-prompt',
		icon: '🤖',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		span: 2,
		keywords: ['AI', 'CSV', 'TSV', 'Excel', 'プロンプト'],
		related: ['csv-editor', 'json-csv', 'csv-fixer'],
		llmsFull: {
			useCase:
				'CSV、TSV、Excel貼り付け表データからAIチャット向けの分析・要約・変換プロンプトを生成',
			inputs: 'tableText（CSV/TSV/Excel貼り付けデータ）, task（依頼内容）',
			outputs: 'Markdown表と出力条件を含むAI向けプロンプト',
			options: '入力形式の自動判定、依頼内容、最大行数、自由指示',
		},
	},
	{
		id: 'csv-editor',
		title: 'CSVビューア/エディタ',
		description:
			'CSV/TSV/Excel(.xlsx)をブラウザ上で表示・編集・フィルタ・ソート・グラフ化。',
		href: '/csv-editor',
		icon: '📊',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		span: 2,
		keywords: [
			'CSV',
			'TSV',
			'Excel',
			'xlsx',
			'フィルタ',
			'ソート',
			'グラフ',
			'表',
			'編集',
		],
		related: ['csv-fixer', 'json-csv', 'phone-formatter'],
		llmsFull: {
			useCase:
				'CSV/TSV/Excel(.xlsx)ファイルのテーブル閲覧、複数条件フィルタ、マルチカラムソート、SVGグラフ化、行列編集・エクスポート',
			inputs: 'file（.csv/.tsv/.xlsxファイル）または直接入力データ',
			outputs: '編集済みCSV/TSVファイル、JSON、SVG/PNGグラフ画像',
		},
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
		related: ['zenkaku-hankaku', 'url-encoder'],
		llmsFull: {
			useCase: '文字列とUnicodeエスケープシーケンス（\\uXXXX）の相互変換',
			inputs: 'text（対象文字列）, mode（encode | decode）',
			outputs: '変換後文字列',
		},
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
		related: ['csv-editor', 'json-csv'],
		llmsFull: {
			useCase:
				'Excel等で文字化けしたShift_JIS CSVの文字コードをUTF-8に変換・修復',
			inputs: 'file（文字化けCSVファイル）',
			outputs: '修復済みBOM付きUTF-8 CSVファイル',
		},
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
		related: ['zipcode', 'masking', 'csv-editor'],
		llmsFull: {
			useCase:
				'日本の電話番号文字列を正規化し、ハイフン区切り表記や国際表記（+81）に変換',
			inputs: 'phoneNumbers（単一文字列またはCSVファイル）',
			outputs: 'フォーマット済み電話番号一覧',
		},
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
		related: ['base64', 'wareki-converter'],
		llmsFull: {
			useCase:
				'古典暗号（シーザー暗号、ROT13、モールス信号等）によるテキストの変形・相互変換',
			inputs:
				'text（文字列）, algorithm（rot13 | caesar | morse）, mode（encode | decode）',
			outputs: '変換後テキスト',
		},
	},
	{
		id: 'json-csv',
		title: 'JSON ↔ CSV 変換',
		description:
			'JSONとCSVを相互変換。ネスト展開・型推論・Excel文字化け対策のBOM付きUTF-8出力に対応。',
		href: '/json-csv',
		icon: '🔁',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		keywords: ['JSON', 'CSV', '変換', 'BOM', 'Excel', 'フラット化'],
		related: ['csv-editor', 'json-formatter', 'csv-fixer'],
		llmsFull: {
			useCase: 'JSONオブジェクト配列とCSVテーブルデータの双方向相互変換',
			inputs: 'data（JSON文字列またはCSVデータ）, mode（json2csv | csv2json）',
			outputs: '変換後データ文字列',
			options: 'BOM付与、ヘッダー行有無、区切り文字指定',
		},
	},
	{
		id: 'hash',
		title: 'ハッシュ値計算',
		description:
			'MD5・SHA-256等のハッシュ値をテキスト・ファイルから計算。ファイルの改ざん・破損チェックに。',
		href: '/hash',
		icon: '🔏',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: ['ハッシュ', 'MD5', 'SHA-256', 'チェックサム', 'CRC32', '改ざん'],
		related: ['color', 'jwt-decoder', 'sql-formatter'],
		llmsFull: {
			useCase: '文字列のMD5/SHA-256/SHA-512ハッシュ値をブラウザ内で計算',
			inputs: 'text（文字列）, algorithm（md5 | sha-256 | sha-512）',
			outputs: '{ hash: string }',
			options: 'algorithm でハッシュアルゴリズム切替',
		},
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
		related: [
			'upscale',
			'image-mosaic',
			'image-text',
			'image-compress',
			'image-convert',
		],
		llmsFull: {
			useCase:
				'WebWorker上のAIモデル（RMBG等）を用いて画像の被写体を切り抜き背景を透過処理',
			inputs: 'imageFile（画像ファイル）',
			outputs: '背景が透過されたPNG画像',
		},
	},
	{
		id: 'upscale',
		title: '画像アップスケール',
		description: 'ブラウザ内AIで高解像度化・ノイズ除去。データは外部送信なし。',
		href: '/upscale',
		icon: '✨',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: [
			'アップスケール',
			'高解像度化',
			'高画質化',
			'ノイズ除去',
			'超解像',
			'解像度',
			'Real-ESRGAN',
			'画像',
			'2x',
			'4x',
			'アップロード不要',
		],
		related: ['bg-remove', 'image-compress', 'image-convert'],
		llmsFull: {
			useCase:
				'WebWorker上のAIモデル（Real-ESRGAN）でブラウザ内アップスケール（2x/4x）・ノイズ除去',
			inputs: 'imageFile（画像ファイル）',
			outputs: '高解像度化された画像（PNG / WebP）',
		},
	},
	{
		id: 'image-mosaic',
		title: '画像モザイク・ぼかし',
		description:
			'四角形/円形のモザイク・ぼかしと絵文字・任意画像スタンプで安全にマスキング。画像はアップロードされません。',
		href: '/image-mosaic',
		icon: '🟫',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: [
			'モザイク',
			'ぼかし',
			'画像',
			'マスキング',
			'スクリーンショット',
			'ピクセル化',
			'円形',
			'絵文字スタンプ',
			'画像スタンプ',
		],
		related: ['image-text', 'image-metadata', 'image-compress'],
		llmsFull: {
			useCase: '画像上の指定領域に対するモザイク・ぼかし処理およびスタンプ付与',
			inputs: 'imageFile（画像ファイル）, maskRegions（マスク範囲リスト）',
			outputs: '編集済み画像ファイル',
		},
	},
	{
		id: 'image-text',
		title: '画像テキスト挿入',
		description:
			'画像への文字入れ・注釈をブラウザで。縁取り・背景ボックス・ドラッグ配置に対応。',
		href: '/image-text',
		icon: '🔤',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: ['テキスト', '文字入れ', '画像', '注釈', 'キャプション'],
		related: ['image-mosaic', 'image-crop', 'image-compress'],
		llmsFull: {
			useCase: '画像上に任意のフォント・色・縁取りでテキストや注釈を追加合成',
			inputs: 'imageFile（画像ファイル）, textLayers（テキストレイヤー情報）',
			outputs: '合成済み画像ファイル',
		},
	},
	{
		id: 'image-compress',
		title: '画像圧縮・リサイズ',
		description:
			'一括圧縮・目標サイズ指定・WebP変換に対応。画像はアップロードされません。',
		href: '/image-compress',
		icon: '🗜️',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: [
			'画像圧縮',
			'リサイズ',
			'WebP変換',
			'容量',
			'一括',
			'目標サイズ',
			'JPEG',
			'PNG',
		],
		related: [
			'upscale',
			'image-convert',
			'exif',
			'bg-remove',
			'image-mosaic',
			'image-text',
			'image-merge',
			'favicon',
			'ogp',
		],
		llmsFull: {
			useCase: '画像ファイルの品質調整圧縮、解像度リサイズ、WebP変換',
			inputs:
				'imageFiles（画像ファイル群）, quality（品質）, maxWidth（最大幅）',
			outputs: '圧縮・リサイズ済み画像ファイル群',
		},
	},
	{
		id: 'image-metadata',
		title: '画像メタデータ削除',
		description:
			'Exif・GPS位置情報などをブラウザ内で削除。画像はアップロードされません。',
		href: '/image-metadata',
		icon: '🧹',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: [
			'Exif',
			'メタデータ',
			'GPS',
			'位置情報',
			'画像',
			'プライバシー',
			'アップロード不要',
		],
		related: ['exif', 'image-compress', 'image-mosaic'],
		llmsFull: {
			useCase:
				'画像ファイルからExifタグやGPS位置情報などの個人情報・メタデータを除去',
			inputs: 'imageFile（画像ファイル）',
			outputs: 'メタデータ削除済み画像ファイル',
		},
	},
	{
		id: 'image-crop',
		title: '画像トリミング・回転',
		description:
			'画像の切り抜き、90度回転、上下左右反転をブラウザ内で実行。画像はアップロードされません。',
		href: '/image-crop',
		icon: '✂️',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: [
			'画像トリミング',
			'切り抜き',
			'回転',
			'反転',
			'クロップ',
			'画像',
		],
		related: ['image-compress', 'image-convert', 'image-text'],
		llmsFull: {
			useCase:
				'画像の矩形範囲切り抜き（クロップ）、90度単位の回転、上下左右反転',
			inputs:
				'imageFile（画像ファイル）, cropArea（切り抜き範囲）, rotation（角度）',
			outputs: '加工済み画像ファイル',
		},
	},
	{
		id: 'image-edit',
		title: '画像のクロップ・回転・反転',
		description:
			'アスペクト比固定の切り抜き・任意角度回転・反転・一括ZIP出力に対応。画像はアップロードされません。',
		href: '/image-edit',
		icon: '🧭',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: ['画像編集', 'クロップ', '回転', '反転', '一括処理', 'ZIP'],
		related: ['image-crop', 'image-compress', 'image-convert', 'image-merge'],
		llmsFull: {
			useCase:
				'画像のアスペクト比指定クロップ、任意角度回転、水平/垂直反転、一括処理',
			inputs:
				'imageFiles（画像ファイル群）, cropAspectRatio（切り抜き比率）, rotation（角度）, flip（反転設定）',
			outputs: '加工済み画像ファイルまたはZIPファイル',
		},
	},
	{
		id: 'image-merge',
		title: '画像連結・結合',
		description: '複数画像を縦・横・グリッドで結合。データは外部送信なし',
		href: '/image-merge',
		icon: '🪟',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		span: 2,
		keywords: [
			'画像結合',
			'画像連結',
			'画像 縦 横',
			'画像 グリッド',
			'コンタクトシート',
			'画像 並べる',
			'1枚にまとめる',
			'スクショ 連結',
		],
		related: ['image-edit', 'image-compress', 'image-convert'],
		llmsFull: {
			useCase:
				'複数の画像を縦・横・グリッド（コンタクトシート）に結合し1枚の画像として出力。余白・背景色・並び替え・セルサイズ方針を指定可能',
			inputs:
				'imageFiles（画像ファイル群）, mode（vertical | horizontal | grid）, columns（グリッド列数）, gap（余白）, padding（外周）, background（背景色）',
			outputs: '結合済み画像ファイル（PNG / JPEG / WebP）',
			options:
				'結合モード、列数、余白、外周、背景色（透過可）、セルサイズ方針、揃え、出力形式・品質',
		},
	},
	{
		id: 'image-convert',
		title: '画像形式変換',
		description: 'HEIC・WebP・AVIFをJPEG等へ変換。データは外部送信なし。',
		href: '/image-convert',
		icon: '🖼️',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: [
			'画像形式変換',
			'HEIC',
			'JPEG変換',
			'WebP',
			'AVIF',
			'iPhone',
			'HEIC JPEG 変換',
			'一括',
			'ZIP',
		],
		related: ['image-compress', 'image-crop', 'image-base64', 'image-merge'],
		llmsFull: {
			useCase:
				'iPhoneのHEIC形式やWebP/AVIF画像を汎用的なJPEG/PNG形式に相互変換',
			inputs: 'imageFiles（画像ファイル群）, targetFormat（jpeg | png | webp）',
			outputs: '変換済み画像ファイル群',
		},
	},
	{
		id: 'zipcode',
		title: '郵便番号↔住所変換',
		description:
			'郵便番号から住所を検索・一括変換。CSV出力対応。データは外部送信なし。',
		href: '/zipcode',
		icon: '📮',
		category: 'データ処理',
		categoryColor: 'border-l-chart-4',
		keywords: [
			'郵便番号',
			'住所',
			'変換',
			'一括変換',
			'Excel',
			'CSV',
			'オフライン',
		],
		related: ['phone-formatter', 'csv-editor', 'dummy-data'],
		llmsFull: {
			useCase:
				'7桁の郵便番号から都道府県・市区町村・町域住所の相互検索および一括リスト変換',
			inputs: 'zipcode（郵便番号文字列）またはCSVファイル',
			outputs: '{ address: string, pref: string, city: string, town: string }',
		},
	},
	{
		id: 'pdf-merge',
		title: 'PDF結合',
		description: '複数PDF・画像を1つに。データは外部送信なし。',
		href: '/pdf-merge',
		icon: '📄',
		category: 'PDF',
		categoryColor: 'border-l-destructive',
		keywords: [
			'PDF結合',
			'PDFまとめる',
			'マージ',
			'画像をPDFに',
			'アップロードしない',
			'安全',
		],
		related: ['pdf-split', 'image-convert', 'image-compress'],
		llmsFull: {
			useCase: '複数のPDFファイルや画像ファイルを任意の順序で1つのPDFに統合',
			inputs: 'files（PDF/画像ファイル群）',
			outputs: '結合済み単一PDFファイル',
		},
	},
	{
		id: 'pdf-split',
		title: 'PDF分割・ページ抽出',
		description: '範囲指定で分割・抽出。データは外部送信なし。',
		href: '/pdf-split',
		icon: '✂️',
		category: 'PDF',
		categoryColor: 'border-l-destructive',
		keywords: [
			'PDF分割',
			'ページ抽出',
			'一枚ずつ',
			'範囲指定',
			'ZIP',
			'アップロードしない',
			'安全',
		],
		related: ['pdf-merge', 'image-crop'],
		llmsFull: {
			useCase:
				'単一のPDFファイルから指定したページ範囲を別個のPDFとして切り出し分割抽出',
			inputs: 'pdfFile（PDFファイル）, pages（抽出ページ指定）',
			outputs: '分割済みPDFファイル群（ZIPまとめ可）',
		},
	},
	{
		id: 'tax',
		title: '消費税・税込計算',
		description:
			'税込⇔税抜を即時計算。軽減税率・過去税率（3%/5%/8%）・端数処理に対応。',
		href: '/tax',
		icon: '🧾',
		category: 'ユーティリティ',
		categoryColor: 'border-l-chart-2',
		keywords: ['消費税', '税込', '税抜', '軽減税率', '端数処理', '計算'],
		related: ['wareki-converter', 'char-count'],
		llmsFull: {
			useCase: '税込⇔税抜の相互変換、複数税率・端数処理対応',
			inputs:
				'amount（number）, taxRate（3 | 5 | 8 | 10 | 8_reduced）, mode（tax_included | tax_excluded）',
			outputs: '{ result: number, taxAmount: number }',
			options: 'rounding（floor | ceil | round, デフォルト floor）',
		},
	},
	{
		id: 'color',
		title: 'カラーコード変換',
		description:
			'HEX・RGB・HSL・CMYKを相互変換。カラーピッカー連動・ワンクリックコピー対応。',
		href: '/color',
		icon: '🎨',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: ['カラーコード', 'HEX', 'RGB', 'HSL', 'CMYK', '色', '変換'],
		related: ['hash', 'markdown', 'favicon'],
		llmsFull: {
			useCase: 'Webカラー表現（HEX, RGB, HSL, CMYK）の相互計算変換',
			inputs: 'colorValue（色表現文字列）',
			outputs: '{ hex: string, rgb: string, hsl: string, cmyk: string }',
		},
	},
	{
		id: 'markdown',
		title: 'Markdownプレビュー',
		description:
			'GFM対応のリアルタイムプレビュー。HTMLコピー・ダウンロード可。データは外部送信なし。',
		href: '/markdown',
		icon: '📄',
		category: 'テキスト変換',
		categoryColor: 'border-l-primary',
		keywords: ['Markdown', 'マークダウン', 'プレビュー', 'GFM', 'HTML'],
		related: ['json-csv', 'color', 'wordcloud'],
		llmsFull: {
			useCase:
				'GitHub Flavored Markdown (GFM) のリアルタイムHTMLレンダリングとHTML出力',
			inputs: 'markdownText（Markdown文字列）',
			outputs: 'HTML文字列およびプレビュー表示',
		},
	},
	{
		id: 'wordcloud',
		title: 'ワードクラウド生成',
		description:
			'日本語テキストを形態素解析しワードクラウド化。データは外部送信なし。',
		href: '/wordcloud',
		icon: '☁️',
		category: 'テキスト解析',
		categoryColor: 'border-l-accent',
		keywords: [
			'ワードクラウド',
			'テキストマイニング',
			'形態素解析',
			'頻出語',
			'アンケート',
			'自由記述',
		],
		related: ['markdown', 'char-count', 'text-diff'],
		llmsFull: {
			useCase:
				'日本語テキストを形態素解析し、頻出キーワードのワードクラウド可視化および頻度表CSV出力',
			inputs: 'text（解析対象文字列またはファイル）',
			outputs: 'ワードクラウド描画（PNG/SVG）および頻度表（CSV）',
		},
	},
	{
		id: 'ogp',
		title: 'OGP画像ジェネレーター',
		description: 'SNSシェアカードをブラウザで生成。データは外部送信なし',
		href: '/ogp',
		icon: '🖼️',
		category: '生成ツール',
		categoryColor: 'border-l-chart-3',
		keywords: [
			'OGP',
			'OGP画像',
			'og:image',
			'SNS',
			'シェアカード',
			'アイキャッチ',
			'ジェネレーター',
			'Open Graph',
		],
		related: ['favicon', 'image-compress', 'image-text'],
		llmsFull: {
			useCase:
				'SNSシェア用アイキャッチ画像（OGP画像）をブラウザ内で作成・カスタマイズ生成',
			inputs: 'title（タイトル）, category（カテゴリ）, theme（テーマ）',
			outputs: 'PNG形式のOGP画像',
		},
	},
	{
		id: 'favicon',
		title: 'ファビコン生成',
		description: '画像から favicon 一式を生成。データは外部送信なし。',
		href: '/favicon',
		icon: '🔖',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: [
			'ファビコン',
			'favicon',
			'ico',
			'site.webmanifest',
			'アップロード不要',
			'apple-touch-icon',
			'PWAアイコン',
		],
		related: ['color', 'image-compress', 'image-text'],
		llmsFull: {
			useCase:
				'単一のロゴ画像からWebサイト用favicon一式（.ico, 192x192, 512x512, apple-touch-icon）を生成',
			inputs: 'imageFile（ロゴ画像ファイル）',
			outputs: 'faviconアイコンセット（ZIPアーカイブ）',
		},
	},
	{
		id: 'image-base64',
		title: '画像Base64変換',
		description: '画像をBase64/Data URIへ相互変換。データは外部送信なし。',
		href: '/image-base64',
		icon: '🔣',
		category: '開発ツール',
		categoryColor: 'border-l-chart-1',
		keywords: [
			'Base64',
			'Data URI',
			'画像変換',
			'img',
			'CSS',
			'base64',
			'データURI',
			'インライン画像',
		],
		related: ['base64', 'image-convert'],
		llmsFull: {
			useCase: '画像ファイルとBase64/Data URI形式文字列の相互変換',
			inputs: 'file（画像ファイル）または Base64文字列',
			outputs: 'Base64文字列または画像ファイル',
		},
	},
	{
		id: 'exif',
		title: 'EXIF確認・削除',
		description: '写真の位置情報・撮影情報を確認して削除。データは外部送信なし',
		href: '/exif',
		icon: '🔍',
		category: 'AI/画像',
		categoryColor: 'border-l-chart-5',
		keywords: [
			'EXIF',
			'エグジフ',
			'位置情報',
			'GPS',
			'削除',
			'メタデータ',
			'写真',
			'プライバシー',
		],
		related: ['image-compress', 'image-convert', 'image-mosaic', 'bg-remove'],
		llmsFull: {
			useCase:
				'写真画像に含まれるEXIFメタデータおよびGPS位置情報の参照・一括除去',
			inputs: 'file（写真画像ファイル）',
			outputs: 'EXIF情報一覧およびメタデータ除去済み画像ファイル',
		},
	},
];

export const purposeCategories = [
	{
		title: 'データ整形で使う',
		icon: '📊',
		tools: [
			{ id: 'json-formatter', name: 'JSON整形', href: '/json-formatter' },
			{ id: 'csv-editor', name: 'CSVエディター', href: '/csv-editor' },
			{ id: 'sql-formatter', name: 'SQL整形', href: '/sql-formatter' },
		],
	},
	{
		title: '画像加工で使う',
		icon: '🖼️',
		tools: [
			{
				id: 'image-compress',
				name: '画像圧縮・リサイズ',
				href: '/image-compress',
			},
			{ id: 'image-crop', name: '画像切り抜き', href: '/image-crop' },
			{ id: 'bg-remove', name: '背景透過・削除', href: '/bg-remove' },
		],
	},
	{
		title: '日本語入力の困りごと',
		icon: '🇯🇵',
		tools: [
			{ id: 'zenkaku-hankaku', name: '全角半角変換', href: '/zenkaku-hankaku' },
			{
				id: 'wareki-converter',
				name: '和暦西暦変換',
				href: '/wareki-converter',
			},
			{ id: 'zipcode', name: '郵便番号検索', href: '/zipcode' },
		],
	},
	{
		title: 'PDFを扱う',
		icon: '📄',
		tools: [
			{ id: 'pdf-merge', name: 'PDF結合', href: '/pdf-merge' },
			{ id: 'pdf-split', name: 'PDF分割', href: '/pdf-split' },
		],
	},
] as const satisfies readonly PurposeCategory[];
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
	PDF: 'bg-destructive/10 text-destructive',
};

// カテゴリID（URLクエリ `?category=<id>` で使用。#109 のパンくずリンク先にもなる）
const categoryIds: Record<ToolCategory, string> = {
	テキスト変換: 'text-conversion',
	テキスト解析: 'text-analysis',
	開発ツール: 'development',
	生成ツール: 'generator',
	ユーティリティ: 'utility',
	'エンコード/デコード': 'encoding',
	データ処理: 'data-processing',
	'AI/画像': 'ai-image',
	PDF: 'pdf',
};

export const toolCategories = [
	...new Set(toolCatalog.map((t) => t.category)),
].map((name) => ({
	id: categoryIds[name],
	name,
	color: categoryChipColor[name],
}));

export function getCategoryId(category: ToolCategory): string {
	return categoryIds[category];
}

export const toolSlugs = toolCatalog.map((tool) => tool.id);

/**
 * 指定ツールの関連ツールを取得する（回遊カード用）。
 *
 * 1. `related` に指定された id を優先順に解決（自分自身・存在しない id・重複は除外）
 * 2. `limit` に満たなければ同カテゴリの他ツールで補完（既出・自分は除外）
 * 3. それでも 0 件なら空配列を返す（呼び出し側はセクションを描画しない）
 */
export function getRelatedTools(toolId: string, limit = 3): ToolCatalogItem[] {
	const self = toolCatalog.find((t) => t.id === toolId);
	if (!self) return [];

	const byId = new Map(toolCatalog.map((t) => [t.id, t]));
	const result: ToolCatalogItem[] = [];
	const seen = new Set<string>([toolId]);

	const push = (tool: ToolCatalogItem | undefined) => {
		if (!tool || seen.has(tool.id) || result.length >= limit) return;
		seen.add(tool.id);
		result.push(tool);
	};

	// 1. related を優先順に追加
	for (const id of self.related ?? []) {
		push(byId.get(id));
	}

	// 2. 不足分を同カテゴリで補完（カタログ順）
	if (result.length < limit) {
		for (const tool of toolCatalog) {
			if (tool.category === self.category) push(tool);
			if (result.length >= limit) break;
		}
	}

	return result;
}
