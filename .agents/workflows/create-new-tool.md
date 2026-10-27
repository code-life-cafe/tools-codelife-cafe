---
description: Code:Life Cafe 用の新しいツールを追加する手順
---
# 新しいツールの追加ワークフロー

このワークフローは、`tools.codelife.cafe` に新しいツールを追加する際の手順です。

## 1. 事前準備 (Implementation Plan)
**コードを書き始める前に、必ず `Implementation Plan`（実装計画）を作成し、ユーザーに提案して承認を得てください。**
計画には、GitHub IssueとAC（Notion施策がある場合はそのリンク）、Risk Class（新規toolはR2以上）、ツール名、機能概要、作成ファイル、テスト計画を含めてください。

## 2. 実装手順
計画承認後は[add-tool](../skills/add-tool/SKILL.md)と[開発ガイド](../../docs/development-guide.md)に従います。4ファイル構成（ロジック・UI・LPコンテンツ・ページ）とcatalog登録を使い、index・Navigation・SearchModalへの手書き追加はしません。

Claude CodeがProductionとunit/E2E/regression testを担当し、lint/check/build/test後にDraft PRを作成します。Codexが最終headのCode/Security Reviewで両方を独立レビューします。PR作成後もCI・レビュー指摘への対応と待ち状態のIssue/PRへの記録はClaude Codeが担当します。レビュー修正・CI・人間承認の境界は[CLAUDE.md](../../CLAUDE.md)と[AGENTS.md](../../AGENTS.md)を参照してください。
