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

- モデルは作業内容に応じて3段階から選び、上位を常用しない。**軽**（調査、点検、データ整理、定型作業。Haiku）、**標準**（R0/R1の修正、文言やSEOの変更、CI・レビュー指摘への対応。Sonnet）、**重**（R2新機能の設計、複数ファイルにまたがる大きな変更、原因不明の不具合調査、R3の追加リスクレビュー。Opus）。
- 格上げ: 標準で2回失敗したら、その作業だけ一段上げる。重を使ったら理由を報告に残す。節約: プランの残りが2割を切ったら、その週は軽・標準だけにする。
- 共有cloneは常にmainのままにする。共有cloneで作業する場合、各エージェントは作業ごとに自分のworktree（`git worktree add <repo外のパス> -b <branch>`）を作成して作業し、完了したら削除する。クラウドセッションなど作業用cloneが分離済みの環境では不要。PRのレビュー判定は実装者以外が行い、Mergeは下記のPRマージ条件に従う。
- 本節はClaude Codeのモデル段階の指針であり、Codexのレビューモデル・外部サービスの設定を変更しない。

### Risk Class と承認の3段階

変更全体の最も高いリスクをPRに記録する。混在は最も厳しい区分で扱う。ファイル名（AGENTS.md / CLAUDE.md 等）だけでR4にしない。実際の差分が何を変えるかで分類する。

| 区分 | Class | 対象 | 人間承認 |
| --- | --- | --- | --- |
| A | R0 / R1 | docs、test-only、metadata、既存仕様内の誤字・リンク・説明・テスト、局所bugfix、小UI、入出力・通信・保存を変えない整理、後述の既存依存のX.Y固定patch | 不要。個別確認なしで実装からMerge・Deploy・本番確認まで進める |
| B | R2 / R3 | 新機能・新規tool、大きなUI変更、複雑な仕様変更、minor/major依存更新、既存の許可境界内のPWA / WebMCP / 計測 / build・deploy変更 | 計画を一度承認する。以後の同範囲のCI修正・レビュー対応・Merge・Deployで再承認しない。R3は追加独立リスクレビューを維持 |
| C | R4 | 秘密情報、認証アクセス、外部送信・保存の拡大、破壊的操作、課金、security boundary、CI・レビュー・承認条件の弱体化、自動権限拡大 | 具体的な対象・差分・影響についての人間承認。区分名だけの包括承認は認めない |

**詳細**: A（R0/R1）の依存patchの全条件、B/Cの承認方法、依頼文の読み方は [docs/approval-and-merge-rules.md](docs/approval-and-merge-rules.md) に分離した。判断の前に必ず読む。要点:

- 既存依存のX.Y固定patch更新は、同docの全条件（公開7日以上、配布元・配布物の独立確認など）を満たす場合だけA。満たさない、または曖昧ならB/C。
- 指示書（AGENTS.md / CLAUDE.md / docs / テンプレート）の変更は、意味を変えない誤字・リンク・説明の修正はA。承認済みの仕様・役割の意味を増やさない同期は、その承認範囲として扱う。許可される行為・対象・実行主体・承認の要否・CIやレビュー・停止条件・データ・権限を変える差分はCとする。
- B/Cの承認原文または参照、AC、対象/対象外をIssue/PRに固定する。範囲外の変更が必要になった場合だけ人間へ戻す。
- 通常の「実装して」「修正して」は、A又は承認済みBならMerge後の公開確認までを含む。「計画のみ」「PRまで」「pushしない」「公開しない」という明示的な限定は常に優先する。

### PRのマージ判断と実行

全文: [docs/approval-and-merge-rules.md](docs/approval-and-merge-rules.md)。Mergeの前に必ず読む。要点:

- 操作主体は、既存Claude Routine、およびClaude Codeプロジェクト `tools.codelife.cafe 保守`（`chan_01BLscqs8eCg8fzAnUt8YFrw`）とその担当スレッドだけ。人間が会話で対象PRのMergeを特定のエージェントへ指示した場合は、そのPRだけ当該エージェントが操作できる。常設担当は増やさない。Makerは自分のPRを承認しない。
- 同一の最終head SHAで、Codexの独立した分類確認（A / 承認済みB / 承認済みC）、Code Reviewの完了、必須CI `lint` / `e2e` の成功、最新base、未解決blockingなし、修正3周以内、非Draft・競合なしが揃った場合だけ、確認したheadを指定して通常Mergeする。Securityは同じ完了信号を原則とし、構造化結果が欠ける既知不具合の限定例外だけを承認・Merge詳細に書く。自動ゲートはnullを合格にしない。「重大な指摘なし」だけを分類確認とみなさない。
- CI・レビューのRunning、一時的な取得失敗、利用上限は技術待ち。人間へ戻すのは、未承認のB/C、ACや禁止範囲の変更、意味の判断が必要な競合、3周でblockingが解消しない、本人の認証が必要な場合だけ。
- 実行前にPR履歴へ区分・判定理由・承認の根拠・対象head・CI・レビューと分類確認の根拠・修正周回数を記録し、Merge後は既存Deployと公開SHA・本番確認をIssue/PRへ記録する。新しいスケジューラ・Workflow・権限・課金は追加しない。
- 2026-10-27より前の旧運用（Codex主実装、Notion Task Board、Grok Bot運用ループ、ローカルCLIレビュー代替など）は歴史記録で、再開しない。旧ルールの全文はgit履歴で参照できる。

