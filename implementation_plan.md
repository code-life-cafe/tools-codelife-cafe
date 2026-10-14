# AI開発フロー整理の実装計画

正本: [Notion計画](https://app.notion.com/p/3dadfd3603368134963dfd657f36d562)（2026-09-17取得）。
基点: `origin/main` / `674d787`。開始時の未コミット変更なし。

## 現状とGap Analysis

| 対象 | 確認結果 | 最小の対応 |
| --- | --- | --- |
| AGENTS.md / CLAUDE.md | 開発・テスト規約はあるがMakerと独立Reviewerの責任、Risk Class、feedback上限が未定義 | 既存ファイルに集約 |
| GitHub Actions | lint.ymlがlint・astro check・build後unit、e2e.ymlがbuild・desktop/mobile E2E。両者PRで起動 | 変更なし |
| Deploy | main pushでE2E成功後にdeploy。lintは別Workflow | 変更なし。Merge前に両PRチェックを必須とする手動確認を残す |
| 最新mainのCI | Lint & Type Check / Deploy to Cloudflare Pages成功（35017549583 / 35017550812） | 今回PRの結果とは分けて報告 |
| main ruleset（読取のみ） | 有効なrequired checksはlint/e2e。PR必須、承認必須人数0、thread resolutionと最新push承認は必須でない | 変更なし。R2/R3人間承認の運用確認を残す。旧branch protection APIの404は保護なしを意味しない |
| Claude設定・hook | Production/Tests編集禁止なし。編集後整形・対象unitの補助hookあり | 権限・hookを変更しない |
| Claude/Codex Agent定義 | UIレビュー用各1件。独立Test Engineerやorchestratorなし | 定義を保持。通常は起動不要と共通文書に明示 |
| .agents / .claude skills | add-tool / gen-test / hard-taskの実体が重複。gen-testが実装由来の期待値を誘導 | gen-testを両入口で修正。他の共通ルールは増殖させない |
| 新規tool手順 | create-new-toolが古い手書きナビ登録。add-toolにLP層不足と未定義の/ship依存 | 既存ガイド参照に整理 |
| PR template | なし | 1枚のみ追加 |
| Routine / Auto Review | repoにトリガー実装なし。既存RoutineがCodexコメントに応答することはユーザー確認済み | 既存外部連携を前提に規則だけ定義。ライブ受入はManual Setup Checklist |

## 範囲と進め方

1. AGENTS.mdに役割・Risk Class・Code Review Rules、CLAUDE.mdにMakerと修正ループを定義。
2. docs/ai-development-flow.mdに通常フロー、Optional QA、Manual Setup Checklistを集約。
3. 既存add-tool / gen-testの両入口とcreate-new-toolの矛盾のみ修正し、PRテンプレートを追加。
4. lint・check・build・unit・E2Eを実行可能な範囲で検証し、差分を確認してDraft PRへ提出。

新規toolやProduction改修はない。今回のAGENTS等の整理はユーザーが対象を明示した依頼であり、RoutineによるR4自動変更の許可にはしない。最終承認・merge・deployは行わない。
Workflow、依存、Agent framework、独自状態管理、既存権限、外部サービス設定は変更しない。
検証結果と未解決事項はPR本文に記録する。既存walkthrough.mdは別ツールの記録のため保持する。

---

## 2026-10-06: 業務向け3ツール拡充（承認済み）

新しい計画は [第一弾の実装計画](docs/tool-expansion-plan.md) を参照。URLパラメータ解析・編集、ランダム並べ替え・グループ分け、ログ時間差分析を順次追加するR2計画。上記の過去計画は保持する。2026-10-06にユーザー承認済み。仕様に沿って実装と検証を進める。

---

## 2026-10-12: 完全ローカル動画圧縮ツール（承認待ち）

### 調査結果

- チヂメル https://shin-yu.net/nyups/chidimeru/ : FFmpeg.wasm、目標容量指定（3/20/50MB・任意値）、トリミング、長辺1920pxへの縮小、MP4（H.264/AAC）出力、進捗・サイズ比較・ダウンロード。
- OpenReplay https://openreplay.com/ja/tools/video-compressor/ : WebCodecs、品質3段階、解像度変更、推定容量、キャンセル、MP4/MOV/WebM/MKV入力、H.264/AAC再エンコード。
- 上記は公開ページの仕様説明を調査した結果であり、参考サービスの実処理・通信の独立検証は未実施。削減率や目標容量への厳密な収束は当ツールの保証に転用しない。

### 実装仕様

1. `/video-compress` に日本語UIを追加。動画1件の選択・ドラッグ＆ドロップ、入力情報・プレビューを提供。
2. 圧縮モードは品質指定（高・標準・低）と目標容量指定（3/10/20/50MB・任意値）。目標容量は推定として表示し、実測超過時には明示。縮小率は保証しない。
3. 元サイズ/長辺1920・1280・854px、縦横比維持、アップスケールなし。開始・終了秒によるトリミング、音声削除を提供。
4. 出力はMP4（H.264/AAC）。環境が対応しない場合は明確な説明を表示し、音声を黙って落とさない。MP4/MOV/WebM/MKV入力を対象とし、実際のデコード可否はブラウザー・コーデックに依存。AVIは初版の対象外。
5. 進捗・キャンセル・再実行、完了後のプレビュー、元/結果サイズ・削減率・保存を提供。結果が大きくなった場合も明示。
6. ファイル・ファイル名・メタデータはサーバー送信、解析イベント、localStorage、共有URLへ保存しない。設定のみ既存のuseToolSettingsに合わせて保持可能。

### 技術・変更範囲

- Mediabunnyを固定バージョンで追加し、WebCodecsとWeb Workerで端末内処理。依存は同一オリジンのビルド済みJSとして遅延ロード。外部CDN・アップロード・サーバーエンコード・外部コーデック取得は利用しない。
- ロジック `src/lib/tools/video-compress.ts`、UI `src/components/tools/VideoCompress.tsx`、コンテンツ `src/content/tools/video-compress.md`、ページ `src/pages/video-compress.astro`、Workerと必要な型定義を追加。
- カタログ登録、package.json/package-lock.json更新、対象unit/E2Eと小型動画fixture、検証記録を追加。
- 既存disableAnalyticsを使用。必要なページ固有CSPで通信を同一オリジン静的資産に制限し、blob動画・Workerを許可。共通のセキュリティ境界・CI・権限は変更しない。
- Risk Class: R2（新ツール・依存追加）。公開・merge・deployは本計画に含まない。

### 受け入れ・検証

- 音声あり/なしの実動画圧縮、再生可能な出力、トリミング時間、縦横動画の縮小、キャンセル後の再実行、不正/非対応入力を確認。
- unit: 設定検証、ビットレート・推定サイズ、偶数寸法・縦横比、時間範囲、サイズ比較。
- E2E: desktop/mobileの主要操作、実WebCodecs変換、出力内容、キャンセル、エラー表示。通信を監視し、ファイル由来のリクエスト・外部送信がないことを確認。静的資産ロード後にオフライン圧縮も確認。
- npm run lint、npm run test:unit、型チェック/build、対象E2Eを実行。結果・環境制約をwalkthroughへ記録。

AGENTS.md §4の事前承認要件により、計画の承認を得てからProduction実装を開始する。

### 2026-10-12: サブエージェントレビューと実装開始

ユーザーがClaudeの代わりにCodexサブエージェントを指定。独立レビュー `review_video_plan` はblocking指摘なし。注意事項を反映し、全音声トラック保持の検証、Worker内でH.264/AAC対応判定、BlobSource入力、transfer出力、入力256MiB/出力128MiBの上限、MB=1,000,000bytes、音声分と5%の付加データ余裕を含む推定計算、Object URL/Worker解放、rotation考慮を実装する。実装開始を承認済みと扱う。

### 実環境確認による音声処理の調整

Linux ChromiumのAACエンコード非対応を実確認。互換性と音質保持のため、入力AACは元のsampleRate/channelsでコピーし、非AACのみ128kbps・48kHz・最大2chへ変換する。コピーAACの全パケット統計から平均ビットレートを算出して目標容量に反映。トリミングは音声サンプル境界で内側に丸め、時刻同期を維持する。AAC非対応テストはOpus入力を使用。FAQに差を明記。旧URLの操作不能・解析有効化を避けるため、既存legacyページ生成にこのツールだけ正規URLへのredirectを追加。

### 完了記録

実装と独立レビュー修正、最終検証が完了。`docs/video-compress-walkthrough.md` に最終仕様、全1,430件unit・14件E2E成功、lint/build/astro check、オフライン実変換と通信監視、実出力の再解析、環境上の対応範囲を記録。公開・merge・deployは未実施。

### リリース前の本番ヘッダー対応

リリースの指示に基づき本番用ヘッダーを再現すると、共通default-srcがblob動画を拒否する問題を実確認。動画圧縮ページに限って `public/_headers` に共通CSPの解除を当該ページだけ追加し、既存metaの厳しいCSPを使用。Cloudflareの複数ヘッダー連結仕様を公式文書で確認。元動画・圧縮後動画の再生E2Eとページ限定解除unitを追加。共通CSPは変更しない。配信設定追加をR3として追加独立レビューと最新headのCI/正式Code・Security Reviewを実施し、成功後リリースする。

追加R3レビューで、ワイルドカード解除が共通404ページのCSPまで消す問題を指摘され、解除を実ページ2パスの完全一致へ限定。新規7unit・PC/mobile16E2Eで検証。

正式PRレビューのP2（読み込み中cancel／正の開始時刻）を3/3周回で修正。遅延Workerと開始5秒動画を追加し、全1,432unit・20E2E・lint/build/astro check/tsc成功。独立再レビューでも追加指摘なし。リリース前に最新headの必須CIと正式両レビューを再確認する。

## 動画圧縮UI改善（2026-10-12、R2）
ユーザーのモック確認後の「そこまで出来たらcommitしてPR作成」により実装承認済み。
- 品質別の推定削減率を括弧表示。解像度・音声・書き出し範囲に追従し、増加時も明示。
- 両端を操作するキーボード対応スライダーと、ローカル抽出フレームを実装。
- image-compressのFileDropzoneを再利用し、クリック・D&Dの操作領域を改善。
- 入力・フレームは保存・送信しない。既存CSP・依存は変更しない。
- unit、対象E2E（PC/モバイル）、lint、型、buildと独立サブエージェントレビュー後にcommit・Draft PR作成。


---

# WebMCP 第一段階: JSON↔CSV 実装計画（確定版）

上記は別作業の既存内容であり変更していない。以下が本作業（JSON↔CSV）のセクション。承認元: approved-webmcp-plan.md（人間承認済み、承認根拠として同梱）。Notion: 3f1dfd36-0336-814c-bf08-e79f0de50558。Risk Class R3。担当 Claude Code、独立レビューは Codex。

## スコープ

`json_to_csv` / `csv_to_json` の2操作のみ。他ツール・後続段階、既存 `json-csv.ts`・UI・依存・共通schema・Analytics・CI・Constitutionは変更しない。

## API

| 操作 | 引数（既定値） | 出力 |
| --- | --- | --- |
| json_to_csv | text（必須）, delimiter=comma/tab/semicolon（comma）, includeHeader（true）, flattenNested（false）, newline=crlf/lf（crlf） | output, rowCount |
| csv_to_json | text（必須）, delimiter=auto/comma/tab/semicolon（auto）, hasHeader（true）, inferTypes（false）, unflattenDotKeys（false） | output, rowCount |

既存 `jsonToCsv` / `csvToJson` を呼び、変換仕様（先頭ゼロ・安全整数外の文字列保持、BOM除去、引用符内改行、`__proto__` の own プロパティ化）は変えない。MCP既定はUI既定（flatten/inferTypes が true）と異なる（計画どおり）。

## 上限と実行予算

- 入力: 10万 Unicode コードポイント（schema `maxLength` とハンドラ内の二重検査）。出力: UTF-8 1MiB（ちょうどは成功、超過は省略せず拒否）。
- JSON→CSV のネスト50段: 既存パーサーの前に、文字列リテラルとエスケープを読み飛ばす走査で `[` `{` の深さを数え、51段目で拒否。
- JSON→CSV の出力予算: 行数 ×(ヘッダー和集合 − 1) が区切り文字だけで1MiBを超える入力は、CSV生成前に拒否。
- CSV→JSON の実行予算（修正ループ2/3で再設計）: `csvToJson` 呼び出し前に、papaparse（既存依存）で入力文字数に比例する文字列配列だけを解析し、出力JSONの**下限バイト数**を行ごとに積算して1MiB超を拒否する。1プロパティ／配列要素は最低8バイト＋JSONエスケープ後のキーのUTF-8バイト数（`extra_N` は7、`column_N` は実長、重複ヘッダーは既存と同じ `_N` 付与後のキー）。これによりプロパティ数だけでなく長いヘッダー×行数の反復も変換前に拒否する。行×列のオブジェクトや巨大な文字列は作らない。通常・hasHeader=false・型推論・重複ヘッダー・extra_N・展開の全モードに適用。
- 展開キー: セグメント数は50段まで。既存 `unflattenObject` と同じ処理順（整数様キー昇順→挿入順）・コンテナ種別（次セグメントが `/^d+$/` なら配列）・スカラー上書きの規則を、配列を実体化しない構造モデル（Map）で再現し、実際に配列へ入る添字（0〜2^32-2）だけを疎配列の長さとして出力下限に加算する（空要素も1要素8バイト以上）。既に確定したobject配下の数値キー（`a.x` の後の `a.1000000000.b`）、先頭セグメント（`2026.value`）、配列に実在しない添字（2^32-1以上・Infinity）は制限しない。巨大な実配列（`a.1000000000`、`a.x.0` と `a.x.1000000000` 等）は拒否。展開の中間出力は作らない（呼び出し前の見積もりのみ）。
- 想定外例外は入力を含み得るため固定文言に置換。既知エラー（既存の日本語エラー、上限メッセージ）のみ返す。失敗は factory のエラー経路（`isError: true` + `error`）。

## 独立実行・プライバシー

ハンドラは純粋関数のみを呼び、React 状態・DOM・ダウンロード・コピー・ファイル・外部取得に触れない。ログ・通信・localStorage・共有URLへの保存なし。Analytics 追加なし。登録は `JsonCsvPage` の `useEffect` で `provideToolsFromFactory`（Masking 等と同形）。

## 対象ファイル

- 新規 `src/lib/tools/json-csv.mcp.ts`、`src/lib/webmcp/registry.ts`（2行追加）、`src/components/tools/json-csv/JsonCsvPage.tsx`（登録 useEffect）
- `public/.well-known/webmcp/tools.generated.json`（`npm run webmcp:generate` の生成物）
- 新規 `tests/unit/json-csv-mcp.test.ts`、`tests/e2e/json-csv-webmcp.spec.ts`
- 本ファイルと `walkthrough.md`（本作業のセクションを末尾に追記したのみ）
- `approved-webmcp-plan.md`（承認根拠。PRに含める場合は明記する）

## AC と検証の対応

| AC | 検証 |
| --- | --- |
| 双方向変換・全option | unit: 既定値、delimiter 全enum、includeHeader、newline、flattenNested、hasHeader、inferTypes、unflattenDotKeys |
| 日本語・引用符・引用符内改行・BOM・安全整数外・先頭ゼロ | unit / E2E |
| 空・不正JSON・不正CSV・未知enum・型 | unit（schema 整合含む）/ E2E |
| 入力10万ちょうど/超過、出力1MiBちょうど/超過、深さ50/51 | unit（両方向）、E2E |
| 実行予算（巨大な行×列、疎配列）・数値キー | unit: 300列×600行を全モードで拒否し中間プロパティ生成0件、`2026.value`・`items.9.name` 受け入れ、巨大添字拒否 |
| プロトタイプ関連キー | unit（`__proto__` / `constructor`、汚染なし） |
| 実ページ登録・引数付き実行・UI一致・UI状態不変 | E2E（fixtures/base 経由、document.modelContext 差し替え、UI同設定結果と比較、前後スナップショット） |
| 通信・ログ・永続化なし | E2E（ページ内 fetch/XHR/beacon/WebSocket 記録、request/console/pageerror 監視、storage/cookie/IndexedDB/Cache/URL 前後比較） |
| lint / build / unit / E2E / 型 | walkthrough.md に実測を記録 |

## 範囲外・未確認

実 WebMCP クライアントでの受入、本番 Deploy、mainマージ、最新 head の必須CI、Codex 再レビューは別途確認する。

## テキスト差分 WebMCP実装（2026-10-15）

ユーザー承認済み計画はapproved-text-diff-plan.md。対象はNotion cdcd2236-5b3f-45f6-b022-1d407a9ce93eのtext-diff分割のみ。Codex実装・agy独立レビューへの変更も承認済み。Risk R3、Merge/Deploy対象外。API/予算/ファイル範囲は計画を参照。既存記録は保持する。

## 2026-10-15 追加承認: PWA生成対象の最小修正

ユーザーが一括キャッシュ確認・復元・最新main/CI/再レビュー後のMerge/Deployを承認。受入で既存の /tools/ 404を確認し、SW対象修正も「最小修正を追加して進める」と明示承認した。R3を維持。scripts/generate-sw.mjsで既存除外条件を維持し、index.htmlが実ファイルとして存在する直下ディレクトリだけをページ一覧に含める。tests/unit/generate-sw.test.tsで実スクリプトを一時fixtureに対して実行し、空の親ディレクトリ、index.htmlというディレクトリ、既存除外、正常ページとトップを検証する。SW通信戦略・権限・CI・R2配信は変更しない。修正前失敗→修正後成功、build/PWA再確認、agy+正式レビュー、最新CIを経て同PRをMergeする。
