# 計測基盤 (Analytics)

## 方針

CODE:LIFE Tools はクライアントサイド完結のツール集であり、ユーザーの入力データ・ファイル内容・PII（個人情報）をサーバーへ送信しない。計測についても同様の思想を厳格に適用する。

- **Cookie・ストレージによる個人の追跡を行わない** — Cookie や localStorage によるユーザー追跡・プロファイリングは一切行わない。
- **個人を識別・追跡しない** — ページビュー・リファラー等の集計データおよび匿名の集計イベントのみ収集。
- **入力・変換データを送信しない** — 各ツールで扱うテキスト・ファイル・入力パラメータ等の具体的な内容は一切計測に含まない。
- **計測失敗による影響の遮断 (Fire-and-Forget)** — 計測ネットワークリクエストが失敗した場合でも握りつぶし、ツールの動作を妨げない。

---

## 収集イベント一覧 (Cloudflare Analytics Engine)

改善効果を判定するため、以下の 7 つの完全匿名イベントを Cloudflare Analytics Engine 経由で収集する。加えて、非ブラウザ流入を捕捉するための `page_view` を Pages Functions middleware 経由で収集する（詳細は後述の「非ブラウザ流入の計測（page_view）」を参照）。

| イベント名 | 発火条件 | 収集プロパティ (Allowlist) | 目的 |
|---|---|---|---|
| `tool_run` | 既存の呼び出し箇所で実行試行・再計算が計測された時（成功を保証しない） | `{ tool: string, source: ToolRunSource, dedupeKey: string }` (ツールslug, 発火起点, 重複排除キー) | 既存計測箇所の実行試行・再計算の頻度 |
| `tool_engage` | ツールページ全体の初回pointerdown/keydown、または初回run（タブ内のslugごとに1回） | `{ tool: string }` (ツールslug) | ツールページで操作を観測したタブ数（ツール実活用の保証はない） |
| `search_empty` | トップ検索でヒットが0件だった時 | `{ lengthBucket: string, hasJapanese: boolean, tokenCount: number, q_redacted?: boolean }` | 未対応ツール需要の把握（生検索語は非送信） |
| `related_click` | 関連ツール回遊カードのクリック時 | `{ from: string, to: string, setId?: string, position: number }` (ツールslug, セットID, リスト内位置) | ツール間回遊の導線効果の検証 |
| `top_block_click` | トップページの目的別ブロック内のツールリンククリック時 | `{ block: string, tool: string, position: number }` (ブロックの安定ID, ツールslug, ブロック内の位置) | 目的別ブロックのリンク選択件数（ツール到達・実行の保証はない） |
| `shared_url_open` | 共有URL（`?settings=`）経由でツールページが開かれた時 | `{ tool: string }` (ツールslug) | 共有機能の利用状況の検証 |
| `settings_restore` | ツール設定を URL または localStorage から復元した時 | `{ tool: string, source: 'localStorage' \| 'url' }` | 設定保持・共有導線の利用状況の検証 |
| `page_view` | 解析停止ページ等を除くHTMLレスポンス配信時（`functions/_middleware.ts`、詳細後述） | なし（`path` と `traffic_type` のみをblobに格納） | 非ブラウザ流入を含めたHTML配信件数（利用者数・成功数ではない） |

### 特記事項・マスクルール
- **`tool_run` の発火タイミング（2種類）**: 呼び出し元の性質に応じて2つの発火方法を使い分ける（`src/lib/hooks/useToolAnalytics.ts`）。
  - `JSON整形/圧縮` は処理成功前に発火するため、不正JSONの試行も含む。他のツールには成功結果に条件を付ける既存呼び出しもある。イベント名・blob・sourceの意味を変更せず、横断集計は「既存計測の実行試行・再計算」と呼ぶ。成功回数・成功率として解釈しない。
  - `color`、`cron-checker`、`dummy-data`、`wareki-converter`、`regex-tester`、`mermaid` は初期サンプル・設定復元だけではrunを送らない。既存操作エリア内のpointerdown/keydown/input後に再計算した時だけ、既存の500msデバウンス計測を許可する。初期表示・生成・設定復元の機能は維持する。他ツールの発火条件には横展開しない。
  - **即時発火 `trackRun()`**: ボタン押下・ファイル投入・ダウンロード実行など、ユーザーの明確な1アクションにつき1回実行される呼び出し元で使う。呼び出しごとに即座に1回発火する。
  - **デバウンス発火 `trackRunDebounced()`**: テキスト入力などライブな値を `useEffect` の依存配列に含み、入力・再計算のたびに実行される呼び出し元で使う。`DEBOUNCE_MS`（500ms）以内の連続呼び出しを1回にまとめ、「入力が止まってから1回」だけ発火する。デバウンスのタイマーはフック内で一元管理し（`scheduleDebounced` / `cancelDebounced`）、各コンポーネント側で個別に `setTimeout` を書かない。アンマウント時は保留中のタイマーを解除する。
  - どちらも内部的には共通の `trackRun` 実装を呼ぶため、`tool_engage` の保険発火（未発火時に確定させる処理）も同様に働く。
