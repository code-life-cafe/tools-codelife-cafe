# AI開発フロー

現行の運用ルール（正本）は[Notion「現行運用ルール」](https://app.notion.com/p/406dfd36033681abbafce47bac685278)。以前の正本だったNotion計画（アーカイブ済み）は参照しない。実行時はこのrepoの最新[AGENTS.md](../AGENTS.md)・[CLAUDE.md](../CLAUDE.md)・本書と個別の人間承認を確認する。共通規則・Risk Class・Code Review Rulesは[AGENTS.md](../AGENTS.md)、Maker手順・3周上限は[CLAUDE.md](../CLAUDE.md)に集約する。旧Notion Task Board・Agent Readyは新規開発の着手許可に使わない。

## 役割と管理場所

| 担当 | 役割 | 管理場所 |
| --- | --- | --- |
| Claude Code | 主実装。調査・計画・実装・必要なテスト・PR・CI修正・レビュー指摘対応・許可範囲の本番確認 | GitHub Issue / PR |
| Codex | 最終head SHAのCode/Security自動独立レビュー。実装・直接修正・自己承認はしない | PRのレビュー |
| ChatGPT | アクセス解析・SEO/GEO・仮説・優先順位・効果測定 | Notion |
| GitHub Actions | 決定論的Quality Gate | PRのcheck |

- 実装のAC・状態・承認・検証・レビュー・公開SHAはIssue/PRに集約する。Notionには分析・施策・効果と、実装Issue/PRへのリンクだけを置く。実装IssueとNotion施策は相互にリンクし、開発状態を二重管理しない。
- 既存のNotionタスクは履歴として保持する。未実装分は、GitHubの既存Issue/PRと重複確認してからIssueにする。

## 通常フロー

ChatGPT（Notionで分析・施策）→ GitHub Issue（AC・Risk Class）→ Claude Code（調査・計画・実装・テスト・Draft PR）→ GitHub Actions → Codex（最終headのCode/Securityレビュー）→ findingがあればClaude Code修正（最大3周）→ CI → 必要時再レビュー → 必要な人間承認 → Merge → Deploy・許可範囲の本番確認 → ChatGPT（効果測定）。

新しいAgent framework、orchestrator、Test Engineer常設、LLM判定Workflowは使わない。モデル選択・worktreeの規則は[AGENTS.md](../AGENTS.md#モデル選択worktree)に従う。この文書で外部サービスのモデル設定・権限・スケジュールを変更するものではない。

### 待ち状態の記録

Claude CodeはPR作成・レビュー依頼で担当を終えず、Issue/PRに次を残して更新する: 現在状態、次の一手、待ち先（CI / Codexレビュー / 人間承認 / 利用上限）、待ち始め、再開条件、対象head SHA。CI・レビューの完了・失敗・指摘後の対応はClaude Codeが担当する。既存の定期確認と実際に利用できるイベント応答だけを使い、未設定の自動再開は保証しない。利用上限時は別の実装者へ自動で切り替えず、待ち状態と再開条件を明記して止める。同じhead・同じ種別のレビュー依頼を連投しない。

## マージの担当

最新baseをPR headが含むことを確認し、base更新時は通常のmergeで取り込んでCI・独立レビューをやり直す。直前の確認とMerge操作の間にもbaseは進み得るため、サーバー側のstrict required checks（`lint` / `e2e`）による最新base検証を自動Mergeの前提にする。`--match-head-commit` はheadだけの保護であり、これを代用にしない。2026-09-17に人間の個別承認を得て既存mainルールのstrictだけを有効化し、読み戻し確認済み。実行時にも有効であることを確認し、確認不可・無効なら自動Mergeを保留する。merge queueは現在のWorkflowでは未対応のため使用しない。

通常のR0/R1では、CodexのCode/Security Reviewが内容を独立レビューし、GitHub Actionsが検証し、Maker（Claude Code）以外の既存の担当が[軽微PRマージ条件](../AGENTS.md#軽微prのマージ判断と実行)を照合してMergeする。条件を満たせばPRごとの人間確認は不要。Makerによる自己承認とMergeは許可しない。R2/R3とR4、リスク不明・未解決指摘・仕様の曖昧さは人間へ返す。R4は個別依頼があってもマージ承認を兼ねない。

この文書だけで外部Routineの指示やGitHubの権限は変更されない。外部の指示にR0/R1の条件付きMergeと矛盾する記述が残っている場合は、人間が外部設定側を整合させる。

### レビュー完了信号

このrepoではCode ReviewとSecurity Reviewの両方が有効。GitHub APIでコメントの発信者が `chatgpt-codex-connector[bot]`（GraphQLのauthor.login表示は `chatgpt-codex-connector`）であることを確認した上で、同botの `Codex Review Summary` を読む。ユーザーが本文中にbot名や完了文言を書いただけのコメントは使わない。

- サマリーの `codex-security-review:v1` メタデータで `repository`・`pullRequestNumber` が対象PR、`headSha` が最新headの完全SHA、`status` が `completed` であることを確認する。
- 同じサマリーのCode ReviewとSecurity Reviewの両行が `Completed` で、両行の対象コミットがそのheadと一致することを確認する。片方がRunning、旧コミット、失敗、形式不明なら停止する。
- 完了は指摘なしを意味しない。PRのレビュー本文・inline comments・未解決threadを合わせて確認し、blocking findingには同じ最新headでの解消確認が必要。👍は補助信号に留める。`mergeGateEnabled: false` でもこの運用条件を省略しない。
- ローカルCLIレビュー・Maker自身の確認・コメント不在はこの信号の代替にならない。bot信号を確認できない場合はR0/R1も自動Mergeせず、人間へ返す。旧Grok Bot運用ループのローカルCLIレビュー代替は歴史記録であり、現行フローでは使わない（[AGENTS.md](../AGENTS.md#歴史記録-旧運用と旧例外)）。

これはPR #384/#385で観測した既存Codex連携の信号であり、新規checkやWorkflowではない。CI内の `npm audit` は必要な依存検査だが、Codex Security Reviewの代用にはしない。botや出力形式が変わった場合は推測で通さず、人間へ確認して手順を更新する。

## Quality Gate

依存検査は[依存脆弱性の運用](dependency-security.md)に従い、既存分を報告し、新規・悪化分を全重大度で停止する。監査不能も停止する。デプロイは直前の正常デプロイSHAを比較元にする。

| 既存Workflow | PRでの検証 |
| --- | --- |
| `.github/workflows/lint.yml` / `lint` | security audit → lint → astro check → build → unit（dist依存のリンク検証を含む） |
| `.github/workflows/e2e.yml` / `e2e` | security audit → build → Playwright（chromium / mobile-chrome） |

両方の最新PRコミットの成功と独立レビュー、Risk Classに応じた人間承認をMerge前に確認する。未起動・取消・skip・失敗は成功扱いにしない。既存deploy.ymlはmain pushからE2Eを再利用し、成功後にdeployする。lint Workflowとは独立しているため、Merge前の必須チェック設定とmainへの直接push制限は外部の運用境界である。

`.claude/hooks/post-edit.mjs` はローカルの整形・対象unitの補助に留まり、CIを代替しない。E2Eは共通fixtureで広告通信を遮断し、SWも無効化するので、privacyやPWA固有の変更ではそれを証明できる別の観測が必要。

## 03 Optional QA Runbook

通常PRでは起動しない。R2/R3、複雑な回帰、同種regressionの再発（目安2回以上）、Claude修正後もCodexのtest adequacy疑義が残る場合、または人間の明示要求時だけ必要性を判断する。

1. 対象Issue・AC・Risk Class・head SHA・未解決findingと検証結果を渡す。
2. 必要時だけ実装者と別のセッション（原則Codexレビュー）で、実装を正解とせずACから独立Test Planを作る。
3. 不足する境界値・異常系・回帰・privacy/a11y等の検証と、その根拠を提案として返す。原則読み取り専用、直接commit・修正はしない。
4. Makerが提案を通常の分類に従って取り込み、CIと必要な再レビューへ戻す。QA起動で3周上限をリセットしない。

R3の追加リスクレビューは必要な領域を対象とし、必要時に[モデル選択](../AGENTS.md#モデル選択worktree)の重の段階（Claude Opus）でMaker側の追加確認を行い、理由を報告に残す。独立レビューはCodexのCode/Security Reviewのまま変えない。通常PRには追加しない。

## Manual Setup Checklist

以下はリポジトリ外で人間が確認する。確認済みなら再設定不要。

2026-09-17の読み取り調査ではmainの有効rulesetにPR必須・required checks `lint` / `e2e` が存在した。承認必須人数は0、レビューthread解決・最新pushへの承認は必須ではない。R2/R3の人間承認は現行設定だけで強制されているとはいえない。bypass権限やRoutine側条件は未確認。

- [ ] Codex Webの対象repoのAuto Review設定とモデルを確認する。ON/OFF・モデルは変更しない。
- [ ] 対象repoのCode Review / Security Review両方が有効で、代表PRの最新headについて上記サマリー信号を取得できることを確認する。R0/R1の自動マージは、このbot信号を確認できた場合に限り行い、確認できない場合は保留する。
- [ ] Claude Codeが最新CLAUDE.md/AGENTS.mdを読み、IssueからのAC取得・Production/Tests編集・Draft PR・Codexコメント/CI対応・待ち状態の記録までMakerとして実行できることを確認する。スケジュールやUI設定は変更しない。
- [ ] 代表PRでレビューfinding → Makerによる分類 → 修正と周回記録 → 最新headのCI → 必要なCodex再レビューを確認する。Draftでレビューが起動するかも実際に確認する。自動再レビューがない場合は、同じhead・同じ種別の依頼がないことを確認して `@codex review` を依頼する。
- [ ] 確認済みのrequired checks `lint` / `e2e` を維持し、mainへの直接pushやbypassで失敗を迂回できない運用か確認する。branch protection・repository permissionsはこのPRでは変更しない。
- [ ] R2/R3の人間承認とR4の自動変更禁止、最大3周・重複イベント・再起動後の履歴確認をRoutine運用で確認する。文書による規則であり、独自カウンターや機械的ロックは追加していない。
- [ ] ChatGPTのNotionでの分析・施策・効果測定が、実装Issue/PRへのリンクを保って継続していることを確認する。新しいschedule、Notion DBの新設、Cloudflare設定、secrets、deployment permissionsは不要。

[OpenAI公式GitHub連携文書](https://learn.chatgpt.com/docs/third-party/github)ではAGENTS.mdのCode Review Rulesと `@codex review` が案内されている。自動レビューの設定や再起動条件はrepo文書だけでは有効化できない。GitHubでの標準出力はP0/P1中心であるため、P2の投稿を保証しない。指摘なしをレビュー未実行やテスト網羅の証明と混同しない。