## 1. プロジェクト概要

`tools.codelife.cafe` は、完全クライアントサイド処理で動作するWebツール集です。すべてのデータ処理はユーザーのブラウザ内で完結し、外部サーバーへのデータ送信は一切行いません。

## 2. 設計書ドキュメント一覧 (詳細参照)

詳細は次を必ず参照すること。

- [architecture.md](docs/architecture.md): 技術スタック、ディレクトリ構造、PWA (Service Worker)。
- [development-guide.md](docs/development-guide.md): 命名規約、UI・ロジック分離、デザインシステム、Biome、E2E、ツール設定の保持。
- [data-management.md](docs/data-management.md): 郵便番号チャンク、AIモデルのR2配信とWeb Worker推論。
- [analytics.md](docs/analytics.md): 匿名イベント計測方針とAllowlist。
- [seo.md](docs/seo.md): JSON-LD構造化データ規約と検証手順。

## 3. 絶対に守るべきルール

1. **サーバーサイド処理を使わない**
   - APIコール、外部サーバーへのデータ送信は一切禁止です（静的アセット配信およびCookieレス・個人追跡なしのアクセス解析を除く）。
2. **日本語ファースト**
   - UI文言、プレースホルダー、プレビュー用ダミーデータ、エラーメッセージ等はすべて日本語で作成してください。
3. **UIとロジックの分離**
   - 計算・変換などのビジネスロジックは React から切り離し、`src/lib/tools/` 内に TypeScript の純粋関数として実装してください。
4. **単体テストのルール**
   - ユニットテストは Node.js 組み込みの `node:test` および `node:assert/strict` を使用し、`vitest` 等の未宣言フレームワークは使用しないでください。ローカルインポートには `.ts` 拡張子を明記します。

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

## 5. 直近の運用メモ

### Issue/PR起点の実装

- 実装はGitHub Issueを起点にする。対象Issue（なければ重複確認のうえ新規作成）のAC・Risk Class・スコープ外を確認してから着手し、ACが取得できない・不明な場合は推測せず人間判断待ちにする。
- Notionの施策・既存タスクが指定された場合は、背景・仮説・効果測定の参照元として読み、実装のAC・状態・検証結果・承認はIssue/PRに記録する。Notionには実装Issue/PRへのリンクと効果測定のみを残し、開発状態を二重管理しない。
- 実装後はIssue/PRに検証結果・未解決の環境課題・待ち状態（待ち先・待ち始め・再開条件・対象head）を追記する。

### ツール設定保持・PR作成

- ツールの「前回設定」「設定共有URL」は `useToolSettings` を使う。保存してよいのは設定値だけ（入力本文・ファイル・個人情報は不可）。詳細は [development-guide.md §10](docs/development-guide.md)。
- 混在worktreeでのPR作成: `git status --short --branch` と対象差分を確認し、今回スコープのファイルだけを明示的に `git add` する。既存PR有無と `main` との差分も確認する。ユーザーが明示しない限りdraft PRで作成し、PR本文に「今回の最新コミット」「検証結果」「意図的に含めなかった未ステージ変更」を書く。

### 既知の検証メモ

- Nodeは `.nvmrc`（`engines` は `>=22.23.4`）に合わせる。満たさない環境では `astro check` / `astro build` が起動しない。
- `npm run test:unit` の `tests/unit/onnx-runtime-build.test.ts` は `dist/` が前提で、`npm run build` 前は失敗する。unitはbuild後に実行する。
- `npm run lint` はexit code 0でも警告が出る場合がある。既存の `tests/e2e/webmcp.spec.ts` の non-null assertion 警告は、今回作業と無関係ならその旨を報告すること。
- TypeScript単体確認は、現状 `tsconfig.json` の `baseUrl` 非推奨で止まる場合があるため、差分確認では `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0` を使う。
- `npx astro check` / `npm run build` が `astro sync` の `require is not defined`（`node_modules/picomatch/index.js`）で失敗する場合がある。これはコンポーネント確認前の環境/依存解決段階の失敗として、差分由来か切り分けて報告すること。

## 6. Makerの手順（Claude Code）

