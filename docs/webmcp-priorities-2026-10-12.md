# WebMCP対応候補の監査と優先順位（2026-10-12）

監査基準: main `f1e3c7d18aee29cf0eb9251a9bca67d08309d6c1`。公開サイト55件、カタログ55件。対応の判定はmanifestの有無だけでなく、対象コンポーネントの登録経路まで確認。既存対応12件、未対応43件。サイト共通の一覧・検索は個別ツール件数に含めない。

既存対応: base64, char-count, cron-checker, hash, json-formatter, jwt-decoder, qr-encrypt, tax, unix-time, url-encoder, uuid, zenkaku-hankaku.

順位は利用実測ではなく、AIの作業での需要、AI自身による代替の難しさ、既存実装・データ・モデルを再利用する価値、構造化した入出力の扱いやすさによる編集判断。ファイル処理は価値が高くても、ファイル受渡し・大容量・実行時間の設計が必要なため初回優先度を調整。

| 順位 | ツール | AIが使う価値 |
|---:|---|---|
| 1 | [Mermaidプレビュー・修復](https://tools.codelife.cafe/mermaid) | AIが生成した図の修復とSVG化を一度の呼び出しで完結 |
| 2 | [YAML ⇔ JSON ⇔ TOML 変換](https://tools.codelife.cafe/yaml-json-toml) | 構文検証・形式固有の制約を含む設定ファイル変換を確実に実行 |
| 3 | [個人情報マスキング](https://tools.codelife.cafe/masking) | 日本語の個人情報パターンを既存検出器で加工。共有前の確認を補助 |
| 4 | [CSV文字化け修復](https://tools.codelife.cafe/csv-fixer) | Shift_JIS/BOM等、LLMの文章生成では解決しにくいバイト処理 |
| 5 | [郵便番号↔住所変換](https://tools.codelife.cafe/zipcode) | 既存の日本郵便データを再利用し住所を検証 |
| 6 | [JSON ↔ CSV 変換](https://tools.codelife.cafe/json-csv) | 引用符・ネスト・型推論を含む表形式変換 |
| 7 | [電話番号フォーマッタ](https://tools.codelife.cafe/phone-formatter) | 日本の番号の正規化と妥当性判定 |
| 8 | [CSVビューア/エディタ](https://tools.codelife.cafe/csv-editor) | 表のフィルタ・ソート・編集を構造化操作できる |
| 9 | [画像圧縮・リサイズ](https://tools.codelife.cafe/image-compress) | 目標容量・形式・解像度の調整を画像処理器へ任せる |
| 10 | [PDF分割・ページ抽出](https://tools.codelife.cafe/pdf-split) | PDFのページ抽出を確実な成果物にする |
| 11 | [正規表現テスター](https://tools.codelife.cafe/regex-tester) | 実際の正規表現エンジンで一致・置換を検証 |
| 12 | [画像形式変換](https://tools.codelife.cafe/image-convert) | HEIC/AVIFなど対応コーデックを再利用 |
| 13 | [背景削除](https://tools.codelife.cafe/bg-remove) | ブラウザ内推論モデルを再利用 |
| 14 | [PDF結合](https://tools.codelife.cafe/pdf-merge) | PDFと画像の結合を成果物化 |
| 15 | [文字起こし（ローカル）](https://tools.codelife.cafe/transcribe) | ローカル音声認識モデルを利用 |
| 16 | [ダミーデータ生成](https://tools.codelife.cafe/dummy-data) | 日本語の氏名・住所などテストデータを生成 |
| 17 | [ログ時間差分析](https://tools.codelife.cafe/log-time-analyzer) | ログの時間差を決定論的に集計 |
| 18 | [画像メタデータ削除](https://tools.codelife.cafe/image-metadata) | 公開前の画像メタデータを除去 |
| 19 | [EXIF確認・削除](https://tools.codelife.cafe/exif) | 撮影情報の検査と除去を組み合わせる |
| 20 | [画像のクロップ・回転・反転](https://tools.codelife.cafe/image-edit) | 画像の幾何変換・一括書き出し |
| 21 | [QRコード読み取り](https://tools.codelife.cafe/qr-reader) | 画像やカメラからQR内容を取り出す |
| 22 | [画像連結・結合](https://tools.codelife.cafe/image-merge) | 複数画像を配置して結合 |
| 23 | [テキスト差分比較](https://tools.codelife.cafe/text-diff) | 差分を機械的に確定 |
| 24 | [SQL整形・フォーマッター](https://tools.codelife.cafe/sql-formatter) | SQL方言別の既存フォーマッタを再利用 |
| 25 | [ファビコン生成](https://tools.codelife.cafe/favicon) | サイズ別アイコンと一式を生成 |
| 26 | [画像モザイク・ぼかし](https://tools.codelife.cafe/image-mosaic) | 指定領域を画像上でマスキング |
| 27 | [画像アップスケール](https://tools.codelife.cafe/upscale) | 推論モデルで高解像度化 |
| 28 | [QRコード生成](https://tools.codelife.cafe/qr-generator) | QRを画像として生成 |
| 29 | [OGP画像ジェネレーター](https://tools.codelife.cafe/ogp) | SNSカードを成果物化 |
| 30 | [画像テキスト挿入](https://tools.codelife.cafe/image-text) | 画像に注釈を描画 |
| 31 | [Markdownプレビュー](https://tools.codelife.cafe/markdown) | Markdownを既存GFM処理器でHTML化 |
| 32 | [AI表データプロンプト生成](https://tools.codelife.cafe/ai-spreadsheet-prompt) | 表解析を補助するがAI側の役割と重複が大きい |
| 33 | [URLパラメータ解析・編集](https://tools.codelife.cafe/url-parser) | URLの重複キー等を正確に解析・再生成 |
| 34 | [ワードクラウド生成](https://tools.codelife.cafe/wordcloud) | 日本語分かち書きと描画を再利用 |
| 35 | [画像Base64変換](https://tools.codelife.cafe/image-base64) | 画像のData URI化は確実だが比較的容易に自作可能 |
| 36 | [動画圧縮・リサイズ](https://tools.codelife.cafe/video-compress) | 圧縮器は有用だが大容量・長時間・ファイル受渡しが課題 |
| 37 | [和暦↔西暦変換](https://tools.codelife.cafe/wareki-converter) | 和暦の境界を検証できるが利用場面が限定的 |
| 38 | [ユニコード変換](https://tools.codelife.cafe/unicode-converter) | 確実だが単純な変換で代替しやすい |
| 39 | [カラーコード変換](https://tools.codelife.cafe/color) | 確実だが簡単に計算可能 |
| 40 | [ブックマークレット変換（JS ⇔ Bookmarklet）](https://tools.codelife.cafe/bookmarklet) | JavaScript文字列の変換でAI自身の代替が容易 |
| 41 | [ランダム並べ替え・グループ分け](https://tools.codelife.cafe/random-sort) | 抽選・グループ分けは用途が限定的 |
| 42 | [ドリップコーヒー抽出ガイド](https://tools.codelife.cafe/drip-coffee-guide) | 主用途が人間のリアルタイムタイマー |
| 43 | [暗号化・難読化](https://tools.codelife.cafe/cipher) | 実用的な暗号ではなくAIの業務タスクへの貢献が小さい |

## 今回の実装

- `repair_render_mermaid`: 修復コード、修正履歴、SVGを返す。既定はrepair、renderでSVG生成。修復のみは構文検証を保証しない。
- `convert_yaml_json_toml`: from/to・インデント・キーソート指定。構文エラーとTOML非対応値を返す。
- `mask_personal_information`: 6種の対象・伏字文字・強度を指定。既定は全対象・全文字伏字。検出漏れ・誤検出の注意を返し、原文や検出箇所の原文は返さない。AIへ渡した原文を遡って秘匿できるわけではない。

各ページでのみ登録。処理は既存ロジックを再利用し、入力の通信・保存・ログ出力は追加しない。依存・共通登録基盤・Analytics・PWA・権限・CIは変更しない。3件とも100000文字上限（descriptionと実行時検査。共通生成器のschema仕様は変更しない）。WebMCP非対応ブラウザでは既存UIを継続利用。

Risk Class: R3（WebMCP）。AGENTS.mdに従い、Draft PRを準備し、追加リスクレビューと人間承認を経てからMerge/Deployする。独立レビューは本作業の自己検証では代替しない。
