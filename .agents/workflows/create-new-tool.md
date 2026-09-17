---
description: Code:Life Cafe 用の新しいツールを追加する手順
---
# 新しいツールの追加ワークフロー

このワークフローは、`tools.codelife.cafe` に新しいツールを追加する際の手順です。

## 1. 事前準備 (Implementation Plan)
**コードを書き始める前に、必ず `Implementation Plan`（実装計画）を作成し、ユーザーに提案して承認を得てください。**
計画には、Notion TaskとAC、Risk Class（新規toolはR2以上）、ツール名、機能概要、作成ファイル、テスト計画を含めてください。

## 2. 実装手順
計画承認後は[add-tool](../skills/add-tool/SKILL.md)と[開発ガイド](../../docs/development-guide.md)に従います。4ファイル構成（ロジック・UI・LPコンテンツ・ページ）とcatalog登録を使い、index・Navigation・SearchModalへの手書き追加はしません。

Claude MakerがProductionとunit/E2E/regression testを担当し、lint/check/build/test後にDraft PRを作成します。Codexが両方を独立レビューします。レビュー修正・CI・人間承認の境界は[CLAUDE.md](../../CLAUDE.md)と[AGENTS.md](../../AGENTS.md)を参照してください。
