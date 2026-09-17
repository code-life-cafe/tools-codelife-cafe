---
name: gen-test
description: tools.codelife.cafe の既存ツールに対して tests/e2e/fixtures/base.ts 経由のE2Eテスト雛形を生成する。「/gen-test <slug>」「〇〇のE2Eテスト作って」で発火。
---

指定されたツールのE2Eテスト雛形を生成してください。引数として `$ARGUMENTS` にtool slug（例：`base64`）が渡されます。

## 手順

1. 対象Notion Task（指定がある場合）またはユーザー依頼のAcceptance Criteria（AC）と公開仕様から期待する入出力・境界値・異常系を決め、`src/lib/tools/catalog.ts` で該当slugを確認する。AC不明は人間判断待ちにする
2. `src/components/tools/{Name}.tsx` を読み、主要な入出力操作（入力欄・出力欄・スイッチ/ボタン等）を把握する
3. 既存テスト（例: [tests/e2e/base64.spec.ts](../../../tests/e2e/base64.spec.ts)）と共通ヘルパー（[tests/e2e/helpers/tool-page.ts](../../../tests/e2e/helpers/tool-page.ts)）を参照し、以下の構成で `tests/e2e/{slug}.spec.ts` を作成する：
   - 必ず `import { expect, test } from './fixtures/base';` を使用する（直接 `@playwright/test` からimportしない）
   - 1件目のテスト: ページ表示確認（`toolPage.goto()` → `expectTitle()` → `expectSafetyBadge()`）
   - 2件目以降: ACに対応する主要機能、境界値・異常系。bugfixでは修正前に失敗するregression testも含める。ケース数を1〜2件に固定しない
   - `tool-page.ts` に無い操作が必要な場合は、既存メソッドの命名規則（`expectXxx`/`clickXxx`/`fillXxx`）に合わせて `ToolPage` にメソッドを追加してから使う
4. 作成後、E2Eはdist配信に対して実行されるため `npm run build` してから対象テストのみ実行して確認する：
   ```bash
   npx playwright test tests/e2e/{slug}.spec.ts
   ```

## 注意

- 実装は操作経路と影響範囲の確認に読む。アサーションの期待値はAC・仕様から独立に導き、実装結果に合わせて変更しない。理由なく既存テストを弱めたり削除したりしない
- テスト作成・修正はClaude Makerの責任。CodexがProductionとテストの妥当性を独立レビューする。別Test Agentは通常起動しない
- 既存テストの構造を流用しつつ、コピペで残った無関係なコメント・不要なテストケースは残さない