- **`tool_engage` の発火タイミングと「初回」の定義**: document全体の最初の`pointerdown` / `keydown`、または最初の`trackRun()`で発火する。ヘッダー検索・説明文・フッターへの操作も含み、ツール入力エリアへの操作を保証しない。この既存範囲は変更しない。ReactのrefとモジュールスコープSetによりタブ内のslugごとに重複を防ぐ。マウントそのものでは送らないが、修正前の初期自動runからengageが発火するケースは過去データに含まれる。
- **`search_empty` のマスクルール**: 検索語の生テキストは送信せず、集計用メタ情報（文字数バケット・日本語の有無・トークン数）のみを送信する。メールアドレスやURL、電話番号などの個人情報らしき文字列が含まれる場合は `q_redacted: true` フラグのみを付与する。
- **`settings_restore` の実装箇所**: `useToolAnalytics.ts` は `trackSettingsRestore()` を公開しているが、実際の発火は `src/lib/hooks/useToolSettings.ts` が設定復元時に `track()` を直接呼び出す形で行っている（URL 復元・localStorage 復元のそれぞれで1回ずつ）。`?settings=` 付き URL を開いた場合、そのツールが `useToolSettings` を使っていれば `shared_url_open`（「共有URLで開かれた」）と `settings_restore`（`source: 'url'`、「設定が実際に復元された」）の両方が発火し得る。意味が異なる別イベントとして意図的に併存させている。
- **slug の導出**: `tool`, `from`, `to` に渡す slug は、`src/lib/tools/catalog.ts` の定義を正本として利用し、文字列の手書きによる表記揺れを防止する。
- **`top_block_click` の `block` ID**: トップページ「目的から探す」の各ブロック（`src/lib/tools/catalog.ts` の `purposeCategories`）に付与した安定ID（`PurposeCategory.id`、例: `data-format` / `image-processing` / `japanese-input` / `pdf`）を送信する。表示タイトル（`title`）はUI文言変更で揺れるため計測には使わず、`id` を正本として時系列比較の一貫性を保つ。実装は `src/components/tool/RelatedTools.astro` の `data-track-*` 属性 + イベント委譲 + `track()` 呼び出しパターンを `src/pages/index.astro` に流用している。

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
- **同一操作の二重発火対策**: ドロップ領域とfile inputが重なるUI（例: `Base64Converter.tsx`）では、直前のファイル署名を300ms記憶する既存対策がある。`dedupeKey`はtrackRun呼び出しごとに新しくなるため、同じ物理操作から別々に呼ばれた二重発火は`COUNT(DISTINCT dedupeKey)`でも除去できない。同じキーを持つ再送だけを重複排除できる。
- **集計時の `COUNT(*)` と `COUNT(DISTINCT dedupeKey)` の使い分け**:
  - `COUNT(*)`: 送信されたデータポイントの総数（＝ネットワーク到達数）。二重発火や再送があれば水増しされうる。
  - `COUNT(DISTINCT dedupeKey)`: 一意な計測呼び出しキーの数。ユーザー操作数や成功数を保証しない。空キーは除外する。raw件数との差は同一キーの再送等を調べる参考となるが、別キーで発火するUI二重呼び出しは検出できない。

