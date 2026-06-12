# CLAUDE.md

本ファイルは、AIエージェントが本リポジトリで作業する際の主要コマンド、およびアーキテクチャの早期理解を目的とするガイドです。

> [!NOTE]
> 詳細な設計方針、コーディング規約、データ管理については以下の設計書および **AGENTS.md** を参照してください。
> - [architecture.md](file:///d:/tools-codelife-cafe/docs/architecture.md) (全体設計、PWA)
> - [development-guide.md](file:///d:/tools-codelife-cafe/docs/development-guide.md) (ツール追加手順、命名規約、UI・ロジック分離、テスト)
> - [data-management.md](file:///d:/tools-codelife-cafe/docs/data-management.md) (郵便番号チャンク、モデルのR2配信)

---

## 1. 主要コマンド

```bash
npm run dev          # 開発サーバー起動 (localhost:4321)
npm run build        # 本本番ビルド（Astroビルド ＋ sw.js のプレースホルダー置換）
npm run preview      # ビルド成果物のローカルプレビュー
npm run lint         # Biome 静的解析の実行 (src/, tests/)
npm run lint:fix     # Biome 自動修正の適用
npm test             # E2Eテスト全件実行（Playwright）
```

### 1.1 テストの個別実行
```bash
npx playwright test tests/e2e/bg-remove.spec.ts          # テストファイルを指定して実行
npx playwright test --grep "モード切替"                   # テスト名で絞り込んで実行
npx playwright test --headed                              # ブラウザを表示して実行
```

---

## 2. ツール開発アーキテクチャ (要約)

### 2.1 3ファイル（+1）構成
新しいツールを追加する際は、以下の構成でファイルを配置します。
- **純粋ロジック:** `src/lib/tools/[name].ts`
- **React UI Island:** `src/components/tools/[Name].tsx` （UIとローカル状態管理）
- **Astro ページシェル:** `src/pages/[name].astro`
- **Web Worker (オプション):** `src/workers/[name].worker.ts` （AI推論などの重量処理）

### 2.2 E2Eテストの注意点
テストは必ず `tests/e2e/fixtures/base.ts` で定義されているカスタムフィクスチャを経由してください。広告やトラッキングスクリプトが自動的にブロックされます。

```typescript
import { expect, test } from './fixtures/base';  // ← 必須

test('test name', async ({ page, createToolPage }) => {
  const toolPage = createToolPage('tool-name');  // pathを渡す
  await toolPage.goto();                          // 読み込み完了を待機
  await toolPage.expectSafetyBadge();             // SafetyBadgeの検証
});
```
