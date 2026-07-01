# 計測基盤 (Analytics)

## 方針

CODE:LIFE Tools はクライアントサイド完結のツール集であり、ユーザーの入力データ・ファイル内容・PII（個人情報）をサーバーへ送信しない。計測についても同様の思想を厳格に適用する。

- **Cookie・ストレージによる個人の追跡を行わない** — Cookie や localStorage によるユーザー追跡・プロファイリングは一切行わない。
- **個人を識別・追跡しない** — ページビュー・リファラー等の集計データおよび匿名の集計イベントのみ収集。
- **入力・変換データを送信しない** — 各ツールで扱うテキスト・ファイル・入力パラメータ等の具体的な内容は一切計測に含まない。
- **計測失敗による影響の遮断 (Fire-and-Forget)** — 計測ネットワークリクエストが失敗した場合でも握りつぶし、ツールの動作を妨げない。

---

## 収集イベント一覧 (Cloudflare Analytics Engine)

改善効果を判定するため、以下の 5 つの完全匿名イベントを Cloudflare Analytics Engine 経由で収集する。

| イベント名 | 発火条件 | 収集プロパティ (Allowlist) | 目的 |
|---|---|---|---|
| `tool_run` | ツール実行・変換処理が走った時 | `{ tool: string }` (ツールslug) | ツールの利用頻度の計測 |
| `tool_engage` | 個別ツールで初めて入力・操作があった時（タブ単位で1回） | `{ tool: string }` (ツールslug) | ツールごとの実活用セッション数の計測 |
| `search_empty` | トップ検索でヒットが0件だった時 | `{ lengthBucket: string, hasJapanese: boolean, tokenCount: number, q_redacted?: boolean }` | 未対応ツール需要の把握（生検索語は非送信） |
| `related_click` | 関連ツール回遊カードのクリック時 | `{ from: string, to: string, setId?: string, position: number }` (ツールslug, セットID, リスト内位置) | ツール間回遊の導線効果の検証 |
| `shared_url_open` | 共有URL経由で初期状態が復元された時 | `{ tool: string }` (ツールslug) | 共有機能の利用状況の検証 |

### 特記事項・マスクルール
- **`tool_engage` の「初回」の定義**: セッション単位（ブラウザタブが閉じられるまで）でツールごとに 1 回だけ発火する。JavaScript メモリ上の `Set` で重複発火を防止し、永続化しない。
- **`search_empty` のマスクルール**: 検索語の生テキストは送信せず、集計用メタ情報（文字数バケット・日本語の有無・トークン数）のみを送信する。メールアドレスやURL、電話番号などの個人情報らしき文字列が含まれる場合は `q_redacted: true` フラグのみを付与する。
- **slug の導出**: `tool`, `from`, `to` に渡す slug は、`src/lib/tools/catalog.ts` の定義を正本として利用し、文字列の手書きによる表記揺れを防止する。

---

## 送信パイプライン & インフラ構成

### アーキテクチャ
`sendBeacon` / `fetch` (keepalive) → Pages Function (`/api/event`) → Cloudflare Analytics Engine (`EVENTS` Dataset)

1. **クライアントユーティリティ (`src/lib/analytics.ts`)**:
   - `navigator.sendBeacon('/api/event', ...)` を優先使用し、未対応環境では `fetch` にフォールバックする。
   - 開発環境 (`import.meta.env.DEV`) では送信をスキップし、`console.debug` にログ出力する。
2. **Cloudflare Pages Function (`functions/api/event.ts`)**:
   - 許可された Origin（本番ドメイン `https://tools.codelife.cafe` 等）および許可済みイベント名・Allowlist props のみを検証して受理する。
   - 不正なリクエストや未許可のプロパティは 204 で静かに破棄する。
   - `context.env.EVENTS.writeDataPoint(...)` を呼び出して Analytics Engine に書き込む。
3. **Wrangler 設定 (`wrangler.jsonc`)**:
   - Analytics Engine データセットのバインディング名: `EVENTS`
   - データセット名: `tools_codelife_cafe_events`

---

## Cloudflare Web Analytics (RUM)

ページビューやパフォーマンスの全体統計用に Cloudflare Web Analytics（RUM）を併用する。

- **ビーコン挿入箇所**: `src/layouts/BaseLayout.astro` の `</body>` 直前に挿入。
- **トークン管理**: GitHub Actions の Variables (`PUBLIC_CF_BEACON_TOKEN`) 経由で注入。
- **制限事項**: カスタムイベントの保存先としては使用しない（本プロジェクトのカスタムイベントはすべて Analytics Engine に集約する）。

---

## 本番集計・可視化確認手順 (人間によるデプロイ後確認項目)

本番環境デプロイ後、管理者は以下の手順で Analytics Engine に蓄積されたイベントデータを確認できる。

1. **Cloudflare ダッシュボード**にログインする。
2. **Analytics & Logs > Analytics Engine** を選択する。
3. データセット `tools_codelife_cafe_events` を選択し、SQL クエリを実行して集計データを確認する。
   ```sql
   -- イベント別の発火件数集計
   SELECT index1 AS event_name, COUNT(*) AS count
   FROM tools_codelife_cafe_events
   GROUP BY event_name
   ORDER BY count DESC
   ```
   ```sql
   -- ツール別の実行件数 (tool_run)
   SELECT blob2 AS tool_slug, COUNT(*) AS count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run'
   GROUP BY tool_slug
   ORDER BY count DESC
   ```
   ```sql
   -- 関連ツール回遊：セット別クリック数・位置別平均
   SELECT blob4 AS set_id, COUNT(*) AS click_count, AVG(double1) AS avg_position
   FROM tools_codelife_cafe_events
   WHERE index1 = 'related_click'
   GROUP BY set_id
   ORDER BY click_count DESC
   ```
