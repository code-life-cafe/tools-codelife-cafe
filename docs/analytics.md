# 計測基盤 (Analytics)

## 方針

CODE:LIFE Tools はクライアントサイド完結のツール集であり、ユーザーの入力データ・ファイル内容・PII（個人情報）をサーバーへ送信しない。計測についても同様の思想を厳格に適用する。

- **Cookie・ストレージによる個人の追跡を行わない** — Cookie や localStorage によるユーザー追跡・プロファイリングは一切行わない。
- **個人を識別・追跡しない** — ページビュー・リファラー等の集計データおよび匿名の集計イベントのみ収集。
- **入力・変換データを送信しない** — 各ツールで扱うテキスト・ファイル・入力パラメータ等の具体的な内容は一切計測に含まない。
- **計測失敗による影響の遮断 (Fire-and-Forget)** — 計測ネットワークリクエストが失敗した場合でも握りつぶし、ツールの動作を妨げない。

---

## 収集イベント一覧 (Cloudflare Analytics Engine)

改善効果を判定するため、以下の 6 つの完全匿名イベントを Cloudflare Analytics Engine 経由で収集する。加えて、非ブラウザ流入を捕捉するための `page_view` を Pages Functions middleware 経由で収集する（詳細は後述の「非ブラウザ流入の計測（page_view）」を参照）。

| イベント名 | 発火条件 | 収集プロパティ (Allowlist) | 目的 |
|---|---|---|---|
| `tool_run` | ツール実行・変換処理が走った時（発火タイミングの定義は下記） | `{ tool: string, source: ToolRunSource, dedupeKey: string }` (ツールslug, 発火起点, 重複排除キー) | ツールの利用頻度の計測 |
| `tool_engage` | 個別ツールで初めて入力・操作があった時（タブ単位で1回） | `{ tool: string }` (ツールslug) | ツールごとの実活用セッション数の計測 |
| `search_empty` | トップ検索でヒットが0件だった時 | `{ lengthBucket: string, hasJapanese: boolean, tokenCount: number, q_redacted?: boolean }` | 未対応ツール需要の把握（生検索語は非送信） |
| `related_click` | 関連ツール回遊カードのクリック時 | `{ from: string, to: string, setId?: string, position: number }` (ツールslug, セットID, リスト内位置) | ツール間回遊の導線効果の検証 |
| `shared_url_open` | 共有URL（`?settings=`）経由でツールページが開かれた時 | `{ tool: string }` (ツールslug) | 共有機能の利用状況の検証 |
| `settings_restore` | ツール設定を URL または localStorage から復元した時 | `{ tool: string, source: 'localStorage' \| 'url' }` | 設定保持・共有導線の利用状況の検証 |
| `page_view` | HTMLレスポンスを配信する全リクエスト時（`functions/_middleware.ts`、詳細後述） | なし（`path` と `traffic_type` のみをblobに格納） | 非ブラウザ流入（AIエージェント・クローラー）を含めたページ到達数の計測 |

### 特記事項・マスクルール
- **`tool_run` の発火タイミング（2種類）**: 呼び出し元の性質に応じて2つの発火方法を使い分ける（`src/lib/hooks/useToolAnalytics.ts`）。
  - **即時発火 `trackRun()`**: ボタン押下・ファイル投入・ダウンロード実行など、ユーザーの明確な1アクションにつき1回実行される呼び出し元で使う。呼び出しごとに即座に1回発火する。
  - **デバウンス発火 `trackRunDebounced()`**: テキスト入力などライブな値を `useEffect` の依存配列に含み、入力・再計算のたびに実行される呼び出し元で使う。`DEBOUNCE_MS`（500ms）以内の連続呼び出しを1回にまとめ、「入力が止まってから1回」だけ発火する。デバウンスのタイマーはフック内で一元管理し（`scheduleDebounced` / `cancelDebounced`）、各コンポーネント側で個別に `setTimeout` を書かない。アンマウント時は保留中のタイマーを解除する。
  - どちらも内部的には共通の `trackRun` 実装を呼ぶため、`tool_engage` の保険発火（未発火時に確定させる処理）も同様に働く。
