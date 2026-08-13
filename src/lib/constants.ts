// constants.ts — ツール間で重複しがちな「ファイルサイズ上限」「ObjectURL解放遅延」
// 「UX表示件数」等のマジックナンバーを一元管理する。
// 各ツール側では、ここから値を import してそのまま再エクスポート/使用し、
// 既存の定数名・挙動は変更しない（一括変更時の修正漏れ防止が目的）。
// 値の違いは意図的なもの（処理コスト・入力形式・UXバランス等）であり、
// 根拠はキー名およびコメントで明記する。

/** バイト換算の基準値（1MB = 1024 * 1024 bytes） */
export const BYTES_PER_MB = 1024 * 1024;

/**
 * 単一ファイルのサイズ上限（MB単位）。
 * ツールごとの処理コスト・入力形式に応じて意図的に異なる値を設定している。
 */
export const FILE_SIZE_LIMITS_MB = {
	/** 画像共通ユーティリティ（image-mosaic / image-text 共用, image-common.ts） */
	IMAGE_COMMON: 20,
	/** 画像圧縮（image-compress.ts） */
	IMAGE_COMPRESS: 50,
	/** 画像形式変換（image-convert.ts） */
	IMAGE_CONVERT: 50,
	/** 画像結合（image-merge.ts） */
	IMAGE_MERGE: 50,
	/** 画像編集：クロップ・回転・反転（image-edit.ts） */
	IMAGE_EDIT: 50,
	/** EXIF表示・削除（exif.ts） */
	EXIF: 50,
	/** 画像→Base64変換。テキスト化でサイズが約1.37倍に膨張するため他の画像ツールより低め（image-base64.ts） */
	IMAGE_BASE64: 10,
	/** メタデータ一括表示・削除（image-metadata.ts） */
	IMAGE_METADATA: 25,
	/** 画像アップスケール。推論処理の負荷が高いため厳しめ（upscale-core.ts） */
	UPSCALE: 20,
	/** ファビコン生成（favicon.ts） */
	FAVICON: 20,
	/** ハッシュ計算。チャンク読み込みのため大容量ファイルを許容（hash.ts） */
	HASH: 256,
	/** PDF結合・分割（pdf.ts） */
	PDF: 100,
} as const;

/**
 * 複数ファイル一括処理時の合計サイズ上限（バイト）。
 * ブラウザのメモリ制約を踏まえ、対象ツール（image-convert / image-merge / image-edit / exif / pdf）
 * 間で共通の300MBとしている。
 */
export const BATCH_TOTAL_SIZE_LIMIT_BYTES = 300 * BYTES_PER_MB;

/**
 * 複数ファイル一括処理時の最大ファイル数。
 * 画像圧縮・結合・編集で共通の30枚としている。
 */
export const BATCH_MAX_FILE_COUNT = 30;

/**
 * メタデータ一括削除（image-metadata.ts）の最大ファイル数。
 * サムネイル一覧表示のレンダリングコストを踏まえ、他の一括処理ツールより少なめ。
 */
export const IMAGE_METADATA_MAX_FILE_COUNT = 20;

/**
 * hash.ts のファイルサイズ警告しきい値（バイト）。
 * 大容量ファイルのハッシュ計算時にUI上の警告表示を切り替えるための境界値。
 */
export const HASH_LARGE_FILE_THRESHOLD_BYTES = 100 * BYTES_PER_MB;
export const HASH_HUGE_FILE_THRESHOLD_BYTES = 200 * BYTES_PER_MB;

/**
 * Blob ダウンロード後、生成した ObjectURL を revoke するまでの遅延（ミリ秒）。
 * click 直後に revoke するとダウンロードが失敗するブラウザがあるため遅延させる
 * （src/lib/download.ts と src/lib/tools/image-common.ts の downloadBlob で共用）。
 */
export const OBJECT_URL_REVOKE_DELAY_MS = 1000;

/**
 * CSV編集ツール（CsvEditor.tsx）の1ページあたり表示行数。
 * 大量行のレンダリングコストとページング操作性のバランスを取った値。
 */
export const CSV_EDITOR_ROWS_PER_PAGE = 50;