主実装者・Codex・ChatGPTの役割は冒頭の責任境界、全体フローは [運用手順](docs/ai-development-flow.md) を参照する。Productionコードとテストの両方を作成・修正する。

1. GitHub Issueから対象・ACを取得する（なければ既存Issue/PRと重複確認してから作成）。Notion施策はIssueと相互リンクして背景の参照元にするだけで、旧Notion Task Boardを着手許可にしない。取得不可・仕様不明は人間判断待ちにし、ACを勝手に決めない。
2. 対象ファイル、Risk Class、ACと検証の対応、スコープ外をIssue/PRのImplementation Planに残す。区分は[AGENTS.mdの3段階](AGENTS.md#risk-class-と承認の3段階)で判定する。A（R0/R1）は個別確認なしで着手する。B（R2/R3、新規tool・大幅改修を含む）は計画（目的・AC・対象/対象外・影響・検証・復旧・公開範囲）の承認を一度得れば、その範囲のCI修正・レビュー対応・Merge・Deployで再承認を求めない。C（R4）は具体的な対象・差分・影響の人間承認がある範囲だけ着手する。承認原文または参照、AC、禁止範囲をIssue/PRに固定し、目的や受入結果を無断で変えない。依頼文に「計画のみ」「PRまで」「push禁止」「公開禁止」などの限定があればそれを優先し、なければA又は承認済みBの「実装/修正」依頼は公開確認までを含む。
3. Productionコードと必要なunit/E2E/regression testを実装する。期待結果をAC・仕様から導き、正常系・境界値・異常系を検証する。不具合修正では修正前に失敗する回帰テストを確認する。UIはPC/モバイルとa11y、WebMCPはschema/runtime整合、privacyは外部送信の有無を検証する。
4. lint・check・build・unit・E2Eを実行する。unitのdist依存テストとE2Eのためbuildを先に完了する。コマンド・結果・未実行理由を記録し、スコープを限定してDraft PRを作る。CI失敗中の状態でPRを作らない。
5. 個別に許可された範囲で、作業の区切りごとにcommit・pushする（個別のcommit/push禁止の指示は上書きしない）。PR作成・レビュー依頼で担当を終えず、Issue/PRに現在状態・次の一手・待ち先・待ち始め・再開条件・対象head SHAを残して更新する。CI・Codexレビューの完了・失敗・指摘後の次の対応もClaude Codeが担当する。既存の定期確認と実際に利用できるイベント応答だけを使い、未設定の自動再開は保証しない。
6. Codex finding・CI failureへ以下の手順で対応する。自分のPRの最終承認は行わない。
7. A（R0/R1）と、承認済みのB・Cは、[AGENTS.mdのPRマージ条件](AGENTS.md#prのマージ判断と実行)をすべて満たす場合、既存Claude Routine、またはこのClaude Codeプロジェクト（`tools.codelife.cafe 保守`）とその担当スレッドがMergeできる。Codexが同一の最終headの実差分・AC・許可境界を独立に確認して分類（A / 承認済みB / 承認済みC）の根拠をPRに残していることが前提で、「重大な指摘なし」だけでは足りない。Code Reviewの完了、必須CI、最新base、strict required checks、照合済みhead指定Mergeは維持する。Securityの構造化booleanが欠ける既知不具合は承認・Merge詳細の限定例外に従い、自動ゲートはnullを合格にしない。それ以外で独立レビューの代行や自己承認、botのローカルレビューによる代替はしない。CI/レビューのRunning・一時的な取得失敗・利用上限は技術待ちとして既存の購読等で続け、同じheadでの連投や未確認のMergeはしない。Merge後は既存Deployと許可範囲の本番確認、公開SHAのIssue/PR記録まで確認する。人間へ戻すのは、未承認のB/C、ACや禁止範囲の変更、意味の判断が必要な競合、3周でblockingが解消しない場合、本人の認証が必要な場合だけで、承認済みのB/Cを区分名だけで止めない。
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
npx playwright test tests/e2e/bg-remove.spec.ts   # ファイル指定
npx playwright test --grep "モード切替"            # テスト名で絞り込み
```

## 9. ツール開発アーキテクチャ (要約)
### 9.1 4ファイル（+1）構成
ロジック `src/lib/tools/[name].ts`、UI `src/components/tools/[Name].tsx`、LP `src/content/tools/[name].md`、ページシェル `src/pages/[name].astro`、任意でWorker `src/workers/[name].worker.ts`。手順は [development-guide.md](docs/development-guide.md) §3.4。

### 9.2 E2Eテストの注意点
テストは必ず `tests/e2e/fixtures/base.ts` のカスタムフィクスチャ経由で書く（`import { expect, test } from './fixtures/base'`。`@playwright/test` の直importは不可。広告・トラッキングが自動でブロックされる）。書き方は `tests/e2e/base64.spec.ts` を参照。

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
