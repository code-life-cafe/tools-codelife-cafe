# AGENTS.md — CODE:LIFE Tools (AIエージェント向け指示書)

このファイルは、AIエージェントが本リポジトリで作業する際の全体要約、最重要ルール、および設計書への参照を提供するドキュメントです。

---

## 1. プロジェクト概要

`tools.codelife.cafe` は、完全クライアントサイド処理で動作するWebツール集です。
すべてのデータ処理はユーザーのブラウザ内で完結し、外部サーバーへのデータ送信は一切行いません。

---

## 2. 設計書ドキュメント一覧 (詳細参照)

プロジェクトの全体設計やルールについては、以下の詳細設計書を必ず参照してください。

- **[architecture.md](file:///d:/tools-codelife-cafe/docs/architecture.md) (システムアーキテクチャ設計書)**
  - 全体技術スタック、ディレクトリ構造、およびビルドプロセスと連携した PWA (Service Worker) の構成。
- **[development-guide.md](file:///d:/tools-codelife-cafe/docs/development-guide.md) (開発ガイドライン / ツール作成手順)**
  - 命名規約、UI・ロジックの分離（3ファイル構成）、デザインシステム（Tailwind v4）、Biomeの設定、E2Eテスト。
- **[data-management.md](file:///d:/tools-codelife-cafe/docs/data-management.md) (データ管理とモデル配信設計書)**
  - 郵便番号データのチャンク化および更新方法、AIモデルの Cloudflare R2 配信と Web Worker 推論。
- **[analytics.md](file:///d:/tools-codelife-cafe/docs/analytics.md) (計測基盤設計)**
  - Cloudflare Analytics Engine による完全匿名イベント計測方針とAllowlistプロパティ。
- **[seo.md](file:///d:/tools-codelife-cafe/docs/seo.md) (SEO & 構造化データガイドライン)**
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
