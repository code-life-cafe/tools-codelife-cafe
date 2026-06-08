# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 詳細なプロジェクトルール・命名規約・設計方針は **AGENTS.md** を参照。本ファイルはコマンドとアーキテクチャの早期理解を目的とする。

## コマンド

```bash
npm run dev          # 開発サーバー起動 (localhost:4321)
npm run build        # 本番ビルド（astro build + generate-sw.mjs）
npm run preview      # ビルド結果をローカルプレビュー
npm run lint         # Biome lint チェック（src/ tests/）
npm run lint:fix     # Biome 自動修正
npm test             # E2E テスト全件（Playwright）
```

**単体テスト実行:**
```bash
npx playwright test tests/e2e/bg-remove.spec.ts          # ファイル指定
npx playwright test --grep "モード切替"                   # テスト名で絞り込み
npx playwright test --headed                              # ブラウザ表示あり
```

E2E テストは `npm run build` 後に `npm run preview:ci` で起動したサーバーに対して実行される。`reuseExistingServer: true` のため、既にサーバーが立ち上がっていれば再利用される。

## アーキテクチャ

### 新ツールの3ファイル構成

すべてのツールは以下の3ファイルで完結する（Workerが必要な場合は4ファイル）:

```
src/lib/tools/[name].ts          # 純粋関数のロジック
src/components/tools/[Name].tsx  # React Island（UIのみ、状態管理）
src/pages/[name].astro           # ページシェル（ToolLayout + JSON-LD）
src/workers/[name].worker.ts     # 重量級処理のみ（例: bg-remove）
```

`ToolLayout.astro` を使うと SafetyBadge・`<slot name="usage">` が自動挿入される。JSON-LDは `ToolLayout` 内の `ToolJsonLd` コンポーネントが `title`/`description`/`path` から自動生成するため、個別ページでの追加は不要（`ToolLayout` は `slot="head"` を転送しないため、ページ側で追加しても描画されない）。

### React Island のライフサイクル

- `client:load` — ページ読み込み直後にハイドレート（デフォルト）
- `client:only="react"` — SSR 不要なコンポーネント（現在未使用）
- `client:visible` — 遅延ハイドレート（現在未使用）

### Web Worker（bg-remove）のデータフロー

```
BgRemove.tsx
  └─ removeBackground(file, mode, onProgress)   ← lib/tools/bg-remove.ts
       └─ ArrayBuffer (transferable) → bg-remove.worker.ts
            └─ Transformers.js pipeline('background-removal')
                 └─ RGBA Uint8ClampedArray → ArrayBuffer (transferable) →
       ← Canvas.putImageData → toBlob('image/png')
```

Worker への画像送信は `File → ArrayBuffer`（transferable）。MIME タイプは `WorkerRequest.mimeType` で明示的に渡す（`image/png` ハードコード禁止）。Worker 内は `device: 'wasm'` 固定（WebGPU は不安定のため除外）。

モデルは本番環境（`hostname !== 'localhost'`）では Cloudflare R2（`models.tools.codelife.cafe`）から配信。ローカルは HuggingFace CDN にフォールバック。

### Service Worker とビルド

`npm run build` の第2フェーズ（`scripts/generate-sw.mjs`）が `dist/` を走査して全ページ・アセット URL を収集し、`public/sw.js` のプレースホルダーを置換した `dist/sw.js` を生成する。`CACHE_NAME` のハッシュはアセット内容から自動計算され、デプロイごとに古いキャッシュが自動失効する。

### E2Eテストパターン

```typescript
import { expect, test } from './fixtures/base';  // ← 必ずこのfixture経由

test('...', async ({ page, createToolPage }) => {
  const toolPage = createToolPage('tool-name');  // path（/なし）を渡す
  await toolPage.goto();                          // networkidle まで待機

  // ToolPage ヘルパーメソッド: expectSafetyBadge / expectTitle / fillInput / expectOutputContains
});
```

`fixtures/base.ts` は広告・アナリティクスをブロックするルートを設定済み。直接 `@playwright/test` からインポートしないこと。

### Cloudflare R2（モデル配信）

- バケット: `codelife-models`、カスタムドメイン: `models.tools.codelife.cafe`
- 再アップロード: `bash scripts/upload-models-to-r2.sh codelife-models`
- CORS変更: `scripts/r2-cors.json` 編集後 `wrangler r2 bucket cors set codelife-models --file scripts/r2-cors.json`
