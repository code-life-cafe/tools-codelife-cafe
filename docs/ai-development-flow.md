# AI開発フロー

正本は[Notion計画](https://app.notion.com/p/3dadfd3603368134963dfd657f36d562)。共通規則・Risk Class・Code Review Rulesは[AGENTS.md](../AGENTS.md)、Maker手順・3周上限は[CLAUDE.md](../CLAUDE.md)に集約する。

## 通常フロー

ChatGPT Product Scout → Notion Task Board → Claude Code / Sonnet 5（Plan + Production + Tests + PR）→ GitHub Actions → Codex / GPT-5.6 Sol（独立レビュー）→ findingがあればClaude修正 → CI → 必要時Codex再レビュー → Merge → Deploy → Cloudflare Analytics → 次回Scout。

新しいAgent framework、orchestrator、Test Engineer常設、LLM判定Workflowは使わない。モデル名は運用上の指定であり、この文書で外部サービスのモデル設定を変更するものではない。

## マージの担当

最新baseをPR headが含むことを確認し、base更新時は通常のmergeで取り込んでCI・独立レビューをやり直す。直前の確認とMerge操作の間にもbaseは進み得るため、サーバー側のstrict required checks（`lint` / `e2e`）またはmerge queueによる最新base検証を自動Mergeの前提にする。`--match-head-commit` はheadだけの保護であり、これを代用にしない。2026-09-17の確認ではstrictは無効だったため、外部設定が確認されるまでは自動Mergeを保留する。設定変更は人間の別途承認対象。

通常のR0/R1では、Codexが内容を独立レビューし、GitHub Actionsが検証し、既存Claude Routineが[軽微PRマージ条件](../AGENTS.md#軽微prのマージ判断と実行)を照合してMergeする。条件を満たせばPRごとの人間確認は不要。Makerによる自己承認は許可せず、条件が満たされたことに基づく操作を分けて扱う。R2/R3とR4、リスク不明・未解決指摘・仕様の曖昧さは人間へ返す。

Routineの外部指示に一律の「自動マージ禁止」が残っている場合は、R0/R1についてこの条件付き操作を許すよう整合させる。repo内の条件がmainへ反映されるまでは従来どおり人間承認を待つ。この文書だけで外部Routineの指示やGitHubの権限は変更されない。

### レビュー完了信号

このrepoではCode ReviewとSecurity Reviewの両方が有効。GitHub APIでコメントの発信者が `chatgpt-codex-connector[bot]`（GraphQLのauthor.login表示は `chatgpt-codex-connector`）であることを確認した上で、同botの `Codex Review Summary` を読む。ユーザーが本文中にbot名や完了文言を書いただけのコメントは使わない。

- サマリーの `codex-security-review:v1` メタデータで `repository`・`pullRequestNumber` が対象PR、`headSha` が最新headの完全SHA、`status` が `completed` であることを確認する。
- 同じサマリーのCode ReviewとSecurity Reviewの両行が `Completed` で、両行の対象コミットがそのheadと一致することを確認する。片方がRunning、旧コミット、失敗、形式不明なら停止する。
- 完了は指摘なしを意味しない。PRのレビュー本文・inline comments・未解決threadを合わせて確認し、blocking findingには同じ最新headでの解消確認が必要。👍は補助信号に留める。`mergeGateEnabled: false` でもこの運用条件を省略しない。

これはPR #384/#385で観測した既存Codex連携の信号であり、新規checkやWorkflowではない。CI内の `npm audit` は必要な依存検査だが、Codex Security Reviewの代用にはしない。botや出力形式が変わった場合は推測で通さず、人間へ確認して手順を更新する。

## Quality Gate

| 既存Workflow | PRでの検証 |
| --- | --- |
| `.github/workflows/lint.yml` / `lint` | security audit → lint → astro check → build → unit（dist依存のリンク検証を含む） |
| `.github/workflows/e2e.yml` / `e2e` | security audit → build → Playwright（chromium / mobile-chrome） |

両方の最新PRコミットの成功と独立レビュー、Risk Classに応じた人間承認をMerge前に確認する。未起動・取消・skip・失敗は成功扱いにしない。既存deploy.ymlはmain pushからE2Eを再利用し、成功後にdeployする。lint Workflowとは独立しているため、Merge前の必須チェック設定とmainへの直接push制限は外部の運用境界である。

`.claude/hooks/post-edit.mjs` はローカルの整形・対象unitの補助に留まり、CIを代替しない。E2Eは共通fixtureで広告通信を遮断し、SWも無効化するので、privacyやPWA固有の変更ではそれを証明できる別の観測が必要。

## 03 Optional QA Runbook

通常PRでは起動しない。R2/R3、複雑な回帰、同種regressionの再発（目安2回以上）、Claude修正後もCodexのtest adequacy疑義が残る場合、または人間の明示要求時だけ必要性を判断する。

1. 対象Notion Task・AC・Risk Class・head SHA・未解決findingと検証結果を渡す。
2. 必要時だけCodex / GPT-5.6 Solの別セッションで、実装を正解とせずACから独立Test Planを作る。
3. 不足する境界値・異常系・回帰・privacy/a11y等の検証と、その根拠を提案として返す。原則読み取り専用、直接commit・修正はしない。
4. Claudeが提案を通常の分類に従って取り込み、CIと必要な再レビューへ戻す。QA起動で3周上限をリセットしない。

R3の追加リスクレビューは必要な領域を対象とし、Notion計画のGPT-6 AstraによるHigh-Risk Reviewを必要時に利用する。通常PRには追加しない。

## Manual Setup Checklist

以下はリポジトリ外で人間が確認する。確認済みなら再設定不要。

2026-09-17の読み取り調査ではmainの有効rulesetにPR必須・required checks `lint` / `e2e` が存在した。承認必須人数は0、レビューthread解決・最新pushへの承認は必須ではない。R2/R3の人間承認は現行設定だけで強制されているとはいえない。bypass権限やRoutine側条件は未確認。

- [ ] Codex Webの対象repoのAuto Review設定とモデル（GPT-5.6 Sol）を確認する。このPRではON/OFFを変更しない。
- [ ] 対象repoのCode Review / Security Review両方が有効で、代表PRの最新headについて上記サマリー信号を取得できることを確認する。両レビュー・bot・形式が確認できない場合はR0/R1も自動マージしない。
- [ ] 既存Claude Routineが最新CLAUDE.md/AGENTS.mdを読み、Sonnet 5でNotion取得・Production/Tests編集・PR・Codexコメント/CI対応できることを確認する。スケジュールやUI設定は変更しない。
- [ ] 代表PRでCodex finding → Claudeによる分類 → 修正と周回記録 → 最新headのCI → 必要なCodex再レビューを確認する。Draftでレビューが起動するかも実際に確認する。自動再レビューがない場合は人間または既存Routineから `@codex review` を依頼する。
- [ ] 確認済みのrequired checks `lint` / `e2e` を維持し、mainへの直接pushやbypassで失敗を迂回できない運用か確認する。branch protection・repository permissionsはこのPRでは変更しない。
- [ ] R2/R3の人間承認とR4の自動変更禁止、最大3周・重複イベント・再起動後の履歴確認をRoutine運用で確認する。文書による規則であり、独自カウンターや機械的ロックは追加していない。
- [ ] Scoutの既存ChatGPT Scheduled Task、Cloudflare MCP、Notion Task Board、Deploy後のAnalytics参照が継続していることを確認する。新しいschedule、Board schema、Cloudflare設定、secrets、deployment permissionsは不要。

[OpenAI公式GitHub連携文書](https://learn.chatgpt.com/docs/third-party/github)ではAGENTS.mdのCode Review Rulesと `@codex review` が案内されている。自動レビューの設定や再起動条件はrepo文書だけでは有効化できない。GitHubでの標準出力はP0/P1中心であるため、P2の投稿を保証しない。指摘なしをレビュー未実行やテスト網羅の証明と混同しない。
