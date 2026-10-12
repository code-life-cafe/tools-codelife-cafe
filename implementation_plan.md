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
