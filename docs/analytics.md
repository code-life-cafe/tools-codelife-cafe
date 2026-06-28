# 計測基盤 (Analytics)

## 方針

CODE:LIFE Tools はクライアントサイド完結のツール集であり、ユーザーの入力データをサーバーへ送信しない。計測についても同様の思想を適用する。

- **Cookie を使用しない** — Cloudflare Web Analytics は Cookie レスで動作し、同意バナーが不要。
- **個人を識別・追跡しない** — ページビュー・リファラー等の集計データのみ収集。
- **入力データを送信しない** — 各ツールで扱うデータは一切計測に含まれない。

---

## Cloudflare Web Analytics

### 概要

Cloudflare Web Analytics のビーコンスクリプトを使用してページビューを計測する。ビーコンは軽量（< 5 KB）で、パフォーマンスへの影響は最小限。

### セットアップ

1. **Cloudflare ダッシュボード** > Web Analytics でサイト `tools.codelife.cafe` を追加し、サイトトークンを取得する。
2. GitHub リポジトリの **Settings > Secrets and variables > Actions > Variables** に `PUBLIC_CF_BEACON_TOKEN` として登録する。
   - Secret ではなく **Variable**（`vars`）を使用する。トークンは HTML に出力される公開値のため。
3. デプロイは GitHub Actions（`.github/workflows/deploy.yml`）で `npm run build` を実行する際に環境変数として注入される。

### 実装

- **ビーコン挿入箇所**: `src/layouts/BaseLayout.astro` の `</body>` 直前に `<script defer>` で挿入。
- **条件付き出力**: `PUBLIC_CF_BEACON_TOKEN` 環境変数が設定されている場合のみビーコンタグを出力する。未設定時（ローカル開発など）はタグ自体が生成されない。
- **トークン注入**: GitHub Actions の Variables 経由で注入する。Cloudflare Pages ダッシュボードの環境変数ではない（ビルドが GitHub Actions 上で走るため）。

### CSP (Content Security Policy)

`public/_headers` で以下のドメインを許可済み:

| ディレクティブ | ドメイン | 用途 |
|---|---|---|
| `script-src` | `https://static.cloudflareinsights.com` | `beacon.min.js` の配信元 |
| `connect-src` | `https://cloudflareinsights.com` | `/cdn-cgi/rum` への計測データ送信先 |

---

## Google Search Console

### 登録手順

1. [Google Search Console](https://search.google.com/search-console/) でドメインプロパティ `tools.codelife.cafe` を追加する。
2. 所有権の確認は **Cloudflare 連携**（DNS 自動確認）が最も簡便。Cloudflare ダッシュボードで Google Search Console との連携を有効にすれば DNS レコードが自動追加される。
3. サイトマップ `https://tools.codelife.cafe/sitemap-index.xml` を送信する。

---

## Bing Webmaster Tools

### 登録手順

1. [Bing Webmaster Tools](https://www.bing.com/webmasters/) にアクセスする。
2. **Google Search Console からインポート** を選択すると、設定をそのまま引き継げるため最も簡便。
3. サイトマップは Google Search Console から自動的にインポートされる。

---

## robots.txt / sitemap

- **robots.txt**: `public/robots.txt` に設定済み。
- **sitemap**: `@astrojs/sitemap` インテグレーションにより自動生成される。
  - `sitemap-index.xml` — サイトマップインデックス
  - `sitemap-0.xml` — 個別のURL一覧
- サイトマップの URL: `https://tools.codelife.cafe/sitemap-index.xml`