- **`tool_engage` の発火タイミングと「初回」の定義**: マウント時（＝擬似ページビュー）には発火させない。ツールページ上で最初に発生したユーザー操作（`pointerdown` / `keydown`）を捕捉した時点、または最初の `trackRun()` 実行時のいずれか早い方で 1 回だけ発火する（`src/lib/hooks/useToolAnalytics.ts`）。実行は明確なエンゲージメントであるため、`trackRun()` は保険として `tool_engage` 未発火時に engage を確定させる。重複発火は React の `useRef` フラグと、`src/lib/analytics.ts` のモジュールスコープ `Set`（タブ単位・永続化なし）の二段で防止する。
- **`search_empty` のマスクルール**: 検索語の生テキストは送信せず、集計用メタ情報（文字数バケット・日本語の有無・トークン数）のみを送信する。メールアドレスやURL、電話番号などの個人情報らしき文字列が含まれる場合は `q_redacted: true` フラグのみを付与する。
- **`settings_restore` の実装箇所**: `useToolAnalytics.ts` は `trackSettingsRestore()` を公開しているが、実際の発火は `src/lib/hooks/useToolSettings.ts` が設定復元時に `track()` を直接呼び出す形で行っている（URL 復元・localStorage 復元のそれぞれで1回ずつ）。`?settings=` 付き URL を開いた場合、そのツールが `useToolSettings` を使っていれば `shared_url_open`（「共有URLで開かれた」）と `settings_restore`（`source: 'url'`、「設定が実際に復元された」）の両方が発火し得る。意味が異なる別イベントとして意図的に併存させている。
- **slug の導出**: `tool`, `from`, `to` に渡す slug は、`src/lib/tools/catalog.ts` の定義を正本として利用し、文字列の手書きによる表記揺れを防止する。

### `tool_run` の source（発火起点）と dedupeKey（重複排除キー）

`tool_run` は起点分類と重複排除が可能な集計を行うため、`tool` に加えて `source` と `dedupeKey` を送信する（`src/lib/analytics.ts` の `ToolRunSource` 型・`src/lib/hooks/useToolAnalytics.ts` の `trackRun` / `trackRunDebounced`）。

- **`source`（`ToolRunSource`）**: 呼び出し元のユーザー操作の性質を表す安定した列挙値。
  - `button`: ボタン押下等の明確な1アクション（`trackRun()` の既定値。呼び出し元で明示しない限りこれになる）
  - `drop`: ドラッグ＆ドロップによるファイル投入
  - `file-input`: `<input type="file">` 経由のファイル選択
  - `debounced-input`: `trackRunDebounced()` によるデバウンス確定発火（ライブなテキスト入力等）
  - `paste`: クリップボード貼り付け（`Ctrl+V` 等）
  - `shortcut`: キーボードショートカット起点の実行
  - `api`: WebMCP 等、UIを介さないプログラム的な呼び出し
  - `unknown`: 上記のいずれにも分類できない、または `functions/api/event.ts` 側で不正な値として棄却された場合のフォールバック
  - 実コードの既存起点に合わせた列挙であり、新しい起点が生じた場合は最小限追加してよい（`src/lib/analytics.ts` の `ToolRunSource` と `functions/api/event.ts` の `ALLOWED_TOOL_RUN_SOURCES` の両方を更新する）。
  - `trackRun(source)` は明示的に起点を渡せる呼び出し元（`Base64Converter.tsx`、`BgRemove.tsx`、`CsvEditor.tsx` 等）でのみ意味のある値を送る。それ以外の呼び出し元は既定値 `button` のまま横展開されており、必要に応じて個別に置き換えていく。
- **`dedupeKey` の生成単位**: 原則として「1ユーザー操作につき1 UUID」。`trackRun()` は呼び出しごとに `crypto.randomUUID()`（`generateDedupeKey()`）を新規発行する。`trackRunDebounced()` は `DEBOUNCE_MS`（500ms）以内の連続呼び出しを1回にまとめてから内部の `trackRun('debounced-input')` を呼ぶため、**確定発火ごとに1 UUID**が発行される（デバウンス中の各キー入力ごとには発行されない）。`sessionId`（`blob5`）と異なり `dedupeKey` はストレージに保持しない使い捨て値。
- **同一操作の二重発火対策**: ドロップ領域と `<input type="file">` が重なるUI（例: `Base64Converter.tsx`）では、同一の物理操作で2つのハンドラが発火しうる。このパターンでは直前に処理したファイルの署名（ファイル名・サイズ・`lastModified`）を短時間（300ms）だけ記憶し、同一署名の連続処理をスキップすることで二重計測を防止する。集計側でも `COUNT(DISTINCT dedupeKey)` を使うことで、対策が漏れていた場合の実行回数の過大計上を吸収できる（後述の集計クエリ参照）。
- **集計時の `COUNT(*)` と `COUNT(DISTINCT dedupeKey)` の使い分け**:
  - `COUNT(*)`: 送信されたデータポイントの総数（＝ネットワーク到達数）。二重発火や再送があれば水増しされうる。
  - `COUNT(DISTINCT dedupeKey)`: 一意なユーザー操作の数。`dedupeKey` が空文字（未送信・不正値）のデータポイントは同一キー `''` に丸め込まれてしまうため、`WHERE blob8 != ''` で除外してから使う。UI側の二重発火対策が機能している前提では両者はほぼ一致するはずで、乖離が大きい場合は対策漏れの兆候として調査する。

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

