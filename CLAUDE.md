# CLAUDE.md

本ファイルは、AIエージェントが本リポジトリで作業する際の主要コマンド、およびアーキテクチャの早期理解を目的とするガイドです。

## Makerの責任

Claude Code（Claude Pro）が主実装者（Maker）。機能改善・バグ修正・脆弱性対応・依存更新・テスト・開発指示書変更の調査・計画・実装・必要なテスト・PR・CI修正・レビュー指摘対応・許可範囲の本番確認まで進行責任を持ち、Productionコードとテストの両方を作成・修正する。Codexは最終head SHAのCode/Security自動独立レビュー担当で、通常レビューでは実装・直接修正・自己承認をしない。ChatGPTはNotionでアクセス解析・SEO/GEO・仮説・優先順位・効果測定を担う。現行ルールは[Notion現行運用ルール](https://app.notion.com/p/406dfd36033681abbafce47bac685278)、Risk Classとレビュー規則は[AGENTS.md](AGENTS.md)、全体フローと手動設定は[運用手順](docs/ai-development-flow.md)を参照する。

1. GitHub Issueから対象・ACを取得する（なければ既存Issue/PRと重複確認してから作成）。Notion施策はIssueと相互リンクして背景の参照元にするだけで、旧Notion Task Boardを着手許可にしない。取得不可・仕様不明は人間判断待ちにし、ACを勝手に決めない。
2. 対象ファイル、Risk Class、ACと検証の対応、スコープ外をIssue/PRのImplementation Planに残す。新規tool・大幅改修は既存の計画承認手順に従う。R4は個別の人間依頼がある範囲だけ着手し、依頼はMerge・Deploy承認を兼ねない。
3. Productionコードと必要なunit/E2E/regression testを実装する。期待結果をAC・仕様から導き、正常系・境界値・異常系を検証する。不具合修正では修正前に失敗する回帰テストを確認する。UIはPC/モバイルとa11y、WebMCPはschema/runtime整合、privacyは外部送信の有無を検証する。
4. lint・check・build・unit・E2Eを実行する。unitのdist依存テストとE2Eのためbuildを先に完了する。コマンド・結果・未実行理由を記録し、スコープを限定してDraft PRを作る。CI失敗中の状態でPRを作らない。
5. 個別に許可された範囲で、作業の区切りごとにcommit・pushする（個別のcommit/push禁止の指示は上書きしない）。PR作成・レビュー依頼で担当を終えず、Issue/PRに現在状態・次の一手・待ち先・待ち始め・再開条件・対象head SHAを残して更新する。CI・Codexレビューの完了・失敗・指摘後の次の対応もClaude Codeが担当する。既存の定期確認と実際に利用できるイベント応答だけを使い、未設定の自動再開は保証しない。
6. Codex finding・CI failureへ以下の手順で対応する。自分のPRの最終承認は行わない。
7. R0/R1は[AGENTS.mdの軽微PRマージ条件](AGENTS.md#軽微prのマージ判断と実行)をすべて満たす場合、個別の人間確認なしで既存Claude RoutineがMergeする（Claude CodeがMakerのPRは自己承認せず、Merge操作もRoutineの条件照合に従う。他主体へ転用しない）。独立レビューの代行や自己承認はせず、根拠をPRへ記録して確認済みheadに限定する。Merge後は既存Deployと許可範囲の本番確認、公開SHAのIssue/PR記録まで確認する。条件不足・不明・R2以上は人間へ戻す。
8. 利用上限に達した場合は別の実装者へ自動で切り替えず、待ち状態と再開条件をIssue/PRに明記して止める。

禁止: テストを通すためだけの期待値変更、理由のない既存テストの弱体化・削除、CI/review gateの無効化、ACの無断変更、スコープ外リファクタ、権限拡大・追加課金・新スケジューラの追加、旧停止タスクの再開。仕様上必要なテスト更新はACとの対応と理由をPRに残す。

## Codex feedback / CI failureへの対応

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
- 修正後は最新コミットのCI成功を待つ。Production/Testsの実質変更や未解決findingにはCodex再レビューを求める。自動再レビューされない場合は、同じhead・同じ種別の依頼が既にないことを確認してから既存連携の手動review依頼（`@codex review`）を1回使う。連投しない。Draftで自動レビューが起動しない場合も同様。
- CI failureは常にblocking。原因が環境でも成功扱いにせず、ログを残す。3周上限を越えた再試行、gate迂回、自己承認、未解決のままMergeはしない。

> [!NOTE]
> 詳細な設計方針、コーディング規約、データ管理については以下の設計書および **AGENTS.md** を参照してください。
> - [architecture.md](docs/architecture.md) (全体設計、PWA)
> - [development-guide.md](docs/development-guide.md) (ツール追加手順、命名規約、UI・ロジック分離、テスト)
> - [data-management.md](docs/data-management.md) (郵便番号チャンク、モデルのR2配信)
> - [analytics.md](docs/analytics.md) (計測基盤設計)
> - [seo.md](docs/seo.md) (SEO & 構造化データガイドライン)

---

## 1. 主要コマンド

```bash
npm run dev          # 開発サーバー起動 (localhost:4321)
npm run build        # 本番ビルド（WASM/WebMCP準備・Astro・OGP/SW生成・アセット検証）
npm run preview      # ビルド成果物のローカルプレビュー
npm run check        # Astro型チェック ＋ Biome静的解析
npm run lint         # Biome 静的解析の実行 (src/, tests/)
npm run lint:fix     # Biome 自動修正の適用
npm run test:unit    # コアロジックの単体テスト実行 (Node 22 --test)
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

### 2.1 4ファイル（+1）構成
新しいツールを追加する際は、以下の構成でファイルを配置します。
- **純粋ロジック:** `src/lib/tools/[name].ts`
- **React UI Island:** `src/components/tools/[Name].tsx` （UIとローカル状態管理）
- **LPコンテンツ:** `src/content/tools/[name].md` （title/description/useCases/howto/faq等のフロントマター）
- **Astro ページシェル:** `src/pages/[name].astro` （content collection を取得し `ToolLayout` に渡す）
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
