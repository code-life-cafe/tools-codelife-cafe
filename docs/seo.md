# SEO & 構造化データ (JSON-LD) ガイドライン

`tools.codelife.cafe` では、Google などの検索エンジンおよび AI 検索・AI エージェント（GEO）によるエンティティ理解を最適化するため、全ページに Schema.org に準拠した JSON-LD 構造化データを付与しています。

---

## 1. 構造化データ設計

### トップページ (`src/pages/index.astro`)
- **`WebSite`**: サイト全体のメタデータを提供。
- **`Person`**: 運営者/管理者エンティティ（`@id: "https://tools.codelife.cafe/#org"`）を定義し、GitHub などの `sameAs` リンクを接続。

### 全ツールページ (`src/components/common/ToolLayout.astro`)
- **`SoftwareApplication`**: ツールごとのアプリケーション情報（名称、説明、料金 `0 JPY`、動作環境 `Any` 等）。`publisher` としてトップページの `@id` (`https://tools.codelife.cafe/#org`) を参照し、エンティティグラフを構成。
- **`BreadcrumbList`**: ツールページへの階層（ホーム > カテゴリ > ツール名）を絶対 URL で記述。

---

## 2. 実装手順とコード構成

構造化データの生成ロジックは pure TypeScript として `src/lib/jsonld.ts` に集約されています。

- `softwareApplication(tool)`: `SoftwareApplication` オブジェクトを生成
- `breadcrumb(path, title, categoryName, categoryHref)`: `BreadcrumbList` オブジェクトを生成
- `generateJsonLd(tool, categoryHref)`: 上記 2 つを `@graph` 配列にまとめた JSON-LD を生成

各 Astro ページおよびコンポーネント内では、`<JsonLd data={...} />` コンポーネント経由で `<script type="application/ld+json">` として安全にエスケープ出力します。

---

## 3. 検証手順

リバースプロキシやビルド後の全 HTML に対して、構造化データが正しく付与されているか以下のコマンドで検証します。

### 3.1 ユニットテストと静的解析の実行
```bash
npm run test:unit
npm run lint
npm run check
```

### 3.2 ビルド後 HTML の件数チェック (CLI Grep)
ビルド実行後、生成された HTML ファイル群に `SoftwareApplication` が全ツール数分出力されているか確認します。

```bash
# ビルドの実行
npm run build

# PowerShell での確認例 (dist ディレクトリ内の SoftwareApplication 件数カウント)
(Get-ChildItem -Path dist -Recurse -Filter *.html | Select-String -Pattern '"@type":"SoftwareApplication"').Count
```
※全ツールの数（例: 37件以上）と出力件数が一致することを確認します。

### 3.3 Schema Markup Validator での検証
1. [Google Rich Results Test](https://search.google.com/test/rich-results) または [Schema Markup Validator](https://validator.schema.org/) を開きます。
2. ビルドされた HTML または公開後の URL を入力し、エラーや警告が 0 件であることを確認します。

---

## 4. llms.txt と AI クローラ方針

`/llms.txt` と `/llms-full.txt` は、AI 検索・AI エージェントがサイト構造と各ツールの用途を把握しやすくするための補助レイヤーです。robots.txt、sitemap、Schema.org JSON-LD を置き換えるものではなく、通常の SEO 基盤に追加する参照情報として扱います。

- `/llms.txt`: サイト概要と公開ツール一覧を簡潔に出力します。
- `/llms-full.txt`: 各ツールの URL、用途、入力、出力、主要オプションを含む詳細リファレンスを出力します。
- `public/robots.txt`: 全体を `Allow: /` とし、Googlebot / Bingbot に加えて GPTBot / ChatGPT-User / ClaudeBot / PerplexityBot などの主要 AI クローラを不用意にブロックしない方針です。

llms.txt はアクセス制御ではありません。クローラ許可・拒否は robots.txt で管理し、llms.txt には AI が参照しやすい説明とリンクを集約します。