## 非ブラウザ流入の計測（page_view）

### 設計上の理由：なぜJSビーコンでは非ブラウザ流入を捕捉できないか
`src/lib/analytics.ts` の `track()` は `sendBeacon` / `fetch` で `/api/event` を叩くJSビーコンであり、**JSを実行しないクライアント（AIエージェント・クローラー等）はそもそも `/api/event` に到達しない**。そのため `tool_run` 等の既存イベントの `traffic_type`（`blob6`）分類は「ブラウザで来た相手のうち自動化ツールを見分ける」用途にとどまり、非ブラウザ流入そのものの内訳（どれだけがAIエージェント／クローラーか）を可視化する手段にはならない。この構造的な穴を埋めるため、JSの実行有無に関係なく発生する **HTTPレスポンス配信そのもの** を計測点とする `page_view` を Pages Functions middleware に追加した。

### 実装
- **記録箇所**: `functions/_middleware.ts`。既存の `?settings` 付きURLへの `X-Robots-Tag: noindex, follow` 付与処理と共存し、既存処理は変更していない。
- **対象リクエスト**: `Accept` ヘッダーに `text/html` を含むリクエストのみ。`.js` / `.css` / 画像等の静的アセット、および `/api/` 配下・`/models/` 配下は明示的に除外する（データポイントの肥大化防止、`/api/event` POSTやR2モデル配信への影響回避のため）。
- **分類ロジック**: 新規ロジックは実装せず、既存の `classifyTrafficType()`（`functions/lib/traffic-type.ts`）をそのまま再利用する。middleware には `navigator.webdriver` ヒントが存在しないため、第2引数は常に `undefined` を渡す。
- **書き込み内容**: `blobs: ['page_view', path, '', '', '', trafficType]` / `indexes: ['page_view']`。既存イベントの blob スロットの意味・順序（`blob1`=イベント名、`blob2`=パス、`blob6`=`traffic_type`）を変更していない。UA生文字列・IP・TLS指紋は保存しない。
- **配信への非影響**: 計測処理は `try/catch` で必ず例外を握りつぶし、`context.waitUntil()` が利用可能な場合はそれに載せてレスポンスを待たせない。計測が失敗・例外を投げても、ページのレスポンスはそのまま配信される。
- **判定結果はアクセス可否に一切影響しない**: bot・AIアクセスの遮断、レート制限、robots.txt での拒否は行わない（既存方針を踏襲）。

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
   ```sql
   -- 【page_view限定】非ブラウザ流入の内訳（JSを実行しないクライアントを含む）
   SELECT blob6 AS traffic_type, COUNT(*) AS count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'page_view'
   GROUP BY traffic_type
   ORDER BY count DESC
   ```
   ```sql
   -- tool_run の発火起点（source）別の内訳（blob7）
   SELECT blob7 AS source, COUNT(*) AS count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run'
   GROUP BY source
   ORDER BY count DESC
   ```
   ```sql
   -- ツール別の実行件数: 送信件数(COUNT(*))と一意な操作数(COUNT(DISTINCT dedupeKey))の比較
   -- 乖離が大きい場合はUI側の二重発火対策が漏れている可能性がある（dedupeKey = blob8）
   SELECT
     blob2 AS tool_slug,
     COUNT(*) AS raw_count,
     COUNT(DISTINCT IF(blob8 != '', blob8, NULL)) AS distinct_run_count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run'
   GROUP BY tool_slug
   ORDER BY raw_count DESC
   ```

> **blob スロット対応表**: `blob1` = イベント名、`blob2` = ツールslug（`tool` / `from`）、`blob3` = 補助1（`settings_restore` の `source: 'localStorage' | 'url'` / `related_click` の `to` / `search_empty` の `lengthBucket`）、`blob4` = 補助2（`setId` / `hasJapanese`）、`blob5` = 匿名セッションID、`blob6` = `traffic_type`（`human` / `ai_agent` / `crawler` / `unknown`）、`blob7` = `tool_run` 専用の `source`（`ToolRunSource`。他イベントでは空文字）、`blob8` = `tool_run` 専用の `dedupeKey`（他イベントでは空文字）。`index1` = イベント名（インデックスは 1 データポイント 1 つのみ）。`double1` = `related_click` の `position` のみに使用。
>
> `blob3` の `source`（`settings_restore` の復元元 `'localStorage' | 'url'`）と `blob7` の `source`（`tool_run` の発火起点 `ToolRunSource`）は名前が同じだが別イベント・別語彙の値なので混同しないこと。