### 匿名セッションID（プライバシー方針との整合性）
既存のクライアントカスタムイベントにはタブ限りのランダムsessionIdを付与する。サーバー`page_view`のblob5は空であり、全イベントにsessionIdがあるわけではない。ページ到達とrunを同じセッションに結合したり、page_viewを分母に厳密な利用率・トップからの遷移率を求めることはできない。識別子やイベントは追加しない。本IDの既存仕様は次のとおり。

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
- **対象リクエスト**: 実際に配信したレスポンスの`Content-Type`が`text/html`の時に記録する。`Accept`が`*/*`・省略でも対象であり、JS実行の有無は区別しない。非HTMLアセット、`/api/`・`/models/`配下を除外する。解析停止を約束する`transcribe`・`video-compress`は正規URL・旧`/tools/`URL・末尾slash有無・エンコードされたパスを含めて除外する。同じ停止slug一覧をToolLayoutにも適用し、旧ページでもクライアントのキルスイッチとRUM除外を維持する。
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
   -- ツール別の既存計測件数 (tool_run)。成功回数ではない。
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
   -- トップ目的別ブロック：ブロック別クリック数・位置別平均（トップ→ツール遷移導線の効果検証）
   SELECT blob3 AS block_id, COUNT(*) AS click_count, AVG(double1) AS avg_position
   FROM tools_codelife_cafe_events
   WHERE index1 = 'top_block_click'
   GROUP BY block_id
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
   -- カスタムイベントを観測したタブのうちrunも観測した割合。
   -- トップ到達・遷移順序を確認していないためトップ→ツール遷移率ではない。
   SELECT
     COUNT(DISTINCT IF(index1 = 'tool_run', blob5, NULL)) * 1.0
       / COUNT(DISTINCT blob5) AS observed_event_sessions_with_run_share
   FROM tools_codelife_cafe_events
   WHERE blob5 != ''
   ```
   ```sql
   -- 【human セグメント限定】ツール別の既存run計測件数（成功数ではない）
   SELECT blob2 AS tool_slug, COUNT(*) AS count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run' AND blob6 = 'human'
   GROUP BY tool_slug
   ORDER BY count DESC
   ```
   ```sql
   -- 【ai_agent セグメント限定】JSクライアントrun件数（全AI利用・成功数ではない）
   SELECT blob2 AS tool_slug, COUNT(*) AS ai_run_event_count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run' AND blob6 = 'ai_agent'
   GROUP BY tool_slug
   ORDER BY ai_run_event_count DESC
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
   -- 送信件数と一意な計測キー数の比較。成功数・物理操作数ではない。
   -- 別キーを持つUI二重呼び出しはこの比較で除去・検出できない（dedupeKey = blob8）。
   SELECT
     blob2 AS tool_slug,
     COUNT(*) AS raw_count,
     COUNT(DISTINCT IF(blob8 != '', blob8, NULL)) AS distinct_run_count
   FROM tools_codelife_cafe_events
   WHERE index1 = 'tool_run'
   GROUP BY tool_slug
   ORDER BY raw_count DESC
   ```

> **blob スロット対応表**: `blob1` = イベント名、`blob2` = ツールslug（`tool` / `from`）、`blob3` = 補助1（`settings_restore` の `source: 'localStorage' | 'url'` / `related_click` の `to` / `search_empty` の `lengthBucket` / `top_block_click` の `block`）、`blob4` = 補助2（`setId` / `hasJapanese`）、`blob5` = 匿名セッションID、`blob6` = `traffic_type`（`human` / `ai_agent` / `crawler` / `unknown`）、`blob7` = `tool_run` 専用の `source`（`ToolRunSource`。他イベントでは空文字）、`blob8` = `tool_run` 専用の `dedupeKey`（他イベントでは空文字）。`index1` = イベント名（インデックスは 1 データポイント 1 つのみ）。`double1` = `related_click` / `top_block_click` の `position` に使用。
>
> `blob3` の `source`（`settings_restore` の復元元 `'localStorage' | 'url'`）と `blob7` の `source`（`tool_run` の発火起点 `ToolRunSource`）は名前が同じだが別イベント・別語彙の値なので混同しないこと。

## P1修正の前後比較

2026-10-12作成のP1修正は収集を縮小する変更。実際のデプロイ時刻・対象SHAを運用記録に残し、前後の同じ期間・tool・source・traffic_typeを比較する。初期run除外の対象は上記6ツールで、旧データから初期表示とユーザー再計算を正確に分離する材料はない。件数の減少を利用減少と断定せず、この変更点を系列に注記する。JSONの不正入力試行を含む既存runの意味は前後で維持する。page_viewから解析停止2ツールを除くため、全体比較は前後ともそれらの正規・旧パスを除いた同じ対象で行う。

event名、Allowlist、blobの配置、既存sessionId・dedupeKey・sourceは変更しない。document全体のengage定義も維持する。成功率の計測やトップ到達のセッション結合には別の設計判断が必要であり、successイベント・新規ID・未計測ツールへの導入はこの変更では実装しない。
