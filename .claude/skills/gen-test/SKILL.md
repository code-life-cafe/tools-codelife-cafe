---
name: gen-test
description: tools.codelife.cafe の既存ツールに対して tests/e2e/fixtures/base.ts 経由のE2Eテスト雛形を生成する。「/gen-test <slug>」「〇〇のE2Eテスト作って」で発火。
---

指定されたツールのE2Eテスト雛形を生成してください。引数として `$ARGUMENTS` にtool slug（例：`base64`）が渡されます。

## 手順

1. `src/lib/tools/catalog.ts` から該当slugのエントリ（title・description）を確認する
2. `src/components/tools/{Name}.tsx` を読み、主要な入出力操作（入力欄・出力欄・スイッチ/ボタン等）を把握する
3. 既存テスト（例: [tests/e2e/base64.spec.ts](../../../tests/e2e/base64.spec.ts)）と共通ヘルパー（[tests/e2e/helpers/tool-page.ts](../../../tests/e2e/helpers/tool-page.ts)）を参照し、以下の構成で `tests/e2e/{slug}.spec.ts` を作成する：
   - 必ず `import { expect, test } from './fixtures/base';` を使用する（直接 `@playwright/test` からimportしない）
   - 1件目のテスト: ページ表示確認（`toolPage.goto()` → `expectTitle()` → `expectSafetyBadge()`）
   - 2件目以降: 主要機能（入力→出力の変換、モード切替、クリア等）を1〜2ケース
   - `tool-page.ts` に無い操作が必要な場合は、既存メソッドの命名規則（`expectXxx`/`clickXxx`/`fillXxx`）に合わせて `ToolPage` にメソッドを追加してから使う
4. 作成後、E2Eはdist配信に対して実行されるため `npm run build` してから対象テストのみ実行して確認する：
   ```bash
   npx playwright test tests/e2e/{slug}.spec.ts
   ```

## 注意

- テストの中身（アサーションの具体値）はツール固有のロジックに依存するため、`src/lib/tools/{slug}.ts` の実装を必ず確認してから記述する
- 既存テストの構造を流用しつつ、コピペで残った無関係なコメント・不要なテストケースは残さない
