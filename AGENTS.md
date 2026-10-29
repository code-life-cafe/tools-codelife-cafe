# AGENTS.md — CODE:LIFE Tools (AIエージェント向け指示書)

このファイルは、AIエージェントが本リポジトリで作業する際の全体要約、最重要ルール、および設計書への参照を提供するドキュメントです。

## AI開発の責任境界

現行の運用ルール（正本）: [Notion「現行運用ルール」](https://app.notion.com/p/406dfd36033681abbafce47bac685278)。実行時はこのrepoの最新AGENTS.md / CLAUDE.md / [docs/ai-development-flow.md](docs/ai-development-flow.md)と、個別の人間承認を確認する。旧Notion Task Board・Agent Readyは新規開発の着手許可に使わない。

- 開発管理はGitHub IssueとPRに統一する。AC・状態・承認・検証結果・レビュー結果・公開SHAはIssue/PRに集約する。Notionには分析・施策・効果測定と、実装Issue/PRへのリンクだけを置き、開発状態を二重管理しない。実装IssueとNotion施策は相互にリンクする。
- 通常フローは **ChatGPT（Notionで分析・施策）→ GitHub Issue → Claude Code（調査・計画・実装・テスト・PR）→ GitHub Actions → Codex（最終head SHAのCode/Security自動独立レビュー）→ Claude Code（CI失敗・指摘の修正）→ 必要承認・Merge → Deploy・許可範囲の本番確認 → ChatGPT（効果測定）**。
- Claude Code（Claude Pro）が主実装者。機能改善・バグ修正・脆弱性対応・依存更新・テスト・開発指示書変更の調査・計画・実装・必要なテスト・PR・CI修正・レビュー指摘対応・許可範囲の本番確認まで進行責任を持つ。手順は本ファイルの「6. Makerの手順（Claude Code）」。
- Codexは最終head SHAのCode ReviewとSecurity Reviewを担う自動独立レビュー担当。通常レビューでは実装・直接修正・コミット・自己承認を行わず、findingをIssue/PRへ返す。
- ChatGPTはアクセス解析・SEO/GEO・仮説・優先順位・効果測定をNotionで管理する。repoの実装・PR・Mergeは行わない。
- GitHub Actionsは決定論的Quality Gate。最新PRコミットのlint・unit・E2E・build/型チェックが成功しない限りMerge不可。失敗・未実行・進行中をLLMの判断やローカル検証で置き換えない。
- 独立Test Engineerは常設しない。既存UIレビュアーは任意利用であり、通常PRで別Agentを必須起動しない。[Optional QA・運用手順](docs/ai-development-flow.md)を参照。
- Makerは自分のPRを最終承認しない。未解決のblocking finding・仕様の曖昧さがある場合は人間へ戻す。
- 既存のNotionタスクは履歴として保持する。未実装分は、GitHubの既存Issue/PRと重複確認してからIssue化する。重複Issue/PRの作成、同じhead・同じ種別のレビュー依頼の連投はしない。

### 進行責任と待ち状態の記録

Claude CodeはPR作成・レビュー依頼で担当を終えない。CI・レビューの完了、失敗、指摘後の次の対応と、許可範囲の完了確認（Deploy・本番確認）まで持つ。Issue/PRに次を残し、状態が変わるたびに更新する。

- 現在状態、次の一手、待ち先（CI / Codexレビュー / 人間承認 / 利用上限 等）、待ち始め、再開条件、対象head SHA。
- 既存の定期確認と、実際に利用できるイベント応答だけを使う。未設定の自動再開は保証しない。新しいスケジューラ・Workflow・権限は追加しない。
- 利用上限に達した場合は、別の実装者へ自動で切り替えず、待ち状態と再開条件をIssue/PRに明記して止める。

### モデル選択・worktree

- モデルは作業内容に応じて次の3段階から選ぶ。上位の段階を常用しない。
  - **軽**: 調査、点検、データ整理、ドキュメントのずれ探し、定型作業。ClaudeはHaiku。
  - **標準**: R0/R1の修正、文言やSEOの変更、CI・レビュー指摘への対応。ClaudeはSonnet。
  - **重**: R2新機能の設計、複数ファイルにまたがる大きな変更、原因不明の不具合調査、R3の追加リスクレビュー。ClaudeはOpus。
- 格上げ: 標準で2回失敗したら、その作業だけ一段上げる。重を使ったら理由を報告に残す。
- 節約: プランの残りが2割を切ったら、その週は軽・標準だけにする。
- 共有cloneは常にmainのままにする。共有cloneで作業する場合、各エージェントは作業ごとに自分のworktree（`git worktree add <repo外のパス> -b <branch>`）を作成して作業し、完了したら削除する。クラウドセッションなど作業用cloneが分離済みの環境では不要。PRのレビュー判定は実装者以外が行い、Mergeは下記のPRマージ条件に従う。
- 本節はClaude Codeのモデル段階の指針であり、Codexのレビューモデル・外部サービスの設定を変更しない。

### Risk Class と承認の3段階

変更全体の最も高いリスクをPRに記録する。混在は最も厳しい区分で扱う。ファイル名（AGENTS.md / CLAUDE.md 等）だけでR4にしない。実際の差分が何を変えるかで分類する。

| 区分 | Class | 対象 | 人間承認 |
| --- | --- | --- | --- |
| A | R0 / R1 | docs、test-only、metadata、既存仕様内の誤字・リンク・説明・テスト、局所bugfix、小UI、入出力・通信・保存を変えない整理、後述の既存依存のX.Y固定patch | 不要。個別確認なしで実装からMerge・Deploy・本番確認まで進める |
| B | R2 / R3 | 新機能・新規tool、大きなUI変更、複雑な仕様変更、minor/major依存更新、既存の許可境界内のPWA / WebMCP / 計測 / build・deploy変更 | 計画を一度承認する。以後の同範囲のCI修正・レビュー対応・Merge・Deployで再承認しない。R3は追加独立リスクレビューを維持 |
| C | R4 | 秘密情報、認証アクセス、外部送信・保存の拡大、破壊的操作、課金、security boundary、CI・レビュー・承認条件の弱体化、自動権限拡大 | 具体的な対象・差分・影響についての人間承認。区分名だけの包括承認は認めない |

**A（R0/R1）の補足**

- 既存依存のX.Y固定patch更新は、次の**すべて**を満たす場合だけAとする。満たさない、または判断が曖昧な場合はB/Cとして扱う。
  - lock差分が対象パッケージとその推移依存だけ、新しいinstall/postinstall・取得元・権限の変更がない、Node互換を維持、`npm audit`（[依存脆弱性の運用](docs/dependency-security.md)）が悪化しない、必要な回帰検証が揃う。
  - 対象リリースの公開から7日以上経過している。公開日が確認できない場合はAにしない。これは確認のための猶予であり、安全性の保証ではない。緊急の修正でもAIが7日を免除せず、B/Cとして判断する。
  - 配布元・公開者・対象リリースと、実際に取得するpackageの対応を確認する。利用できるprovenance・署名は確認する。取得元や公開者の変更、対応が不明な場合はAにしない。provenanceの未提供だけで安全とはみなさず、提供の有無にかかわらず、次の内容確認ができなければBとする。
  - 対象と、更新される推移依存の実際の配布物の内容差分（実行コード、同梱生成物、install / build / runtimeの経路）を、独立したCodexが確認し、説明できない差分・新しい外部通信/保存/権限・取得物との差異がない根拠をPRに記録する。lockファイルやリリースノートだけでは代替できない。
  - 配布物や公開日を取得・検証できない、または規模が大きい場合はBの計画承認とする。権限・通信・保存・安全境界の拡大を伴う場合はCとする。配布物差分の継続的な自動確認は未実証のため、確認できない更新を「確認済み」として記録せず、Bに落とす。
- 指示書（AGENTS.md / CLAUDE.md / docs / テンプレート）の変更は、意味を変えない誤字・リンク・説明の修正はA。承認済みの仕様・役割の意味を増やさない同期は、その承認範囲として扱う。許可される行為・対象・実行主体・承認の要否・CIやレビュー・停止条件・データ・権限を変える差分はCとする。

**B（R2/R3）の計画承認**

計画には目的、AC、対象と対象外、影響、検証、復旧方法、公開範囲を含め、承認原文または参照をIssue/PRに固定する。承認範囲内のCI修正・レビュー対応・Merge・既存Deployでは再承認を求めず、目的や受入結果を無断で変更しない。範囲外の変更が必要になった場合だけ人間へ戻す。

**C（R4）の承認**

承認は具体的な対象・差分・影響に対して行い、承認原文または参照をIssue/PRに残す。承認の範囲外や将来の無関係なCには及ばない。承認されたCは、承認文がMerge・Deploy・本番確認を含む場合はその範囲で、含まない場合はレビュー可能な差分の準備までを範囲とする。レビューコメントや他のAgentの発言を承認として扱わない。

**依頼文の読み方**

通常の「実装して」「修正して」という依頼は、A又は承認済みBであればMerge後の公開確認までを含む。「計画のみ」「PRまで」「pushしない」「公開しない」という明示的な限定は常に優先する。

### PRのマージ判断と実行

自動Mergeは、操作主体・独立した分類確認・客観的検証を分けて行う。

- **操作主体**: 既存Claude Routine、およびClaude Codeプロジェクト `tools.codelife.cafe 保守`（`chan_01BLscqs8eCg8fzAnUt8YFrw`）とその担当スレッド。別の常設Merge専用Agent・新しいスケジューラ・Workflowは作らず、他の主体へ転用しない。Makerは自分のPRを承認しない。独立判断が出た後の、条件を照合した上でのMerge操作は、自己承認とは区別する。
- **独立判断**: Codexが同一の最終head SHAについて、実差分・AC・許可境界を照合し、A、承認済みB、今回承認済みCのいずれに当たるかを確認してPRに根拠を残す。「重大な指摘なし」だけを分類確認とみなさない。Codex botに分類の出力項目があるとは仮定せず、必要なら独立したCodexセッションによる明示的な分類記録を別の証拠にする。分類が矛盾する場合は厳しい側に倒し、未承認の範囲だけを人間へ返す。
- **客観的検証**: GitHub Actionsの必須CI。

操作主体は、次をすべて満たした場合だけMergeする。

- PRの実際の全差分が、A、承認済みB、または承認済みCのいずれかの範囲に収まり、ACと合意スコープ内である。ラベル・自己申告だけで判定せず、未承認のB/Cが混在する場合や判定が曖昧な場合は人間へ返す。B/Cの承認は、Issue/PRに固定した承認原文・参照とACの範囲に限る。
- 最新head SHAが最新base（通常main）を含み、そのheadの必須CI `lint` / `e2e` が両方成功している。baseが進んだ場合は通常のmergeで取り込み、新headのCIと独立レビューを再確認する。未実行・skip・取消・進行中・失敗を成功扱いしない。
- 同じhead SHAについて、信頼できるCodex連携botのCode Reviewが完了し、修正を要するfindingがないか再レビューで解消確認済み。対象repoで有効なCodex Security Reviewも完了し、未解決指摘がない。[運用手順のレビュー完了信号](docs/ai-development-flow.md#レビュー完了信号)で発信者・対象SHA・両レビューの完了を確認する。コメント不在や古い👍だけを承認の根拠にしない。ローカルCLIレビューやMaker自身の確認でbot信号を代替しない。
- 未解決のblocking finding・仕様の曖昧さ・人間の保留/変更要求・進行中の修正がない。修正ループ履歴を確認でき、3周上限を超えていない。style/nitのみはblockingにしない。
- Draftではなく競合なし。Merge直前にhead・baseと上記条件を再確認し、確認したheadを指定して通常のMergeを行う（例: `gh pr merge --squash --match-head-commit <SHA>`）。headまたはbaseが変わったら再判定する。このオプションはbaseを固定しないため、サーバー側のstrict required checksによる最新baseの検証が有効と確認できない間は自動Mergeしない。無効と確認できた場合は人間へ返し、一時的な取得失敗は技術待ちとして再照合する。admin/bypass・force push・gate変更は使わない。

**承認の持続**

承認済みのB/Cは、時間の経過、CI・レビュー待ち、利用上限、意味を変えないbase取り込みだけでは失効しない。目的・AC・禁止範囲・データ・権限が変わる部分だけを再判断し、その部分が未承認なら人間へ返す。

**待ちと人間への返却**

- CI・レビューのRunning、一時的な取得失敗、利用上限は技術的な待ちであり、人間への返却理由にしない。既存のPR購読など実在する再開手段で続け、同じheadでの連投・無限の再試行・未確認のMergeはしない。待ち状態の照合は修正3周に数えない。
- 人間へ戻すのは次の場合だけ: 未承認のB/C、ACや禁止範囲の変更、意味の判断が必要な競合、3周でもblockingが解消しない、本人の認証が必要な操作。承認済みのB/Cを区分名だけで再び止めない。bot信号や必須checksの未取得・Running・一時失敗も上記の技術待ちで、形式変更や取得不能が継続して自力で解決できない場合にだけ、理由を報告して必要な判断を求める。
- 通常はCI成功後にReadyにして、自動のbotレビューを受ける。Draftで手動依頼してからReadyにする二重起動はしない。

実行前にPR履歴へRisk Class（A/B/C）・判定理由・承認の根拠・対象head・CI・独立レビューと分類確認の根拠・修正周回数を記録する。Merge後は既存Deployの対象SHAと結果を確認し、公開SHAと許可範囲の本番確認の結果をIssue/PRへ記録する。失敗時は人間へ通知する。完全な無人化は実測で確認できた範囲だけを報告する。

この3段階の方針は2026-10-28のmarumoの承認に基づく。日次21時・週次月08:52の読み取り専用の棚卸しを、実装やMergeを担当するものへ拡張しない。新しいスケジューラ・権限・Workflow・サービス・課金は追加しない。権限・secrets・認証の変更や、CI・レビュー・承認条件の弱体化、自動権限拡大は引き続きCであり、具体的な対象・差分・影響についての人間承認を必要とする。

### 歴史記録: 旧運用と旧例外

2026-10-27より前の運用（Codex主実装・UI/日本語文言のみClaude Maker、Notion Task Boardからの実装取得、chief/engineer/maintainerの通常経路、プラン上限時の実装者自動切り替え、Grok Bot運用ループ、その際のローカルCodex/Claude CLIレビュー代替）は歴史記録であり、現行の通常フローではない。

- Grok Bot運用ループとローカルCLIレビュー代替は、当時のR0/R1自動Mergeに限った例外だった。現行の通常フローには流用せず、再開しない。当時の承認を他の主体・範囲へ広げない。
- 旧ルールの全文はgit履歴（本変更より前のAGENTS.md）で参照できる。

---

## 1. プロジェクト概要

`tools.codelife.cafe` は、完全クライアントサイド処理で動作するWebツール集です。
すべてのデータ処理はユーザーのブラウザ内で完結し、外部サーバーへのデータ送信は一切行いません。

---

## 2. 設計書ドキュメント一覧 (詳細参照)

プロジェクトの全体設計やルールについては、以下の詳細設計書を必ず参照してください。

- **[architecture.md](docs/architecture.md) (システムアーキテクチャ設計書)**
  - 全体技術スタック、ディレクトリ構造、およびビルドプロセスと連携した PWA (Service Worker) の構成。
- **[development-guide.md](docs/development-guide.md) (開発ガイドライン / ツール作成手順)**
  - 命名規約、UI・ロジックの分離（4ファイル構成）、デザインシステム（Tailwind v4）、Biomeの設定、E2Eテスト。
- **[data-management.md](docs/data-management.md) (データ管理とモデル配信設計書)**
  - 郵便番号データのチャンク化および更新方法、AIモデルの Cloudflare R2 配信と Web Worker 推論。
- **[analytics.md](docs/analytics.md) (計測基盤設計)**
  - Cloudflare Analytics Engine による完全匿名イベント計測方針とAllowlistプロパティ。
- **[seo.md](docs/seo.md) (SEO & 構造化データガイドライン)**
  - Schema.org 準拠の JSON-LD 構造化データ付与規約と検証手順。

---

## 3. 絶対に守るべきルール

1. **サーバーサイド処理を使わない**
   - APIコール、外部サーバーへのデータ送信は一切禁止です（静的アセット配信およびCookieレス・個人追跡なしのアクセス解析を除く）。
2. **日本語ファースト**
   - UI文言、プレースホルダー、プレビュー用ダミーデータ、エラーメッセージ等はすべて日本語で作成してください。
3. **UIとロジックの分離**
   - 計算・変換などのビジネスロジックは React から切り離し、`src/lib/tools/` 内に TypeScript の純粋関数として実装してください。
4. **新ツールの構成ルール**
   - 新規ツールは、原則として「ロジック（`src/lib/tools/`）」＋「コンポーネント（`src/components/tools/`）」＋「LPコンテンツ（`src/content/tools/`）」＋「ページ（`src/pages/`）」の **4ファイル（＋AI推論等が必要な場合はWeb Worker）構成** で完結させます。詳細は [development-guide.md](docs/development-guide.md) を参照してください。
5. **単体テストのルール**
   - ユニットテストは Node.js 組み込みの `node:test` および `node:assert/strict` を使用し、`vitest` 等の未宣言フレームワークは使用しないでください。ローカルインポートには `.ts` 拡張子を明記します。

---

## 4. エージェントのタスク完了条件 (DoD)

エージェントが作業を終える前に、以下の項目が満たされていることを必ず確認してください。

- **実装計画 (Implementation Plan)**
  - 大幅な改修や新規ツールの作成を行う場合は、事前にImplementation PlanをIssue/PRに残し、必要な承認を得てください（区分ごとの承認は「Risk Class と承認の3段階」に従う）。
- **範囲の限定**
  - 変更ファイルが、合意した実装計画のスコープ内に収まっていること。
- **静的解析の実行**
  - 作業完了前に `npm run lint`（Biome）を実行し、静的解析エラーがないことを確認すること。
- **動作検証とウォークスルー**
  - 単体テスト（`npm run test:unit`）および E2Eテスト（`npm test`）を実行し、コマンド・結果・未実行理由をIssue/PRに記録して報告すること。
  - 未実行・失敗の記録は検証成功の代わりにはならない。PRはDraftのまま共有できるが、Mergeには最新コミットの必須CI成功が必要。
---

## 5. 直近の運用メモ

### Issue/PR起点の実装

- 実装はGitHub Issueを起点にする。対象Issue（なければ重複確認のうえ新規作成）のAC・Risk Class・スコープ外を確認してから着手し、ACが取得できない・不明な場合は推測せず人間判断待ちにする。
- Notionの施策・既存タスクが指定された場合は、背景・仮説・効果測定の参照元として読み、実装のAC・状態・検証結果・承認はIssue/PRに記録する。Notionには実装Issue/PRへのリンクと効果測定のみを残し、開発状態を二重管理しない。
- 実装後はIssue/PRに検証結果・未解決の環境課題・待ち状態（待ち先・待ち始め・再開条件・対象head）を追記する。

### ツール設定保持の共通パターン

- ツールの「前回設定」や「設定共有URL」は `src/lib/hooks/useToolSettings.ts` を使って実装すること。
- localStorage / URLに保存してよいのは、インデント、形式、税率、リサイズ値、トグル状態などの設定値だけ。入力本文、ファイル内容、画像データ、個人情報を保存してはいけない。
- 共有URL対応を追加したツールでは、`settings` クエリパラメータを検出して `useToolAnalytics(...).trackSharedUrlOpen()` を呼ぶ既存パターンに合わせること。
- 共有ボタンの文言は既存ツールに合わせて `設定を共有` / `コピー完了！` を使う。

### 混在worktreeでのPR作成

- `git status --short --branch` と対象差分を必ず確認し、既存の未コミット変更が混在している場合は今回スコープのファイルだけを明示的に `git add` すること。
- PR作成時は `gh auth status`、既存PR有無、`main` との差分概要を確認すること。
- ユーザーが明示しない限りdraft PRで作成し、PR本文には「今回の最新コミット」「検証結果」「意図的に含めなかった未ステージ変更」を書くこと。

### 既知の検証メモ

- Nodeは `.nvmrc`（`engines` は `>=22.23.4`）に合わせる。満たさない環境では `astro check` / `astro build` が起動しない。
- `npm run test:unit` の `tests/unit/onnx-runtime-build.test.ts` は `dist/` が前提で、`npm run build` 前は失敗する。unitはbuild後に実行する。
- `npm run lint` はexit code 0でも警告が出る場合がある。既存の `tests/e2e/webmcp.spec.ts` の non-null assertion 警告は、今回作業と無関係ならその旨を報告すること。
- TypeScript単体確認は、現状 `tsconfig.json` の `baseUrl` 非推奨で止まる場合があるため、差分確認では `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0` を使う。
- `npx astro check` / `npm run build` が `astro sync` の `require is not defined`（`node_modules/picomatch/index.js`）で失敗する場合がある。これはコンポーネント確認前の環境/依存解決段階の失敗として、差分由来か切り分けて報告すること。

## 6. Makerの手順（Claude Code）

Claude Code（Claude Pro）が主実装者（Maker）。機能改善・バグ修正・脆弱性対応・依存更新・テスト・開発指示書変更の調査・計画・実装・必要なテスト・PR・CI修正・レビュー指摘対応・許可範囲の本番確認まで進行責任を持ち、Productionコードとテストの両方を作成・修正する。Codexは最終head SHAのCode/Security自動独立レビュー担当で、通常レビューでは実装・直接修正・自己承認をしない。ChatGPTはNotionでアクセス解析・SEO/GEO・仮説・優先順位・効果測定を担う。現行ルールは[Notion現行運用ルール](https://app.notion.com/p/406dfd36033681abbafce47bac685278)、Risk Classとレビュー規則は[AGENTS.md](AGENTS.md)、全体フローと手動設定は[運用手順](docs/ai-development-flow.md)を参照する。

1. GitHub Issueから対象・ACを取得する（なければ既存Issue/PRと重複確認してから作成）。Notion施策はIssueと相互リンクして背景の参照元にするだけで、旧Notion Task Boardを着手許可にしない。取得不可・仕様不明は人間判断待ちにし、ACを勝手に決めない。
2. 対象ファイル、Risk Class、ACと検証の対応、スコープ外をIssue/PRのImplementation Planに残す。区分は[AGENTS.mdの3段階](AGENTS.md#risk-class-と承認の3段階)で判定する。A（R0/R1）は個別確認なしで着手する。B（R2/R3、新規tool・大幅改修を含む）は計画（目的・AC・対象/対象外・影響・検証・復旧・公開範囲）の承認を一度得れば、その範囲のCI修正・レビュー対応・Merge・Deployで再承認を求めない。C（R4）は具体的な対象・差分・影響の人間承認がある範囲だけ着手する。承認原文または参照、AC、禁止範囲をIssue/PRに固定し、目的や受入結果を無断で変えない。依頼文に「計画のみ」「PRまで」「push禁止」「公開禁止」などの限定があればそれを優先し、なければA又は承認済みBの「実装/修正」依頼は公開確認までを含む。
3. Productionコードと必要なunit/E2E/regression testを実装する。期待結果をAC・仕様から導き、正常系・境界値・異常系を検証する。不具合修正では修正前に失敗する回帰テストを確認する。UIはPC/モバイルとa11y、WebMCPはschema/runtime整合、privacyは外部送信の有無を検証する。
4. lint・check・build・unit・E2Eを実行する。unitのdist依存テストとE2Eのためbuildを先に完了する。コマンド・結果・未実行理由を記録し、スコープを限定してDraft PRを作る。CI失敗中の状態でPRを作らない。
5. 個別に許可された範囲で、作業の区切りごとにcommit・pushする（個別のcommit/push禁止の指示は上書きしない）。PR作成・レビュー依頼で担当を終えず、Issue/PRに現在状態・次の一手・待ち先・待ち始め・再開条件・対象head SHAを残して更新する。CI・Codexレビューの完了・失敗・指摘後の次の対応もClaude Codeが担当する。既存の定期確認と実際に利用できるイベント応答だけを使い、未設定の自動再開は保証しない。
6. Codex finding・CI failureへ以下の手順で対応する。自分のPRの最終承認は行わない。
7. A（R0/R1）と、承認済みのB・Cは、[AGENTS.mdのPRマージ条件](AGENTS.md#prのマージ判断と実行)をすべて満たす場合、既存Claude Routine、またはこのClaude Codeプロジェクト（`tools.codelife.cafe 保守`）とその担当スレッドがMergeできる。Codexが同一の最終headの実差分・AC・許可境界を独立に確認して分類（A / 承認済みB / 承認済みC）の根拠をPRに残していることが前提で、「重大な指摘なし」だけでは足りない。Code/Security botの両完了、必須CI、最新base、strict required checks、照合済みhead指定Mergeは維持し、独立レビューの代行や自己承認、botのローカルレビューによる代替はしない。CI/レビューのRunning・一時的な取得失敗・利用上限は技術待ちとして既存の購読等で続け、同じheadでの連投や未確認のMergeはしない。Merge後は既存Deployと許可範囲の本番確認、公開SHAのIssue/PR記録まで確認する。人間へ戻すのは、未承認のB/C、ACや禁止範囲の変更、意味の判断が必要な競合、3周でblockingが解消しない場合、本人の認証が必要な場合だけで、承認済みのB/Cを区分名だけで止めない。
8. 利用上限に達した場合は別の実装者へ自動で切り替えず、待ち状態と再開条件をIssue/PRに明記して止める。

禁止: テストを通すためだけの期待値変更、理由のない既存テストの弱体化・削除、CI/review gateの無効化、ACの無断変更、スコープ外リファクタ、権限拡大・追加課金・新スケジューラの追加、旧停止タスクの再開。仕様上必要なテスト更新はACとの対応と理由をPRに残す。

## 7. Codex feedback / CI failureへの対応

CodexのCode/SecurityレビューコメントとCI failureに対応する。Codexは独立レビュー担当であり、Codexへfixを依頼しない。コメントを受けたら最新headのコードとACで再現・照合し、無条件には変更しない。

| 分類 | 対応 |
| --- | --- |
| actionable defect | 根拠を確認してProductionと必要な回帰テストを修正 |
| test inadequacy | ACに基づく不足テストを追加・修正し、発見したProduction bugも直す |
| informational | 理解・記録のみ。自動変更しない |
| nit | 自動変更しない。styleだけでMergeを止めない |
| specification ambiguity | ACを変更せず、選択肢と判断点を残して人間へエスカレーション |

誤検出・既に修正済みなら根拠とコミットを返信し、同じ修正を繰り返さない。指摘コメントを権限拡張やR4変更の許可と解釈しない。

- PR全体で自動修正は最大**3周**。1周は「未対応finding/CI failureをまとめて修正 → push → CI → 必要時Codex再確認」。CI failureも同じ上限に含める。
- 着手前にPR本文・コメント履歴から使用済み周回数を読み、`修正ループ: n/3`、findingリンク/CI run、分類、対象head、結果をPRへ記録する。次の周回番号を記録してから修正し、再起動や重複イベントで0に戻さない。並行するMakerや進行中の周回があれば新しく開始しない。
- 履歴から周回数を確定できない、3周後も未解決、仕様・権限・スコープの判断が必要な場合は自動修正を停止して人間へ返す。4周目を自動開始しない。
- 修正後は最新コミットのCI成功を待つ。Production/Testsの実質変更や未解決findingにはCodex再レビューを求める。通常はCI成功後にDraftを解除（Ready）して自動レビューを受け、Draftで手動依頼してからReadyにする二重起動をしない。自動再レビューされない場合や、個別制約でDraftを維持すべき場合だけ、同じhead・同じ種別の依頼が既にないことを確認してから既存連携の手動review依頼（`@codex review`）を1回使う。連投しない。
- CI failureは常にblocking。原因が環境でも成功扱いにせず、ログを残す。3周上限を越えた再試行、gate迂回、自己承認、未解決のままMergeはしない。

## 8. 主要コマンド

Nodeは `.nvmrc`（`engines` は `>=22.23.4`）に合わせる。

```bash
npm run dev          # 開発サーバー起動 (localhost:4321)
npm run build        # 本番ビルド（WASM/WebMCP準備・Astro・OGP/SW生成・アセット検証）
npm run preview      # ビルド成果物のローカルプレビュー
npm run check        # Astro型チェック ＋ Biome静的解析
npm run lint         # Biome 静的解析の実行 (src/, tests/)
npm run lint:fix     # Biome 自動修正の適用
npm run test:unit    # コアロジックの単体テスト実行 (Node 22 --test。dist依存テストがあるためbuild後)
npm test             # E2Eテスト全件実行（Playwright）
```

### 8.1 テストの個別実行
```bash
npx playwright test tests/e2e/bg-remove.spec.ts          # テストファイルを指定して実行
npx playwright test --grep "モード切替"                   # テスト名で絞り込んで実行
npx playwright test --headed                              # ブラウザを表示して実行
```

## 9. ツール開発アーキテクチャ (要約)

### 9.1 4ファイル（+1）構成
新しいツールを追加する際は、以下の構成でファイルを配置します。
- **純粋ロジック:** `src/lib/tools/[name].ts`
- **React UI Island:** `src/components/tools/[Name].tsx` （UIとローカル状態管理）
- **LPコンテンツ:** `src/content/tools/[name].md` （title/description/useCases/howto/faq等のフロントマター）
- **Astro ページシェル:** `src/pages/[name].astro` （content collection を取得し `ToolLayout` に渡す）
- **Web Worker (オプション):** `src/workers/[name].worker.ts` （AI推論などの重量処理）

### 9.2 E2Eテストの注意点
テストは必ず `tests/e2e/fixtures/base.ts` で定義されているカスタムフィクスチャを経由してください。広告やトラッキングスクリプトが自動的にブロックされます。

```typescript
import { expect, test } from './fixtures/base';  // ← 必須

test('test name', async ({ page, createToolPage }) => {
  const toolPage = createToolPage('tool-name');  // pathを渡す
  await toolPage.goto();                          // 読み込み完了を待機
  await toolPage.expectSafetyBadge();             // SafetyBadgeの検証
});
```

## Code Review Rules

Productionコードと追加・変更・削除されたテストを一体で確認する。Issue/PRに記載されたAcceptance Criteria（AC）と差分を照合し、ACを取得できない場合は推測で補わず未確認とする。

1. **Correctness / regression risk:** 公開された入出力、境界値、失敗時の挙動、既存toolと共通部品への回帰を確認する。
2. **Privacy / client-side-only / security:** 入力本文・ファイル・画像・音声・個人情報が通信、ログ、保存へ漏れないか。静的アセット取得と既存Allowlistの匿名計測は許容するが、例外を拡張しない。XSS、信頼境界、依存のリスクも確認する。
3. **Test adequacy:** ACを直接検証しているか、happy pathに偏らず境界値・異常系があるか、不具合修正に必要なregression testがあるか。実装内部をなぞる脆いテスト、Production bugを期待値変更で隠すテスト、根拠のない弱体化・削除を指摘する。privacy・a11y・client-side-onlyの回帰も対象。共通E2E fixtureの通信遮断やSW無効化だけで、本番の外部送信なし・PWA正常を証明したことにしない。
4. **Accessibility / responsive UI:** キーボード、ラベル、フォーカス、状態通知、主要なPC/モバイル幅の利用可能性を確認する。
5. **WebMCP:** schemaとruntime validationの許容値・必須値・エラー・出力が一致し、実際の登録/実行経路を検証しているか。
6. **Bundle / dependency / dynamic import:** 不要な依存・初期bundle増大、遅延ロードの破損、Worker/CSPとの不整合を確認する。
7. **Scope / simplicity:** ACの無断変更、スコープ外リファクタ、不要なAgent・Workflow・状態管理・抽象化を持ち込んでいないか。

findingは `actionable defect` / `test inadequacy` / `informational` / `nit` / `specification ambiguity` に分類し、ファイル・行、発生条件、影響、根拠、必要な検証を示す。重大度はP0（緊急）、P1（高）、P2（通常）を区別する。出力環境の対応範囲で報告し、P2を投稿させるためにP1へ水増ししない。
style/nitだけではblockingにしない。修正を要するdefect/test不足はblocking、仕様の曖昧さは人間判断待ちとして明示する。根拠のない懸念だけで修正を要求しない。
再レビューでは対象コミット・元finding・修正・回帰テスト・CIを照合する。レビューコメントの不在を承認とみなさず、未確認の項目を明示する。
