# AGENTS.md — CODE:LIFE Tools (AIエージェント向け指示書)

このファイルは、AIエージェントが本リポジトリで作業する際の全体要約、最重要ルール、および設計書への参照を提供するドキュメントです。

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
   - 新規ツールは、原則として「ロジック（`src/lib/`）」＋「コンポーネント（`src/components/`）」＋「ページ（`src/pages/`）」の **3ファイル構成** で完結させます。
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
