# AI開発フロー

現行の運用ルール（正本）は[Notion「現行運用ルール」](https://app.notion.com/p/406dfd36033681abbafce47bac685278)。以前の正本だったNotion計画（アーカイブ済み）は参照しない。実行時はこのrepoの最新[AGENTS.md](../AGENTS.md)・[CLAUDE.md](../CLAUDE.md)・本書と個別の人間承認を確認する。共通規則・Risk Class・Code Review Rulesは[AGENTS.md](../AGENTS.md)、Maker手順・3周上限は[CLAUDE.md](../CLAUDE.md)に集約する。旧Notion Task Board・Agent Readyは新規開発の着手許可に使わない。

## 役割と管理場所

| 担当 | 役割 | 管理場所 |
| --- | --- | --- |
| Claude Code | 主実装。調査・計画・実装・必要なテスト・PR・CI修正・レビュー指摘対応・許可範囲の本番確認 | GitHub Issue / PR |
| 独立Claudeレビュー（読み取り専用サブエージェント） | 最終head SHAのコード・テスト・セキュリティ・区分を実装者と別コンテキストで確認。実装・直接修正・自己承認はしない | PRのレビュー記録（`claude-review:v1`） |
| ChatGPT | アクセス解析・SEO/GEO・仮説・優先順位・効果測定 | Notion |
| GitHub Actions | 決定論的Quality Gate | PRのcheck |

- 実装のAC・状態・承認・検証・レビュー・公開SHAはIssue/PRに集約する。Notionには分析・施策・効果と、実装Issue/PRへのリンクだけを置く。実装IssueとNotion施策は相互にリンクし、開発状態を二重管理しない。
- 既存のNotionタスクは履歴として保持する。未実装分は、GitHubの既存Issue/PRと重複確認してからIssueにする。

## 通常フロー

ChatGPT（Notionで分析・施策）→ GitHub Issue（AC・Risk Class）→ Claude Code（調査・計画・実装・テスト・Draft PR）→ GitHub Actions → 独立Claudeレビュー（最終headを別サブエージェントが読み取り専用で確認）→ findingがあればClaude Code修正（最大3周）→ CI → 新headの再レビュー → 区分に応じた承認（A不要・Bは計画承認済み・Cは対象別承認）→ Merge → Deploy・許可範囲の本番確認 → ChatGPT（効果測定）。

新しいAgent framework、orchestrator、Test Engineer常設、LLM判定Workflowは使わない。モデル選択・worktreeの規則は[AGENTS.md](../AGENTS.md#モデル選択worktree)に従う。この文書で外部サービスのモデル設定・権限・スケジュールを変更するものではない。

### 待ち状態の記録

Claude CodeはPR作成・レビュー依頼で担当を終えず、Issue/PRに次を残して更新する: 現在状態、次の一手、待ち先（CI / 独立Claudeレビュー / 人間承認 / 利用上限）、待ち始め、再開条件、対象head SHA。CI・レビューの完了・失敗・指摘後の対応はClaude Codeが担当する。既存の定期確認と実際に利用できるイベント応答だけを使い、未設定の自動再開は保証しない。利用上限時は別の実装者へ自動で切り替えず、待ち状態と再開条件を明記して止める。同じheadに同じ種別のレビューを重ねない（変更も新しい失敗もなければ再実行しない）。

### 進行照合（読み取り専用）

`node scripts/pr-gate-status.mjs <PR番号> [--issue N]` は、GitHubの公開REST（認証があればGraphQLの未解決thread）をGETだけで取り直し、PRがいまどの待ちにあるかを `state` で返す。Merge・コメント投稿・review依頼は行わず、Merge許可でもない。古いPR本文や集約表示を正本にせず、毎回対象head SHAで取得する。コメント・check-run・review・threadは全ページ取得し、ページ上限や途中失敗は「不完全」として扱う。取得の最後にPRを読み直し、途中でhead/baseが変わっていれば再取得を要求する。取得失敗・未知形式・旧SHA・Code対象SHA欠落・矛盾は合格にせず、`wait-*` か `blocked`（`retriable`）に倒す。環境のproxyを使う場合は `NODE_USE_ENV_PROXY=1` を付ける。

| state | 意味と次の一手 |
| --- | --- |
| `ready` | Draftで対象headの必須CIが成功。Ready化し、最終headを別サブエージェントのレビューに出す |
| `sync-base` | headが最新baseより遅れている。通常mergeで取り込み、新headのCI・レビューを再照合 |
| `wait-ci` / `wait-review` | 対象head向けのCI（rulesetの必須checkと連携app一致）/ 同一headの独立Claudeレビュー記録が未成立（未実施・取得不能=`unavailable`・旧SHA=`stale`・形式不正/矛盾=`unknown`）。技術待ち（修正周回に数えない）。レビュー記録が無い間は必ずここで止まり、無条件Mergeにしない |
| `blocked` | CI失敗、競合、未解決指摘・thread、人間の変更要求、3周超過、未承認B/C、rules・bypass・thread・履歴を確認できない等。`retriable` が真なら取得を再試行 |
| `merge-ready` | 全条件成立。Merge直前に再取得し、既存の操作主体が `--match-head-commit` で通常Merge（照合とMergeは別操作） |
| `wait-deploy` / `verify-production` / `close` / `done` | Merge後。既存Deploy待ち → 公開検証 → Issueのclose（効果測定はNotionへ引継ぎ） |

### 独立レビュー記録（claude-review:v1）

独立レビューの自動証拠は、PRコメントに残す次の構造化マーカー**だけ**。Codex由来のマーカー（`codex-*`）・botの投稿・自由文の「レビュー済み」・短SHAは証拠にしない。

```
<!-- claude-review:v1 {"repository":"code-life-cafe/tools-codelife-cafe","pullRequestNumber":N,"headSha":"<40桁>","reviewerRef":"subagent:<実行ID>","makerRef":"thread:<実装セッション参照>","round":1,"status":"completed","scope":{"code":true,"tests":true,"security":true,"classification":true},"findings":[{"id":"F1","severity":"P1","blocking":true,"status":"open","evidence":"ファイル:行 と根拠"}],"unverified":[],"classification":{"class":"A","risk":"R1","approvalStatus":"not-required","approvalRef":null,"unapprovedScope":[]}} -->
```

- 投稿者は人間アカウント(type=User)かつ `author_association` が OWNER/MEMBER/COLLABORATOR のコメント(第三者のコメントで記録を上書きさせない)。実装者と別のサブエージェントの結果を、主担当（Claude Code）がそのまま転記する。Botの投稿は採用しない。
- `reviewerRef` は `subagent:` で始まる別実行の参照、`makerRef` は実装者の参照。同一値・欠落・形式不正は不合格。**これは記録上の別担当の確認であり、暗号学的な真正性の証明ではない**。偽装対策のための新しい資格情報・サービスは導入しない。PR上でレビュー依頼のプロンプトと結果を残し、人間が監査できるようにする。
- `headSha` は完全SHA。push後は旧記録が失効し、新headで再レビューする。`scope` はコード・テスト・セキュリティ・区分の4つすべて `true`。`unverified` が空でない記録は合格にしない。
- `findings` の `blocking` かつ `status:"open"` が残る間は `blocked`（修正周回に計上）。解消は新headの再レビュー記録で `fixed-verified`（または根拠付きの `dismissed`）にする。`evidence` は必須。
- `classification` は[AGENTS.md](../AGENTS.md#risk-class-と承認の3段階)の区分（`class` A/B/C と `risk`、`approvalStatus` が `not-required` / `approved` / `unapproved`、`approvalRef`、`unapprovedScope`）。B/Cは承認の参照が空でなく未承認範囲が空の `approved` だけ継続する。R3は `additionalRiskReview: true`（追加の独立リスクレビューの記録）が必要。AIの自己申告だけで承認を作らない。
- 同じheadで記録が複数ある場合は最新（更新時刻）が有効。同時刻で内容が異なる、時刻が不正、マーカーが壊れている・重複している場合は `unknown`（fail-closed）。
- 機械的に取得できない場合は `unavailable`（`review-evidence-unavailable`）としてMergeしない。

レビューの実行は [.claude/agents/independent-reviewer.md](../.claude/agents/independent-reviewer.md) のサブエージェントを、Claude Code本体とは別の実行として起動する。対象PRの完全SHA・ACと、`git diff` を書き出した作業用ファイルのパスを渡す（レビュー担当はRead/Grep/Globのみで、書き込み・実行はできない）。実装者の説明だけで合格にせず、実差分・AC・テストを読んだ結果を返させる。

**公開後の検証**は、既存の `deploy.yml` にある `production-smoke` ジョブの結果だけを自動の証拠にする。`deploy` ジョブで `dist/build-info.json`（コミットSHA・run ID。公開リポジトリで既知の値のみ）をbuild後・公開前に生成して公開し、`production-smoke` が固定の公開URL（tools.codelife.cafe）に対して、HTTP 200、`build-info.json` のSHAが今回のmerge SHAと一致すること（CDN反映待ちで最大約5分再試行）、既知の短いダミー入力でのワードクラウド生成・再生成を確認する。計測は `X-CLC-Synthetic` と計測リクエストの遮断で汚さない。結果（run ID・attempt・merge SHA・URL・HTTP・操作結果）は job summary と artifact `production-smoke-<run>-<attempt>` に残る。通信（本文読取を含む）には1回15秒、全体に約5分（スクリプト全体は10分、jobは20分）の上限があり、期限切れでも失敗の証拠を保存する。Merge後の判定は、Deploy runの集約表示（in_progressのまま残ることがある）を待たず、同じrun・attemptの `deploy` と `production-smoke` の両jobの完了・成功で判断し、1つでも未完了・失敗・欠落・別attemptなら進めない。進行照合のREST/GraphQLにも1回20秒・全体3分の上限がある。失敗はジョブ失敗＝公開確認失敗で、Deploy成功とは区別する。本番の実ブラウザでの目視やダウンロード内容までは含まない。誰かのコメント文字列は公開確認の証拠にしない。`production-smoke` が無いDeploy（導入前のrun）は `verify-production` として手動確認する。復旧はこの差分のrevert。

PR購読（`subscribe_pr_activity`）はCI・レビュー・merge等のイベントで再開する実在の手段。複数PRが依存する場合は、各PRを購読し、イベントごとに本スクリプトで再取得して次の一手だけを実行する。日次21時・週次月08:52の読み取り専用の棚卸しを実装トリガーにはしない。

## マージの担当

最新baseをPR headが含むことを確認し、base更新時は通常のmergeで取り込んでCI・独立レビューをやり直す。直前の確認とMerge操作の間にもbaseは進み得るため、サーバー側のstrict required checks（`lint` / `e2e`）による最新base検証を自動Mergeの前提にする。`--match-head-commit` はheadだけの保護であり、これを代用にしない。2026-09-17に人間の個別承認を得て既存mainルールのstrictだけを有効化し、読み戻し確認済み。実行時にも有効であることを確認し、無効と確認できた場合は自動Mergeを保留して人間へ返す。一時的な取得失敗や確認不能は技術待ちとして再照合し、有効と確認できるまでMergeしない（取得不能が継続して自力で解決できない場合に限り、理由を報告して判断を求める）。merge queueは現在のWorkflowでは未対応のため使用しない。

承認の3段階（A=R0/R1、B=R2/R3、C=R4）の定義は[AGENTS.md](../AGENTS.md#risk-class-と承認の3段階)に従う。A（R0/R1）は個別の人間確認なし、Bは計画の一度の承認、Cは具体的な対象・差分・影響の人間承認。Mergeまでの流れは次のとおり。

- 実装者と別のClaudeサブエージェントが、コード・テスト・セキュリティを確認し、同じ最終headの実差分・AC・許可境界をA、承認済みB、今回承認済みCのいずれかに分類して `claude-review:v1` 記録としてPRに残す。「重大な指摘なし」だけでは分類確認にならない。分類が矛盾する場合は厳しい側に倒し、未承認の範囲だけを人間へ返す。
- GitHub Actionsが客観的に検証する。
- 操作主体（既存Claude Routine、またはClaude Codeプロジェクト `tools.codelife.cafe 保守`（`chan_01BLscqs8eCg8fzAnUt8YFrw`）とその担当スレッド）が、[PRマージ条件](../AGENTS.md#prのマージ判断と実行)の全条件を照合してMergeする。人間が会話で対象PRのMergeを特定のエージェントへ指示した場合は、そのPRだけ当該エージェントが操作できる。常設担当は増やさない。独立判断と、その後の条件照合つきMerge操作を分け、Makerの自己承認は許可しない。別の常設Merge専用Agentは作らない。
- 承認済みのB/Cは、区分名だけで再度人間に止めない。人間へ返すのは、未承認のB/C、ACや禁止範囲の変更、意味の判断が必要な競合、3周でblockingが解消しない場合、本人の認証が必要な場合だけ。R3の追加独立リスクレビューは維持する。
- CI / レビューのRunning、一時的な取得失敗、利用上限は技術待ち。既存のPR購読等の実在する再開手段で続け、同じheadの連投・無限の再試行・未確認のMergeはしない。待ち状態の照合は修正3周に数えない。通常はDraftで作成し、CI成功後にReadyにして、最終headを別サブエージェントのレビューに出す（同じheadを重ねてレビューしない）。
- 完全な無人化は実測で確認できた範囲だけを報告する。

これは2026-10-28のmarumoの承認に基づく運用で、今回承認された操作範囲（指定Claudeプロジェクトによる条件付きMerge操作を含む）を反映したもので、GitHubトークン・ruleset等の技術的権限、新スケジューラ・Workflow・サービス・課金は追加・変更しない。日次21時・週次月08:52の読み取り専用の棚卸しは、実装やMergeを担当するものへ拡張しない。

この文書だけで外部Routineの指示やGitHubの権限は変更されない。外部の指示に上記と矛盾する記述が残っている場合は、外部設定側を整合させる。

### レビュー完了信号

完了信号は上記の独立レビュー記録（`claude-review:v1`）だけ。ローカルの自己点検・実装セッション自身の「確認した」という報告・コメント不在・Codex等の旧信号は代替にならない。記録が未取得・旧SHA・形式不正の間は未確認としてMergeせず、`wait-review` で再照合する（技術待ち。修正3周に数えない）。レビュー用サブエージェントを起動できない場合（利用上限等）は待ち状態と再開条件を記録して止め、他のモデルやCodexへ自動で切り替えない。CI内の `npm audit` は必要な依存検査だが、独立レビューの代用にはしない。旧Grok Bot運用ループ・Codex連携は歴史記録であり、現行フローでは使わない（[AGENTS.md](../AGENTS.md#歴史記録-旧運用と旧例外)）。

進行照合は `reviewState` で `clean`・`findings`（blocking未解決）・`unavailable`（記録なし）・`stale`（旧head）・`unknown`（形式不正・矛盾・未確認項目・時刻不正）を区別する。不明値を合格にも実指摘にも補完しない。`unavailable` / `stale` / `unknown` は `wait-review`（修正提案・修正周回消費なし）、`findings` は `blocked` とする。

## Quality Gate

依存検査は[依存脆弱性の運用](dependency-security.md)に従い、既存分を報告し、新規・悪化分を全重大度で停止する。監査不能も停止する。デプロイは直前の正常デプロイSHAを比較元にする。

| 既存Workflow | PRでの検証 |
| --- | --- |
| `.github/workflows/lint.yml` / `lint` | security audit → lint → astro check → build → unit（dist依存のリンク検証を含む） |
| `.github/workflows/e2e.yml` / `e2e` | security audit → build → Playwright（chromium / mobile-chrome） |

両方の最新PRコミットの成功と独立レビュー、Risk Classに応じた人間承認をMerge前に確認する。未起動・取消・skip・失敗は成功扱いにしない。既存deploy.ymlはmain pushからE2Eを再利用し、成功後にdeployする。lint Workflowとは独立しているため、Merge前の必須チェック設定とmainへの直接push制限は外部の運用境界である。

`.claude/hooks/post-edit.mjs` はローカルの整形・対象unitの補助に留まり、CIを代替しない。E2Eは共通fixtureで広告通信を遮断し、SWも無効化するので、privacyやPWA固有の変更ではそれを証明できる別の観測が必要。

## 03 Optional QA Runbook

通常PRでは起動しない。R2/R3、複雑な回帰、同種regressionの再発（目安2回以上）、Claude修正後も独立レビューのtest adequacy疑義が残る場合、または人間の明示要求時だけ必要性を判断する。

1. 対象Issue・AC・Risk Class・head SHA・未解決findingと検証結果を渡す。
2. 必要時だけ実装者と別のサブエージェントで、実装を正解とせずACから独立Test Planを作る。
3. 不足する境界値・異常系・回帰・privacy/a11y等の検証と、その根拠を提案として返す。原則読み取り専用、直接commit・修正はしない。
4. Makerが提案を通常の分類に従って取り込み、CIと必要な再レビューへ戻す。QA起動で3周上限をリセットしない。

R3の追加リスクレビューは必要な領域を対象とし、必要な領域について、実装者と異なるサブエージェント実行による追加リスクレビュー（High-Risk Review）を維持し、理由を報告に残す。Maker側の確認（[モデル選択](../AGENTS.md#モデル選択worktree)の重の段階など）はその代替にならない。通常PRには追加しない。

## Manual Setup Checklist

以下はリポジトリ外で人間が確認する。確認済みなら再設定不要。

2026-09-17の読み取り調査ではmainの有効rulesetにPR必須・required checks `lint` / `e2e` が存在した。承認必須人数は0、レビューthread解決・最新pushへの承認は必須ではない。B（R2/R3）の計画承認やC（R4）の対象別承認は現行設定だけで強制されているとはいえない。bypass権限やRoutine側条件は未確認。

- [x] Codexの自動Code/Security Reviewは全リポジトリで停止済み（2026-10-31、ユーザーが実施）。再開しない。
- [ ] Claude Codeが最新CLAUDE.md/AGENTS.mdを読み、IssueからのAC取得・Production/Tests編集・Draft PR・独立レビュー依頼・CI対応・待ち状態の記録までMakerとして実行できることを確認する。スケジュールやUI設定は変更しない。
- [ ] 代表PRでレビューfinding → Makerによる分類 → 修正と周回記録 → 最新headのCI → 新headの独立再レビューを確認する（Issue #538の一巡検証）。外部Routineからの自然起動で同じ流れが完走することは未実証。設定保存・手動一巡・自然実行は分けて報告する。
- [ ] 確認済みのrequired checks `lint` / `e2e` を維持し、mainへの直接pushやbypassで失敗を迂回できない運用か確認する。branch protection・repository permissionsはこのPRでは変更しない。
- [ ] B（R2/R3）の計画承認とC（R4）の対象別承認、最大3周・重複イベント・再起動後の履歴確認をRoutine運用で確認する。文書による規則であり、独自カウンターや機械的ロックは追加していない。
- [ ] ChatGPTのNotionでの分析・施策・効果測定が、実装Issue/PRへのリンクを保って継続していることを確認する。新しいschedule、Notion DBの新設、Cloudflare設定、secrets、deployment permissionsは不要。

### 履歴: 旧Codex信号の扱い（Issue #534・#538）

Codexのサマリー・分類マーカー（`codex-review-state:v1` / `codex-security-review:v1` / `codex-classification:v1`）は、2026-10-31のClaude単独運用への切替（Issue #538）で信頼元から外した。過去PRのCodex指摘や分類は履歴として残し、一括解決・抹消しない。必要なら主担当が根拠を付けて閉じる。Security構造化結果がnullになる既知不具合の限定例外（[承認とMergeの詳細](approval-and-merge-rules.md)）は、Codex信号の廃止に伴い現行手順では使わない。

異常時の復旧は自動操作の停止と、Issue/PRへの対象head・待ち先・待ち始め・取得できない証拠・再開条件の記録。既存の購読等で再照合し、未知結果を実指摘と混同して処理を継続しない。取得不能が継続する場合は必要な判断だけを人間へ求める。
