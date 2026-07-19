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
- **`tool_engage` の発火タイミングと「初回」の定義**: マウント時（＝擬似ページビュー）には発火させない。ツールページ上で最初に発生したユーザー操作（`pointerdown` / `keydown`）を捕捉した時点、または最初の `trackRun()` 実行時のいずれか早い方で 1 回だけ発火する（`src/lib/hooks/useToolAnalytics.ts`）。実行は明確なエンゲージメントであるため、`trackRun()` は保険として `tool_engage` 未発火時に engage を確定させる。重複発火は React の `useRef` フラグと、`src/lib/analytics.ts` のモジュールスコープ `Set`（タブ単位・永続化なし）の二段で防止する。
- **`search_empty` のマスクルール**: 検索語の生テキストは送信せず、集計用メタ情報（文字数バケット・日本語の有無・トークン数）のみを送信する。メールアドレスやURL、電話番号などの個人情報らしき文字列が含まれる場合は `q_redacted: true` フラグのみを付与する。
- **slug の導出**: `tool`, `from`, `to` に渡す slug は、`src/lib/tools/catalog.ts` の定義を正本として利用し、文字列の手書きによる表記揺れを防止する。

### 匿名セッションID（プライバシー方針との整合性）
セッション単位の指標（「セッションあたり利用ツール数」「トップ→個別ツール遷移率」等）を算出するため、全イベントに匿名セッションIDを付与する。本IDは既存のプライバシー方針（Cookie・localStorage による個人追跡をしない）と以下の点で整合する。

- **タブ限りの揮発ID**: `sessionStorage`（`clc_analytics_session_id` キー）に保存し、ブラウザタブが閉じられた時点で破棄される。**`localStorage`・Cookie は一切使用しない**ため、タブ・ブラウザ再起動・端末を横断した永続的な個人追跡は原理的に不可能。
- **完全ランダム値**: `crypto.randomUUID()` で生成する匿名の使い捨てIDであり、個人・端末を識別する情報（IP・フィンガープリント等）とは無関係。`sessionStorage` が使えない環境ではメモリ上のフォールバックIDを用いる（`src/lib/analytics.ts` の `getSessionId()`）。
- **用途の限定**: セッション内のイベントを紐付けて集計する目的のみに使用し、個人のプロファイリングには用いない。
- **格納先**: `src/lib/analytics.ts` の `track()` が payload に `sessionId` を含め、`functions/api/event.ts` が Analytics Engine の **`blob5`** に格納する（インデックスは 1 データポイントにつき 1 つのみ許容されるため、`indexes` ではなく blob スロットに積む）。

---

## Bot/Human 計測分離（traffic_type）

**方針: bot・AIアクセスは歓迎。遮断・レート制限・robots.txt での拒否は一切実装しない。** 目的は「人間向けゲート判定」と「AI利用の観測」を計測上分離することのみであり、bot判定はアクセス可否に一切影響しない。

- **判定に使う情報**: リクエストの `User-Agent` ヘッダーと、クライアントから送信される `navigator.webdriver` ヒントのみ。IP・TLSフィンガープリント等の高度なフィンガープリンティングは行わない。
- **分類ロジック**: `functions/lib/traffic-type.ts` の `classifyTrafficType()` が全イベント共通で判定する。
  - `ai_agent`: `functions/lib/known-bots.ts` の `AI_AGENT_USER_AGENTS`（GPTBot、OAI-SearchBot、ClaudeBot、Claude-User、PerplexityBot、Google-Extended 等）に一致
  - `crawler`: 同ファイルの `CRAWLER_USER_AGENTS`（Googlebot、Bingbot、CCBot 等）、または `GENERIC_BOT_KEYWORDS`（`curl`・`python-requests`・`scrapy` 等の汎用bot/自動化キーワード）に一致
  - `unknown`: UA が空、または UA からは判定できないが `navigator.webdriver === true`（自動テスト・未知の自動化ツール）
  - `human`: 上記いずれにも該当しない通常ブラウザUA
- **既知UAリストの更新**: `functions/lib/known-bots.ts` の配列に追記するだけで良い（判定ロジック本体の変更は不要）。
- **格納先**: 既存 blob の順序・意味を変えず末尾に追加した **`blob6`** に格納する（後方互換維持）。クライアント側の `webdriver` ヒント自体は Analytics Engine に直接保存せず、判定結果（`traffic_type`）のみを保存する。

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
   ```sql
   -- セッションあたりの tool_run 数（匿名セッションID = blob5）
   SELECT AVG(runs) AS avg_runs_per_session
   FROM (
     SELECT blob5 AS session_id, COUNT(*) AS runs
     FROM tools_codelife_cafe_events
     WHERE index1 = 'tool_run' AND blob5 != ''
     GROUP BY session_id
   )
   ```
   ```sql
   -- トップ→個別ツール遷移率（トップに engage したセッションのうち、いずれかのツールを run したセッションの割合）
   SELECT
     COUNT(DISTINCT IF(index1 = 'tool_run', blob5, NULL)) * 1.0
       / COUNT(DISTINCT blob5) AS top_to_tool_transition_rate
   FROM tools_codelife_cafe_events
   WHERE blob5 != ''
   ```
   ```sql
   -- 【human セグメント限定】ツール別の実行件数（ゲート判定・人間向け施策のレビューに使用）
   SELECT blob2 AS tool_slug, COUNT(*) AS count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run' AND blob6 = 'human'
   GROUP BY tool_slug
   ORDER BY count DESC
   ```
   ```sql
   -- 【ai_agent セグメント限定】AI利用のKPI観測（「AIに使われた回数」を別枠集計）
   SELECT blob2 AS tool_slug, COUNT(*) AS ai_used_count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run' AND blob6 = 'ai_agent'
   GROUP BY tool_slug
   ORDER BY ai_used_count DESC
   ```
   ```sql
   -- traffic_type 別の全イベント件数分布（human / ai_agent / crawler / unknown）
   SELECT blob6 AS traffic_type, COUNT(*) AS count
   FROM tools_codelife_cafe_events
   GROUP BY traffic_type
   ORDER BY count DESC
   ```

> **blob スロット対応表**: `blob1` = イベント名、`blob2` = ツールslug（`tool` / `from`）、`blob3` = 補助1（`source` / `to` / `lengthBucket`）、`blob4` = 補助2（`setId` / `hasJapanese`）、`blob5` = 匿名セッションID、`blob6` = `traffic_type`（`human` / `ai_agent` / `crawler` / `unknown`）。`index1` = イベント名（インデックスは 1 データポイント 1 つのみ）。`double1` = `related_click` の `position` のみに使用。
