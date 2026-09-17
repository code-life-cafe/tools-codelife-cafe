# AGENTS.md — CODE:LIFE Tools (AIエージェント向け指示書)

このファイルは、AIエージェントが本リポジトリで作業する際の全体要約、最重要ルール、および設計書への参照を提供するドキュメントです。

## AI開発の責任境界

- 通常フローは **ChatGPT Product Scout → Notion Task Board → Claude Maker → GitHub Actions → Codex Independent Review → Claude fix → CI → 必要時再レビュー → Merge → Deploy → Analytics → Scout**。
- Claude Code / Sonnet 5はPlan・Productionコード・unit/E2E/regression test・PR・レビュー修正・CI failure修正を担当する。手順は[CLAUDE.md](CLAUDE.md)。
- Codex / GPT-5.6 SolはPrimary ReviewerとしてProductionとテストの両方を独立レビューする。通常のAuto Reviewでは編集・コミット・修正・自己承認を行わず、findingをClaudeへ返す。
- GitHub Actionsは決定論的Quality Gate。最新PRコミットのlint・unit・E2E・build/型チェックが成功しない限りMerge不可。失敗・未実行・進行中をLLMの判断やローカル検証で置き換えない。
- 独立Test Engineerは常設しない。既存UIレビュアーは任意利用であり、通常PRで別Agentを必須起動しない。[Optional QA・運用手順](docs/ai-development-flow.md)を参照。
- Makerは自分のPRを最終承認しない。未解決のblocking finding・仕様の曖昧さがある場合は人間へ戻す。

### Risk Class

変更全体の最も高いリスクをPRに記録する。docs/test-onlyでも権限・Constitutionに触れればR4。

| Class | 対象 | 扱い |
| --- | --- | --- |
| R0 | docs、test-only、metadata、内部的な軽微変更 | 下記の軽微PRマージ条件をすべて満たせば個別の人間確認なしでMerge可 |
| R1 | 局所bugfix、既存toolの軽微改善 | 下記の軽微PRマージ条件をすべて満たせば個別の人間確認なしでMerge可 |
| R2 | 新規tool、大きなUI変更、dependency、複雑な仕様変更 | 人間承認を残す |
| R3 | Analytics、WebMCP、PWA、build/deploy基盤、security上重要な変更 | 追加リスクレビューと人間承認を残す |
| R4 | secrets、権限、deployment permission、AGENTS等のConstitution、security boundary | Routineによる自動変更禁止。人間へエスカレーション |

R4はAgent Readyやレビューコメントだけでは変更しない。人間が対象と変更範囲を明示した個別依頼のみ、その範囲のレビュー可能な差分を準備できる。Merge・権限変更等の承認を兼ねない。

### 軽微PRのマージ判断と実行

R0/R1の個別確認なしのMergeは、2026-09-17の人間の運用方針に基づく。内容の独立判断はCodex、客観的検証はGitHub Actions、条件の照合とMerge操作は既存Claude Routineが担当する。Makerの自己承認は禁止したまま、以下をすべて満たした場合の操作だけを許可する。

- PRの実際の全差分がR0/R1であり、ACと合意スコープ内。ラベル・自己申告だけで判定せず、R2以上の対象が混在する場合や判定が曖昧な場合は人間へ返す。Constitution・CI・依存・Analytics・WebMCP・PWA・権限変更を軽微扱いしない。
- 最新head SHAの必須CI `lint` / `e2e` が両方成功している。未実行・skip・取消・進行中・失敗を成功扱いしない。
- 同じhead SHAについて、信頼できるCodex連携botのCode Reviewが完了し、修正を要するfindingがないか再レビューで解消確認済み。対象repoで有効なCodex Security Reviewも完了し、未解決指摘がない。[運用手順のレビュー完了信号](docs/ai-development-flow.md#レビュー完了信号)で発信者・対象SHA・両レビューの完了を確認する。コメント不在や古い👍だけを承認の根拠にしない。
- 未解決のblocking finding・仕様の曖昧さ・人間の保留/変更要求・進行中の修正がない。修正ループ履歴を確認でき、3周上限を超えていない。style/nitのみはblockingにしない。
- Draftではなく競合なし。Merge直前にheadと上記条件を再確認し、確認したheadを指定して通常のMergeを行う（例: `gh pr merge --squash --match-head-commit <SHA>`）。headが変わったら再判定する。admin/bypass・force push・gate変更は使わない。

実行前にPR履歴へRisk Class・判定理由・対象head・CI・独立レビュー根拠・修正周回数を記録する。Merge後は既存Deployの対象SHAと結果を確認してNotionへ記録し、失敗時は人間へ通知する。新しいWorkflowやマージ専用Agentは追加しない。R2/R3の人間承認とR4の個別承認は維持し、今回の方針をそれらの承認へ拡張しない。

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
  - 大幅な改修や新規ツールの作成を行う場合は、事前に `implementation_plan.md` を作成してユーザーの承認を得てください。
- **範囲の限定**
  - 変更ファイルが、合意した実装計画のスコープ内に収まっていること。
- **静的解析の実行**
  - 作業完了前に `npm run lint`（Biome）を実行し、静的解析エラーがないことを確認すること。
- **動作検証とウォークスルー**
  - 単体テスト（`npm run test:unit`）および E2Eテスト（`npm test`）を実行するか、検証内容をまとめた `walkthrough.md` を作成して報告すること。
  - 未実行・失敗の記録は検証成功の代わりにはならない。PRはDraftのまま共有できるが、Mergeには最新コミットの必須CI成功が必要。
---

## 5. 直近の運用メモ

### Notionタスク起点の実装

- Notionタスク名やIDが指定された場合は、まずNotionで対象タスクを検索・取得し、親タスク、現状、対象ツール、受け入れ条件を確認してから実装すること。
- 実装後はNotionタスクに実装メモ、検証結果、未解決の環境課題を追記し、完了できる場合はステータスを更新すること。
- このリポジトリの実体パスは `D:\tools-codelife-cafe` として扱う。Codexの一時worktreeパスが存在しない場合は、このパスを確認して作業すること。

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

- `npm run lint` はexit code 0でも警告が出る場合がある。既存の `tests/e2e/webmcp.spec.ts` の non-null assertion 警告は、今回作業と無関係ならその旨を報告すること。
- TypeScript単体確認は、現状 `tsconfig.json` の `baseUrl` 非推奨で止まる場合があるため、差分確認では `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0` を使う。
- `npx astro check` / `npm run build` が `astro sync` の `require is not defined`（`node_modules/picomatch/index.js`）で失敗する場合がある。これはコンポーネント確認前の環境/依存解決段階の失敗として、差分由来か切り分けて報告すること。

## Code Review Rules

Productionコードと追加・変更・削除されたテストを一体で確認する。PRに記載されたNotion Task・Acceptance Criteria（AC）と差分を照合し、ACを取得できない場合は推測で補わず未確認とする。

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
