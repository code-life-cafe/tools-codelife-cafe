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

ChatGPT（Notionで分析・施策）→ GitHub Issue（AC・Risk Class）→ Claude Code（調査・計画・実装・テスト・Draft PR）→ GitHub Actions → Codex（最終headのCode/Securityレビュー）→ findingがあればClaude Code修正（最大3周）→ CI → 必要時再レビュー → 区分に応じた承認（A不要・Bは計画承認済み・Cは対象別承認）→ Merge → Deploy・許可範囲の本番確認 → ChatGPT（効果測定）。

新しいAgent framework、orchestrator、Test Engineer常設、LLM判定Workflowは使わない。モデル選択・worktreeの規則は[AGENTS.md](../AGENTS.md#モデル選択worktree)に従う。この文書で外部サービスのモデル設定・権限・スケジュールを変更するものではない。

### 待ち状態の記録

Claude CodeはPR作成・レビュー依頼で担当を終えず、Issue/PRに次を残して更新する: 現在状態、次の一手、待ち先（CI / Codexレビュー / 人間承認 / 利用上限）、待ち始め、再開条件、対象head SHA。CI・レビューの完了・失敗・指摘後の対応はClaude Codeが担当する。既存の定期確認と実際に利用できるイベント応答だけを使い、未設定の自動再開は保証しない。利用上限時は別の実装者へ自動で切り替えず、待ち状態と再開条件を明記して止める。同じhead・同じ種別のレビュー依頼を連投しない。

### 進行照合（読み取り専用）

`node scripts/pr-gate-status.mjs <PR番号> [--issue N]` は、GitHubの公開REST（認証があればGraphQLの未解決thread）をGETだけで取り直し、PRがいまどの待ちにあるかを `state` で返す。Merge・コメント投稿・review依頼は行わず、Merge許可でもない。古いPR本文や集約表示を正本にせず、毎回対象head SHAで取得する。コメント・check-run・review・threadは全ページ取得し、ページ上限や途中失敗は「不完全」として扱う。取得の最後にPRを読み直し、途中でhead/baseが変わっていれば再取得を要求する。取得失敗・未知形式・旧SHA・Code対象SHA欠落・矛盾は合格にせず、`wait-*` か `blocked`（`retriable`）に倒す。環境のproxyを使う場合は `NODE_USE_ENV_PROXY=1` を付ける。

| state | 意味と次の一手 |
| --- | --- |
| `ready` | Draftで対象headの必須CIが成功。Ready化して自動レビューを受ける（手動依頼との二重起動をしない） |
| `sync-base` | headが最新baseより遅れている。通常mergeで取り込み、新headのCI・レビューを再照合 |
| `wait-ci` / `wait-review` / `wait-classification` | 対象head向けのCI（rulesetの必須checkと連携app一致）/ Codex Code・Security完了 / 同一headの独立分類が未成立。技術待ち（修正周回に数えない） |
| `blocked` | CI失敗、競合、未解決指摘・thread、人間の変更要求、3周超過、未承認B/C、rules・bypass・thread・履歴を確認できない等。`retriable` が真なら取得を再試行 |
| `merge-ready` | 全条件成立。Merge直前に再取得し、既存の操作主体が `--match-head-commit` で通常Merge（照合とMergeは別操作） |
| `wait-deploy` / `verify-production` / `close` / `done` | Merge後。既存Deploy待ち → 公開検証 → Issueのclose（効果測定はNotionへ引継ぎ） |

**独立分類の自動証拠**は、Codex連携bot（`chatgpt-codex-connector[bot]`、type=Bot）が同じheadについて出す `codex-classification:v1` マーカーだけ。`repository` / `pullRequestNumber` / `headSha`（完全SHA）/ `class`（A/B/C）/ `risk`（A=R0・R1、B=R2・R3、C=R4）/ `approvalStatus`（`not-required` / `approved` / `unapproved`）/ `approvalRef`（文字列またはnull）/ `unapprovedScope`（配列）を必須とし、欠落・型不明・矛盾は補完せず無効。同一headに未承認の旧判定がある状態で本人の承認が後から届いた場合は、botが後続の分類で `supersedes`（置き換える旧コメントのid配列）を明示したときだけ旧判定を無効化する（時刻の新旧だけでは捨てない。未解決の反対判定は厳しい側）。承認の更新（最後の依頼より後の「承認」コメント）があった場合に限り、再照合の依頼を一度だけ提案する。B/Cは、承認の参照と範囲をCodexが照合して `approved` と明示し、未承認範囲が空の場合だけ継続できる（R3は追加独立リスクレビューの記録も必要）。AIの自己申告や任意のフラグで承認を作らない。ユーザー名義の自由文（Codexチャット経由を含む）は、ログインから人間・Codex・Claudeを区別できないため自動の証拠にせず、人間が確認する手動の補助情報として扱う。botはマーカーの波括弧をHTML数値参照（`&#123;` `&#125;`）で返すことがあり、読み取り側で復元する。分類は投稿時点のheadにだけ有効で、push後は新headで再取得する。

**Codexへの依頼は、実際に依頼する1コメントだけにメンションを使う。** 進捗・引用・説明のコメントやPR本文に、依頼用のメンション文字列を書かない（Codex分類依頼のように言い換える）。メンション付きの引用だけでもCodexの別タスクが起動し、利用枠を消費する。依頼前に、同じhead・同じ種別（通常review / security review / 分類）の依頼履歴を照合し、あれば重ねない（履歴にはheadの完全SHAを入れて依頼する）。分類の依頼は読み取り専用（編集・commit・push禁止）と明記し、上記マーカーの出力を指定する。

**公開後の検証**は、既存の `deploy.yml` にある `production-smoke` ジョブの結果だけを自動の証拠にする。`deploy` ジョブで `dist/build-info.json`（コミットSHA・run ID。公開リポジトリで既知の値のみ）をbuild後・公開前に生成して公開し、`production-smoke` が固定の公開URL（tools.codelife.cafe）に対して、HTTP 200、`build-info.json` のSHAが今回のmerge SHAと一致すること（CDN反映待ちで最大約5分再試行）、既知の短いダミー入力でのワードクラウド生成・再生成を確認する。計測は `X-CLC-Synthetic` と計測リクエストの遮断で汚さない。結果（run ID・attempt・merge SHA・URL・HTTP・操作結果）は job summary と artifact `production-smoke-<run>-<attempt>` に残る。通信（本文読取を含む）には1回15秒、全体に約5分（スクリプト全体は10分、jobは20分）の上限があり、期限切れでも失敗の証拠を保存する。Merge後の判定は、Deploy runの集約表示（in_progressのまま残ることがある）を待たず、同じrun・attemptの `deploy` と `production-smoke` の両jobの完了・成功で判断し、1つでも未完了・失敗・欠落・別attemptなら進めない。進行照合のREST/GraphQLにも1回20秒・全体3分の上限がある。失敗はジョブ失敗＝公開確認失敗で、Deploy成功とは区別する。本番の実ブラウザでの目視やダウンロード内容までは含まない。誰かのコメント文字列は公開確認の証拠にしない。`production-smoke` が無いDeploy（導入前のrun）は `verify-production` として手動確認する。復旧はこの差分のrevert。

PR購読（`subscribe_pr_activity`）はCI・レビュー・merge等のイベントで再開する実在の手段。複数PRが依存する場合は、各PRを購読し、イベントごとに本スクリプトで再取得して次の一手だけを実行する。日次21時・週次月08:52の読み取り専用の棚卸しを実装トリガーにはしない。

## マージの担当

最新baseをPR headが含むことを確認し、base更新時は通常のmergeで取り込んでCI・独立レビューをやり直す。直前の確認とMerge操作の間にもbaseは進み得るため、サーバー側のstrict required checks（`lint` / `e2e`）による最新base検証を自動Mergeの前提にする。`--match-head-commit` はheadだけの保護であり、これを代用にしない。2026-09-17に人間の個別承認を得て既存mainルールのstrictだけを有効化し、読み戻し確認済み。実行時にも有効であることを確認し、無効と確認できた場合は自動Mergeを保留して人間へ返す。一時的な取得失敗や確認不能は技術待ちとして再照合し、有効と確認できるまでMergeしない（取得不能が継続して自力で解決できない場合に限り、理由を報告して判断を求める）。merge queueは現在のWorkflowでは未対応のため使用しない。

承認の3段階（A=R0/R1、B=R2/R3、C=R4）の定義は[AGENTS.md](../AGENTS.md#risk-class-と承認の3段階)に従う。A（R0/R1）は個別の人間確認なし、Bは計画の一度の承認、Cは具体的な対象・差分・影響の人間承認。Mergeまでの流れは次のとおり。

- CodexのCode/Security Reviewが内容を独立レビューし、同じ最終headの実差分・AC・許可境界をA、承認済みB、今回承認済みCのいずれかに分類してPRに根拠を残す。「重大な指摘なし」だけでは分類確認にならない。botに分類の出力項目があるとは仮定せず、必要なら独立Codexセッションの明示的な分類記録を別の証拠にする。分類が矛盾する場合は厳しい側に倒し、未承認の範囲だけを人間へ返す。
- GitHub Actionsが客観的に検証する。
- 操作主体（既存Claude Routine、またはClaude Codeプロジェクト `tools.codelife.cafe 保守`（`chan_01BLscqs8eCg8fzAnUt8YFrw`）とその担当スレッド）が、[PRマージ条件](../AGENTS.md#prのマージ判断と実行)の全条件を照合してMergeする。独立判断と、その後の条件照合つきMerge操作を分け、Makerの自己承認は許可しない。別の常設Merge専用Agentは作らない。
- 承認済みのB/Cは、区分名だけで再度人間に止めない。人間へ返すのは、未承認のB/C、ACや禁止範囲の変更、意味の判断が必要な競合、3周でblockingが解消しない場合、本人の認証が必要な場合だけ。R3の追加独立リスクレビューは維持する。
- CI / レビューのRunning、一時的な取得失敗、利用上限は技術待ち。既存のPR購読等の実在する再開手段で続け、同じheadの連投・無限の再試行・未確認のMergeはしない。待ち状態の照合は修正3周に数えない。通常はCI成功後にReadyにして自動のbotレビューを受ける（Draftで手動依頼してからReadyにする二重起動を避ける）。
- 完全な無人化は実測で確認できた範囲だけを報告する。

これは2026-10-28のmarumoの承認に基づく運用で、今回承認された操作範囲（指定Claudeプロジェクトによる条件付きMerge操作を含む）を反映したもので、GitHubトークン・ruleset等の技術的権限、新スケジューラ・Workflow・サービス・課金は追加・変更しない。日次21時・週次月08:52の読み取り専用の棚卸しは、実装やMergeを担当するものへ拡張しない。

この文書だけで外部Routineの指示やGitHubの権限は変更されない。外部の指示に上記と矛盾する記述が残っている場合は、外部設定側を整合させる。

### レビュー完了信号

このrepoではCode ReviewとSecurity Reviewの両方が有効。GitHub APIでコメントの発信者が `chatgpt-codex-connector[bot]`（GraphQLのauthor.login表示は `chatgpt-codex-connector`）であることを確認した上で、同botの `Codex Review Summary` を読む。ユーザーが本文中にbot名や完了文言を書いただけのコメントは使わない。

- サマリーの `codex-security-review:v1` メタデータで `repository`・`pullRequestNumber` が対象PR、`headSha` が最新headの完全SHA、`status` が `completed` であることを確認する。
- 同じサマリーのCode ReviewとSecurity Reviewの両行が `Completed` で、両行の対象コミットがそのheadと一致することを確認する。片方がRunning、旧コミット、失敗、形式不明なら停止する。
- 完了は指摘なしを意味しない。PRのレビュー本文・inline comments・未解決threadを合わせて確認し、blocking findingには同じ最新headでの解消確認が必要。👍は補助信号に留める。`mergeGateEnabled: false` でもこの運用条件を省略しない。
- ローカルCLIレビュー・Maker自身の確認・コメント不在はこの信号の代替にならない。bot信号が未取得・Running・一時的な取得失敗の間は未確認としてMergeせず、既存のPR購読等で待機・再照合する（技術待ち。修正3周に数えない）。形式変更や取得不能が継続して自力で解決できない場合に限り、理由を報告して必要な判断だけを人間に求める。旧Grok Bot運用ループのローカルCLIレビュー代替は歴史記録であり、現行フローでは使わない（[AGENTS.md](../AGENTS.md#歴史記録-旧運用と旧例外)）。

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

R3の追加リスクレビューは必要な領域を対象とし、必要な領域について、実装者と異なるCodexセッションによる追加リスクレビュー（High-Risk Review）を維持し、理由を報告に残す。Maker側の確認（[モデル選択](../AGENTS.md#モデル選択worktree)の重の段階など）はその代替にならない。通常PRには追加しない。

## Manual Setup Checklist

以下はリポジトリ外で人間が確認する。確認済みなら再設定不要。

2026-09-17の読み取り調査ではmainの有効rulesetにPR必須・required checks `lint` / `e2e` が存在した。承認必須人数は0、レビューthread解決・最新pushへの承認は必須ではない。B（R2/R3）の計画承認やC（R4）の対象別承認は現行設定だけで強制されているとはいえない。bypass権限やRoutine側条件は未確認。

- [ ] Codex Webの対象repoのAuto Review設定とモデルを確認する。ON/OFF・モデルは変更しない。
- [ ] 対象repoのCode Review / Security Review両方が有効で、代表PRの最新headについて上記サマリー信号を取得できることを確認する。A・承認済みB/Cの自動Mergeは、このbot信号を確認できた場合に限り行い、確認できない場合は保留する。
- [ ] Claude Codeが最新CLAUDE.md/AGENTS.mdを読み、IssueからのAC取得・Production/Tests編集・Draft PR・Codexコメント/CI対応・待ち状態の記録までMakerとして実行できることを確認する。スケジュールやUI設定は変更しない。
- [ ] 代表PRでレビューfinding → Makerによる分類 → 修正と周回記録 → 最新headのCI → 必要なCodex再レビューを確認する。Draftでレビューが起動するかも実際に確認する。自動再レビューがない場合は、同じhead・同じ種別の依頼がないことを確認して `@codex review` を依頼する。
- [ ] 確認済みのrequired checks `lint` / `e2e` を維持し、mainへの直接pushやbypassで失敗を迂回できない運用か確認する。branch protection・repository permissionsはこのPRでは変更しない。
- [ ] B（R2/R3）の計画承認とC（R4）の対象別承認、最大3周・重複イベント・再起動後の履歴確認をRoutine運用で確認する。文書による規則であり、独自カウンターや機械的ロックは追加していない。
- [ ] ChatGPTのNotionでの分析・施策・効果測定が、実装Issue/PRへのリンクを保って継続していることを確認する。新しいschedule、Notion DBの新設、Cloudflare設定、secrets、deployment permissionsは不要。

[OpenAI公式GitHub連携文書](https://learn.chatgpt.com/docs/third-party/github)ではAGENTS.mdのCode Review Rulesと `@codex review` が案内されている。自動レビューの設定や再起動条件はrepo文書だけでは有効化できない。GitHubでの標準出力はP0/P1中心であるため、P2の投稿を保証しない。指摘なしをレビュー未実行やテスト網羅の証明と混同しない。


### 第1段階: 結果不明と実指摘の分離（Issue #534）

進行照合は `reviewState` で `clean`（両レビューの明示的false）、`findings`（completedの明示的true）、`unknown`（null・欠落・未知形式）、`running`、`error`（failed/cancelledを含む）を区別する。不明値をfalseにもtrueにも補完しない。unknown/running/errorはfail-closedの `wait-review` であり、修正提案・修正周回消費・3/3を理由とする人間返却を行わない。別レビューに確認済みの実指摘がある場合はその指摘の対応を優先する。CI失敗や既に3周超過した履歴等、別の停止条件は維持する。

レビュー証拠の現行採用契約は、APIで確認した信頼bot loginとtype、同一サマリー内の単一の各構造化マーカー、repository/PR番号、CodeとSecurity双方の完全SHA、completed、明示的な未解決指摘boolean、解釈可能な投稿/更新時刻。自由文の「No security issues」、短SHA、レポートURL、説明中のmarker名、Makerの署名、別bot/ユーザーによる同文投稿は採用しない。サマリーのnullを別の自由文receiptで上書きしない。時刻の存在だけでは対象headや完了の証明にならない。現在のreceiptに識別情報が不足する場合、PR #528/#531/#533を成功と決め打ちせずunknownを維持する。nullの発生原因の解決は本変更の証明範囲外。

将来receiptを採用するには、提供元の正式schemaと発信者を確認し、同repo/PR・完全SHA・レビュー種別・完了時刻・構造化結果・サマリーや実指摘との矛盾検出・古い結果の失効を一体で検証する独立した変更が必要。今回はreceiptの新しい合格経路を追加しない。

分類はHTMLコメントの構造化マーカーだけを解析する。説明文に名前が出るだけでは無効結果を作らない。実際のマーカーが壊れている、重複している、enumが `not_required`、完全SHAや必須型が不正なら報告し停止する。正本enumは `not-required`。旧headの分類を現headへ転用せず、未解決判定は後続botの明示的supersedesだけで解消する。

分類依頼は完全SHA、読み取り専用、編集/commit/push禁止、正本schema出力を明記する。既存の連携で独立分類を依頼する場合の日本語「独立分類」「分類確認」「分類依頼」「分類を…」も同headの分類依頼として記録する。分類を求める通常review形式のコメントも分類履歴を優先し、応答が通常レビューだけなら分類未取得のまま待つ。履歴検出は外部botのルーティング成功を保証しない。通常reviewの成功で分類を代替しない。同じhead・同じ種別の連投はしない。

異常時の復旧は自動操作の停止と、Issue/PRへの対象head・待ち先・待ち始め・取得できない証拠・再開条件の記録。既存の購読等で再照合し、未知結果を実指摘と混同する旧コードへ戻して処理を継続しない。取得不能が継続する場合は必要な判断だけを人間へ求める。owner排他・通知・自動再開・Dependabot拡張・外部Routineの設定変更は第1段階に含めない。Merge/本番適用は別途承認待ち。

観測証拠（2026-10-30取得）: [PR531のreceipt](https://github.com/code-life-cafe/tools-codelife-cafe/pull/531#issuecomment-6497625946)、[PR533のreceipt](https://github.com/code-life-cafe/tools-codelife-cafe/pull/533#issuecomment-6499340453) は信頼bot投稿だが、レビュー対象は10桁SHA、結果は自由文、receipt markerには構造化JSONがない。これだけでは現行の完全SHA/構造化結果の契約を満たさない。
