# CODE:LIFE Tools

**仕事で安心して使える、完全クライアントサイド処理のWebツール集。**

すべてのデータ処理はお使いのブラウザ内で完結。サーバーへのデータ送信は一切ありません。

🔗 **[https://tools.codelife.cafe](https://tools.codelife.cafe)**

## 📦 収録ツール（32種）

### テキスト処理

| ツール | 説明 |
|--------|------|
| [全角⇔半角変換](/zenkaku-hankaku) | カタカナ・英数字・記号の全角⇔半角一括変換 |
| [文字数カウント](/char-count) | 文字数・バイト数（UTF-8/Shift-JIS）・行数をリアルタイムカウント |
| [テキスト差分](/text-diff) | 2つのテキストの差分を並列・インライン表示 |
| [ユニコード変換](/unicode-converter) | テキストとユニコードエスケープシーケンス（\\uXXXX）を相互変換 |
| [Markdownプレビュー](/markdown) | GFM対応のリアルタイムプレビュー。HTMLコピー・ダウンロード対応（データは外部送信なし） |
| [ワードクラウド生成](/wordcloud) | 日本語テキストを形態素解析しワードクラウド・頻度表（CSV）化（データは外部送信なし） |

### データ処理

| ツール | 説明 |
|--------|------|
| [JSON整形](/json-formatter) | JSONの整形・圧縮・バリデーション |
| [JSON ↔ CSV 変換](/json-csv) | JSONとCSVの相互変換。ネスト展開・型推論・BOM付きUTF-8出力（Excel文字化け対策） |
| [CSVビューア/エディタ](/csv-editor) | CSVをテーブル形式で閲覧・編集・エクスポート |
| [CSV文字化け修復](/csv-fixer) | CSVの文字コード自動判定・変換（Shift_JIS/UTF-8/EUC-JP等） |
| [電話番号フォーマッタ](/phone-formatter) | 日本語の電話番号をE.164・国際表記・国内表記に即変換。CSV一括変換対応。 |
| [ダミーデータ生成](/dummy-data) | 日本語の氏名・住所・電話番号等の一括生成（JSON/CSV/TSV） |
| [郵便番号→住所変換](/zipcode) | 郵便番号から住所を検索・一括変換。Excel貼り付け・CSV出力対応（データは外部送信なし） |

### ユーティリティ

| ツール | 説明 |
|--------|------|
| [背景削除](/bg-remove) | AIがブラウザ内で画像の背景を自動削除。差し替えにも対応（完全ローカル実行） |
| [画像モザイク・ぼかし](/image-mosaic) | 四角形/円形の範囲にモザイク・ぼかしを適用し、絵文字・任意画像スタンプも配置（完全ローカル実行） |
| [画像テキスト挿入](/image-text) | 画像への文字入れ・注釈。縁取り・背景ボックス対応（完全ローカル実行） |
| [画像圧縮・リサイズ](/image-compress) | JPEG/PNG/WebPの圧縮・リサイズ・変換。一括処理・目標サイズ指定・ZIP出力（完全ローカル実行） |
| [画像形式変換](/image-convert) | HEIC・WebP・AVIF・PNG・JPEGを相互変換。HEIC→JPEG一括・品質指定・EXIF保持/削除・ZIP出力（完全ローカル実行） |
| [画像メタデータ削除](/image-metadata) | JPEG・PNG・WebP画像のExif・GPS位置情報などを削除。形式変換・一括ZIP出力対応（完全ローカル実行） |
| [画像トリミング・回転](/image-crop) | 画像の切り抜き、90度回転、上下左右反転をブラウザ内で実行（完全ローカル実行） |
| [QRコード生成](/qr-generator) | テキスト・URLからQRコードを生成しPNG/SVGダウンロード |
| [Base64エンコード/デコード](/base64) | テキスト・ファイルのBase64変換、Data URI出力対応 |
| [URLエンコード/デコード](/url-encoder) | 日本語を含むURLやクエリを安全に双方向変換。コンポーネント/フルURLモード対応 |
| [和暦⇔西暦変換](/wareki-converter) | 和暦（令和・平成等）と西暦のリアルタイム相互変換 |
| [消費税・税込計算](/tax) | 税込⇔税抜の即時計算。軽減税率・過去税率（3%/5%/8%）・端数処理（切り捨て/四捨五入/切り上げ）対応 |

### PDF

| ツール | 説明 |
|--------|------|
| [PDF結合](/pdf-merge) | 複数のPDF・画像（JPEG/PNG）を1つのPDFに結合。並べ替え対応（完全ローカル実行） |
| [PDF分割・ページ抽出](/pdf-split) | 範囲指定で分割・抽出・1ページずつ分割。ZIP一括ダウンロード対応（完全ローカル実行） |

### 開発者向け

| ツール | 説明 |
|--------|------|
| [正規表現チェッカー](/regex-tester) | リアルタイムマッチング・置換・キャプチャグループ表示 |
| [ハッシュ値計算](/hash) | MD5・SHA-1・SHA-256・SHA-512・CRC32の計算と期待値照合（ファイルの改ざんチェック） |
| [SQLフォーマッター](/sql-formatter) | SQL文の整形（MySQL, PostgreSQL等の方言対応） |
| [個人情報マスキング](/masking) | メール・電話番号・カード番号等を自動検出してマスキング |
| [暗号変換](/cipher) | シーザー暗号・ROT13・モールス信号・逆順等のテキスト変換 |
| [カラーコード変換](/color) | HEX・RGB・HSL・CMYKの相互変換。カラーピッカー連動・ワンクリックコピー |
| [ファビコン生成](/favicon) | 画像から favicon.ico・各サイズPNG・apple-touch-icon・site.webmanifest を一括生成。アップロード不要・HTMLタグ出力対応（完全ローカル実行） |
| [画像Base64変換](/image-base64) | 画像をBase64/Data URIへ相互変換。`<img>`タグ・CSS `url()` スニペット出力。逆変換対応 |

## 🛡️ セキュリティ

- **完全クライアントサイド処理** — データが外部サーバーに送信されることはありません
- **オープンソース** — コードはすべて公開されており、処理内容を誰でも確認できます
- **PWA対応・オフライン動作** — インストール後はオフライン環境でも全ツールを利用可能

## 🏗️ 技術スタック

- **フレームワーク:** [Astro](https://astro.build/)（静的サイト生成）
- **UIコンポーネント:** React（Astro Islands） + [shadcn/ui](https://ui.shadcn.com/)
- **スタイリング:** Tailwind CSS v4
- **アイコン:** Lucide Icons
- **テスト:** Playwright（E2E）
- **ホスティング:** Cloudflare Pages
- **CI/CD:** GitHub Actions

## 🧞 コマンド

| コマンド | 説明 |
|----------|------|
| `npm install` | 依存パッケージをインストール |
| `npm run dev` | 開発サーバーを起動（`localhost:4321`） |
| `npm run build` | 本番用に静的ビルド＋SW生成（`dist/`） |
| `npm run preview` | ビルド結果をローカルプレビュー |
| `npx playwright test --headed` | E2Eテストを実行（ブラウザ表示あり） |
| `npm run test:unit` | コアロジックの単体テストを実行（Node 22 の `node --test`、runner追加なし） |

## 🚀 Cloudflare R2 モデル配信

背景削除ツールの AI モデルは **`models.tools.codelife.cafe`**（Cloudflare R2）から配信されます。

| バケット | `codelife-models` |
|---|---|
| カスタムドメイン | `https://models.tools.codelife.cafe` |
| CORS | `tools.codelife.cafe`, `localhost:4321` |

**配信済みモデル:**
- `onnx-community/modnet-webnn/resolve/main/onnx/model.onnx` — 25.9MB (MODNet fp32)
- `onnx-community/BEN2-ONNX/resolve/main/onnx/model_fp16.onnx` — 219MB (BEN2 fp16)

ローカル開発時（`localhost`）は HuggingFace CDN に自動フォールバックします。

### モデルを再アップロードする場合

```bash
bash scripts/upload-models-to-r2.sh codelife-models
```

### CORS 設定を変更する場合

`scripts/r2-cors.json` を編集してから:

```bash
wrangler r2 bucket cors set codelife-models --file scripts/r2-cors.json
```

## 📮 郵便番号データの更新

郵便番号→住所変換ツールの住所データは [日本郵便 郵便番号データ](https://www.post.japanpost.jp/service/search/zipcode/download/)（自由に配布・利用可能）を元に、上2桁チャンクJSON（`public/data/zipcode/{00..99}.json`）として同梱しています。日本郵便の月次更新に追従する場合のみ、以下を実行してコミットします（ビルドでは実行しません）。

```bash
# 1. utf_ken_all.zip を取得・展開して scripts/.cache/utf_ken_all.csv に配置
#    （scripts/.cache/ は .gitignore 対象。入力CSVはコミットしない）
#    Windows: Expand-Archive utf_ken_all.zip -DestinationPath scripts/.cache
#    macOS/Linux: unzip utf_ken_all.zip -d scripts/.cache
# 2. チャンクJSON + metadata.json を生成
node scripts/generate-zipcode-data.ts
# 3. public/data/zipcode/ の差分をコミット
```

生成スクリプトは冪等で、`public/data/zipcode/metadata.json` に出典・件数・データバージョン（`YYYY-MM`）を記録します。ページの「○○時点」表記はこのメタデータから生成されます。

---

## 📄 ライセンス

MIT

画像形式変換ツール（`/image-convert`）は HEIC デコードに [libheif-js](https://github.com/catdad-experiments/libheif-js)（LGPL-3.0）、AVIF エンコードに [@jsquash/avif](https://github.com/jamsinclair/jSquash)（Apache-2.0）を、いずれも当該ページで必要時のみ動的にロードして利用しています。詳細は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照してください。
