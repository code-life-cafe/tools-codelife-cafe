---
name: add-tool
description: tools.codelife.cafe に新しいWebツールを追加する（3ファイル構成＋catalog.ts登録）。「/add-tool <ツール名>」「新しいツールを追加して」で発火。
---

新しいツールを追加してください。引数として `$ARGUMENTS` が渡されます（例：`/add-tool URLエンコーダー`）。

> **正となる手順書は [docs/development-guide.md](../../docs/development-guide.md) の「3. ツール開発」**（特に §3.4 新規ツール追加チェックリスト）です。本スキルは進め方の枠組みのみを定め、実装詳細は必ず最新の development-guide に従ってください。

## 手順

### 1. 実装計画の作成（ユーザー承認必須）

以下を含む実装計画を提示し、承認を得てから実装を開始する：

- **ツール名**（日本語・英語）と **slug**（URLパス、例：`url-encoder`）
- **カテゴリ**・**アイコン**（絵文字1文字）・**related**（catalog.ts 上の関連ツール候補）
- **主な機能**（箇条書き3〜5項目）
- **作成ファイル一覧**

### 2. 実装（development-guide §3 に準拠）

1. `src/lib/tools/{slug}.ts` — DOM/React非依存の純粋ロジック。エラーメッセージは日本語。ローカルimportは `.ts` 拡張子付き（node --test 対応）
2. `src/components/tools/{Name}.tsx` — React UI。shadcn/ui・Lucide使用、日本語UIファースト、`CopyButton` を出力部に配置
3. `src/pages/{slug}.astro` — `ToolLayout` 使用、`client:load` 付与、`slot="usage"` に使い方説明
4. **`src/lib/tools/catalog.ts` に1エントリ登録**（id・title・description・href・category・icon・related）— index・ナビ・検索・SEO・OG・sitemap はここから自動連動する。**index.astro や Navigation・SearchModal への手書き追加はしない**
5. 関連ツールリンクをページに手書きしない（catalog の `related` に集約）

### 3. テスト

- 単体テスト: ロジックに対して `tests/unit/`（`npm run test:unit`）
- E2E: `tests/e2e/{slug}.spec.ts` — 必ず `tests/e2e/fixtures/base.ts` の共通フィクスチャを使用。ページ表示（タイトル・SafetyBadge）と主要機能（入力→出力）を検証
- E2E は dist 配信に対して実行されるため、実行前に `npm run build`

### 4. ドキュメント更新（必須・実装と同一PRで行う）

新規ツール追加は **必ず以下のドキュメント更新を伴う**。catalog.ts 登録だけでは index・ナビ・SEO は自動連動するが、以下は手動更新が必要なため、実装漏れとして扱う。

- **`README.md`**
  - 該当カテゴリの表（テキスト処理・データ処理・ユーティリティ・PDF・開発者向け 等）に1行追加（ツール名リンク・説明）
  - 冒頭の「収録ツール（N種）」の件数（見出しと本文2箇所）をインクリメント
  - 主力ツールとして紹介する価値があれば「⭐ 主力ツール」表への追加も検討する
- **`docs/*.md`**（architecture.md / development-guide.md / data-management.md / analytics.md / seo.md）
  - 今回のツールが既存の設計方針・命名規約・データ管理方式などに当てはまらない新パターンを持ち込む場合（例: 新しい共通フック、新しいデータ配信方式）は該当ドキュメントを更新する
  - 既存パターンの踏襲のみであれば更新不要（無理に加筆しない）
- `llms.txt` / `llms-full.txt` は catalog.ts の `llmsFull` から自動生成されるため手書き更新は不要（ただし `llmsFull` の記入自体は catalog.ts 登録時に必須）

### 5. 完了報告

- 作成・編集したファイル一覧（リンク付き、ドキュメント更新分を含む）
- `npm run check`・`npm run test:unit`・対象E2E の実行結果
- ローカル確認用コマンド（`npm run dev` → アクセスURL）

以降の出荷（コミット→PR→Notion更新）が必要なら `/ship` を使う。
