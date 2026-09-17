# AI開発フロー整理の実装計画

正本: [Notion計画](https://app.notion.com/p/3dadfd3603368134963dfd657f36d562)（2026-09-17取得）。
基点: `origin/main` / `674d787`。開始時の未コミット変更なし。

## 現状とGap Analysis

| 対象 | 確認結果 | 最小の対応 |
| --- | --- | --- |
| AGENTS.md / CLAUDE.md | 開発・テスト規約はあるがMakerと独立Reviewerの責任、Risk Class、feedback上限が未定義 | 既存ファイルに集約 |
| GitHub Actions | lint.ymlがlint・astro check・build後unit、e2e.ymlがbuild・desktop/mobile E2E。両者PRで起動 | 変更なし |
| Deploy | main pushでE2E成功後にdeploy。lintは別Workflow | 変更なし。Merge前に両PRチェックを必須とする手動確認を残す |
| 最新mainのCI | Lint & Type Check / Deploy to Cloudflare Pages成功（35017549583 / 35017550812） | 今回PRの結果とは分けて報告 |
| main ruleset（読取のみ） | 有効なrequired checksはlint/e2e。PR必須、承認必須人数0、thread resolutionと最新push承認は必須でない | 変更なし。R2/R3人間承認の運用確認を残す。旧branch protection APIの404は保護なしを意味しない |
| Claude設定・hook | Production/Tests編集禁止なし。編集後整形・対象unitの補助hookあり | 権限・hookを変更しない |
| Claude/Codex Agent定義 | UIレビュー用各1件。独立Test Engineerやorchestratorなし | 定義を保持。通常は起動不要と共通文書に明示 |
| .agents / .claude skills | add-tool / gen-test / hard-taskの実体が重複。gen-testが実装由来の期待値を誘導 | gen-testを両入口で修正。他の共通ルールは増殖させない |
| 新規tool手順 | create-new-toolが古い手書きナビ登録。add-toolにLP層不足と未定義の/ship依存 | 既存ガイド参照に整理 |
| PR template | なし | 1枚のみ追加 |
| Routine / Auto Review | repoにトリガー実装なし。既存RoutineがCodexコメントに応答することはユーザー確認済み | 既存外部連携を前提に規則だけ定義。ライブ受入はManual Setup Checklist |

## 範囲と進め方

1. AGENTS.mdに役割・Risk Class・Code Review Rules、CLAUDE.mdにMakerと修正ループを定義。
2. docs/ai-development-flow.mdに通常フロー、Optional QA、Manual Setup Checklistを集約。
3. 既存add-tool / gen-testの両入口とcreate-new-toolの矛盾のみ修正し、PRテンプレートを追加。
4. lint・check・build・unit・E2Eを実行可能な範囲で検証し、差分を確認してDraft PRへ提出。

新規toolやProduction改修はない。今回のAGENTS等の整理はユーザーが対象を明示した依頼であり、RoutineによるR4自動変更の許可にはしない。最終承認・merge・deployは行わない。
Workflow、依存、Agent framework、独自状態管理、既存権限、外部サービス設定は変更しない。
検証結果と未解決事項はPR本文に記録する。既存walkthrough.mdは別ツールの記録のため保持する。
