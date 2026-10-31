## 対応Issue・Acceptance Criteria

- 対応Issue（Closes / Refs #）:
- Notion施策リンク（任意。分析・効果測定の参照元のみ）:
- 区分 / Risk Class: A（R0/R1）/ B（R2/R3）/ C（R4）（判定理由。B/Cは承認原文または参照リンクと、承認された範囲）
- ACと検証の対応:

## 変更概要

- 何を・なぜ変更したか:
- スコープ外・変更しなかった既存設定:
- 今回の最新コミット:
- 意図的に含めなかった未ステージ変更: なし / 詳細

## テスト・検証

- 追加・更新したunit / E2E / regression test（不要なら理由）:
- 実行コマンドと結果（lint / check / build / unit / E2E）:
- 最新コミットのCI結果・リンク:
- 未実行・失敗・未解決事項:

## 現在状態・待ち（Claude Codeが更新）

- 現在状態 / 次の一手:
- 待ち先（CI / 独立Claudeレビュー / 人間承認 / 利用上限）・待ち始め・再開条件:
- 対象head SHA:
- 公開SHA・本番確認（Merge後）:

## レビュー対応

- 修正ループ: 0/3
- 独立Claudeレビュー（実装者と別のサブエージェント。対象headの完全SHA・実行参照 `subagent:<ID>`・実装者参照 `makerRef`・round）:
- 独立した区分確認（A / 承認済みB / 承認済みC、同一headの実差分・AC・許可境界）:
  - `claude-review:v1` 記録のコメントリンク（形式は docs/ai-development-flow.md。scopeはcode/tests/security/classificationすべて確認、unverifiedは空）:
- finding / CI run → 分類 → 修正コミット → CI / 再レビュー結果:
- 残っているblocking / 人間判断事項:

## Manual Setup Checklist

- 外部サービスで必要な手動確認・設定（なければ「なし」）:

<!-- CI成功・最新headの独立Claudeレビュー（実装者と別のサブエージェント）と区分（A / 承認済みB / 承認済みC）の確認が揃うまではMergeしない。
Bは計画承認済みの範囲、Cは具体的な対象・差分・影響の承認を得た範囲のみ。承認がMerge/Deployを含むかは承認原文で確認する。
運用規則: AGENTS.md / CLAUDE.md / docs/ai-development-flow.md -->
