# テキスト差分のWebMCP対応 実装計画

作成日: 2026-10-14（日本時間）
状態: 承認用計画。今回の依頼は現状確認と計画作成まで。
Risk Class: **R3（WebMCP）**。

## 1. 現在の対応状況と根拠

調査基準は取得済みの最新 `origin/main`、`aeb787960b18199215e5f8881b306466763bf7af`。

- `src/lib/tools/text-diff.ts` に純粋関数 `computeDiff(textA, textB, mode)` がある。行単位・文字単位の差分断片と追加/削除の行数・文字数を返す。
- `src/components/tools/TextDiff.tsx` はこの関数を通常画面から呼び出している。WebMCP登録はない。
- 単一ソースの定義・registry・生成manifestにテキスト差分の操作はない。registryには既存16操作（JSON↔CSVを含む）が登録されている。
- 本番 `https://tools.codelife.cafe/text-diff/` をCodex In-app Browserで確認。実WebMCP capabilityの `fetchTools()` は **No WebMCP tools are available in this document**。console error/warnは0件。
- open PR一覧にテキスト差分のWebMCP実装は見当たらない。着手直前にも最新mainとPR一覧を再照合する。

**結論: 最新main・本番とも未対応。** 本番での新しいツール実行は、実装・公開後の受入で確認する。

既存LPには空白/大文字小文字を無視する説明があるが、現在のUI・`computeDiff` に対応オプションはない。今回のAPIは実装済みの `lines` / `chars` のみを公開する。LPの説明修正は別スコープとして記録する。
既存Notionのテキスト差分個別タスク・ACは今回未取得。実装着手時に取得・照合し、ACを推測で補ったり変更したりしない。

## 2. 公開する操作

`toolId: text-diff`、操作名 **`compare_text`**、日本語/英語併記の説明。
既存の `defineMcpTool → descriptor生成 → registry → 対象ページ登録` を使用する。

### 入力

| 項目 | 型・許容値 | 必須/既定 | 意味 |
| --- | --- | --- | --- |
| `textA` | string、最大20,000 Unicodeコードポイント | 必須 | 変更前 |
| `textB` | string、最大20,000 Unicodeコードポイント | 必須 | 変更後 |
| `mode` | `lines` / `chars` | 省略時 `lines` | 比較単位 |

入力はトリム・Unicode正規化・空白削除・改行コード統一をしない。
空文字は有効（全文追加・全文削除に必要）。両方空なら成功し、断片は空配列、統計はすべて0。未指定・null・誤った型は無効。
実行中のUI入力・比較モード・表示モードに依存せず、引数だけで独立実行する。

### 成功出力

```ts
{
  mode: 'lines' | 'chars',
  hasChanges: boolean,
  parts: Array<{ value: string; type: 'added' | 'removed' | 'unchanged' }>,
  addedLines: number,
  removedLines: number,
  addedChars: number,
  removedChars: number
}
```

`parts` と4統計は既存 `computeDiff` の結果と一致させる。`hasChanges` は空でないadded/removed断片の有無から求め、入力文字列の単純不一致では判定しない。
文字数は既存のUnicodeコードポイント数で、書記素数ではない。
行数は既存の「差分断片内の行区切りで分かれた区間数」である。文字単位の1文字挿入も追加1行と数えるため、ファイル全体の変更行数とは区別して説明する。

行単位では既存処理が比較時に末尾LFを補う。`a` と `a\n` は差分なし、断片は `a\n`。文字単位では同じ組み合わせが改行1文字の追加になる。この挙動と、行単位の統計に補完LFが含まれる挙動を維持し、descriptor説明とテストに明記する。
差分コピー用テキスト・HTML・行番号付き表示・Split用ペアは返さず、構造化断片を返す。
共通generatorのarray出力schemaに合わせ、断片の構造をdescriptionに記載し、共通schema機能を拡張しない。出力内容の整合はunit/実行経路のテストで確認する。

### 失敗出力

既存のWebMCP失敗形式・isError経路を使用。型/enum/必須/文字数は共通validatorに委ねる。
計算予算超過、Worker期限、同時実行、Worker不可/起動失敗/受信異常、結果上限は日本語の固定文言で区別する。
未知の例外メッセージをそのまま公開せず、入力本文や差分断片をエラー・consoleへ含めない。

## 3. 計算・メモリ・実行時間の安全予算

入力が短くても非常に異なる文章では差分計算が重くなる。文字数上限だけで同期実行の安全性を保証しない。

初期案の固定上限（実測の性能保証ではなく、承認対象の制約）:

| 項目 | 上限・動作 |
| --- | --- |
| 入力 | 各20,000コードポイント、合計最大40,000 |
| 編集距離 | `maxEditLength: 1000`。linesでは行トークン、charsでは文字トークンの追加/削除距離 |
| 算法内時間予算 | `diff` の `timeout: 500` ms。上限でundefinedとなる場合は失敗として返す |
| ブラウザ壁時計期限 | Worker起動から2,000ms。期限時にterminateする |
| 同時実行 | 同じページの本操作は1件。追加要求は待ち行列に入れず、日本語エラーで拒否 |
| 結果断片数 | 最大5,000件。超過は全体を拒否 |
| 成功出力JSON | UTF-8 1MiB、ちょうどは許容。超過は全体を拒否し、省略成功にしない |

既存の `diff@9.0.0` を使用する。導入済みREADME・実装に `maxEditLength` / `timeout` とundefinedによる中止を確認済み。短い合成入力で `diffChars` / `diffLines` の距離上限による中止も確認した。大きな入力・Worker期限・モバイル性能は実装時の検証項目であり、今回の確認を性能実測としない。

`computeDiff` に任意の第4引数として内部用予算を追加し、上限付きの `diffLines` / `diffChars` 呼出しと中止結果の処理だけを加える。既存の3引数呼出し・正規化・断片化・統計計算は維持する。予算値をWebMCP入力から変更できるようにはしない。

WebMCPからのブラウザ実行は専用module Workerで既存 `computeDiff` を呼ぶ。Workerには予算付き入力だけを渡し、結果の断片数・JSONバイト数を確認してから返す。入力規模と編集距離の上限も使い、中間結果を無制限に生成してから最終バイト数だけ検査する構成を避ける。
成功・既知失敗・通信エラー・postMessage失敗・期限超過の全経路でWorker/タイマーを解放し、実行中フラグをfinallyで戻す。受信結果の型とサイズを検査する。
Workerを使えないブラウザでUIスレッドの同期実行へフォールバックしない。Nodeのunit/SSR経路でも同じ算法予算を適用し、無制限実行を増やさない。
Workerとchunkは同一オリジンのビルド済み静的資産として配信。既存CSP・SWの生成経路で配信/キャッシュを確認し、設定変更が必要なら承認済み範囲に黙って加えず計画を見直す。

## 4. 変更範囲と担当

| ファイル | 変更 |
| --- | --- |
| `src/lib/tools/text-diff.ts` | 任意の内部予算引数と中止処理。既存3引数/UI挙動を維持 |
| 新規 `src/lib/tools/text-diff.mcp.ts` | 単一ソースの宣言、入力/出力説明、固定エラー制御 |
| 新規 `src/lib/tools/text-diff-mcp-runtime.ts` | 本操作専用の純粋な予算付き実行・出力検査・定数 |
| 新規 `src/lib/tools/text-diff-mcp-worker.ts` | Worker呼出し、2秒期限、1件制限、解放、Node経路 |
| 新規 `src/workers/text-diff.worker.ts` | 予算付き既存計算と制限済み返信 |
| `src/lib/webmcp/registry.ts` | 定義の追加 |
| `src/components/tools/TextDiff.tsx` | useEffectによる登録/解除のみ |
| `public/.well-known/webmcp/tools.generated.json` | 通常の生成コマンドで再生成 |
| `tests/unit/text-diff.test.ts` | 既存3引数の回帰・追加予算の検証 |
| 新規 `tests/unit/text-diff-mcp.test.ts` | schema/runtime/結果/予算/Worker失敗経路 |
| 新規 `tests/e2e/text-diff-webmcp.spec.ts` | 登録・実Worker・引数付き実行・通常画面一致・安全性 |
| 計画/検証記録 | 承認済み計画をMaker checkoutに保存し、既存記録を保持してwalkthroughへ追記 |

Makerは原則Claude Code、CodexはProduction+testsの独立レビュー。Claudeの利用可否は実装着手時に再確認し、担当変更は今回の計画作成や以前のJSON↔CSV修正承認から推測しない。
隔離checkoutで作業し、元 `D:\tools-codelife-cafe` の他作業の変更を保護する。
対象外: UI機能追加、表示/コピー形式変更、LP修正、空白/大小文字無視、依存追加/更新、汎用Worker基盤、共通schema、Analytics、CI、CSP/SW設定、Constitution、権限変更。
入力・結果を通信/console/localStorage/共有URLへ保存しない。ファイル読込・ダウンロード・コピー・匿名イベントの新規発火もツール呼出しから行わない。

## 5. 必須検証

1. **純粋計算と互換性**: 行/文字、同一文、双方空、片側空、全文追加/削除、日本語、絵文字・結合文字、空白行、LF/CRLF、末尾LF有無、連続変更、HTML風文字列。固定の期待値と、同設定の既存3引数結果を両方使う。末尾LF・文字モード行統計を明示的に検証する。
2. **schema/runtime**: 必須・default・enum・誤型/null・20,000ちょうど/20,001・補助平面文字。未知フィールドを捨てる既存validatorに従い、予算の緩和に利用できないことを確認する。
3. **安全予算**: 編集距離1000ちょうど/超過（行/文字を別検証）、異なる長文・反復文字、算法中止、断片数上限/超過、UTF-8 1MiB境界/超過。到達できないサイズ境界は純粋出力検査へ合成結果を渡すテストとして記録し、実入力で到達したと偽らない。
4. **Workerライフサイクル**: 実Worker成功、期限・同時実行拒否・constructor/postMessage/受信エラー・解放後の再実行。期限を決定論的に検査する故障注入と実Worker成功経路を分ける。未知例外・Worker errorイベントに入力を含む合成値を入れ、返却/ログへ漏れないことを確認する。
5. **E2E**: `fixtures/base`経由、PC/モバイルで対象ページの登録から引数付き実行。両モードで通常UIの統計と断片内容を照合、呼出し前後の入力・mode・viewMode不変。WebMCPなし/不完全な環境でもページ表示が壊れない。アプリ通信・ログ・保存の監視を行い、fixtureの通信遮断だけで送信なしとしない。
6. **配信/遅延ロード**: production buildでWorker/chunkを読めること、既存CSPを適用した実行、既存SW有効時の静的資産利用、不要な初期bundle増大がないことを確認する。SW無効のE2E成功と本番/PWA検証を区別する。
7. **品質/レビュー**: lint、全unit、関連E2E（text-diff / text-diff-webmcp / 既存WebMCP）、型チェック、build。既存の警告と新規問題を分ける。独立レビューはProduction+tests+ACを一体で確認し、指摘→修正→CIの最大3周を記録する。
8. **実クライアント受入**: ローカルpreviewの実WebMCPクライアントで検出・両モード呼出し・UI一致・日本語エラー・UI不変・consoleを個別確認する。最新headの必須CI lint/e2eと正式Code/Security Review完了を確認。Merge/Deploy承認が別途ある場合のみ、最新main追従・新headのゲートを満たして公開し、対象Deploy SHAと本番実クライアント受入を記録する。

## 6. 進め方と承認境界

1. この具体的計画の承認後、最新main・既存PR・Notion AC・Maker利用可否を再確認。
2. 固定予算付き純粋計算を追加し、既存UI互換・中止/容量のunitを確認。
3. Worker経路と単一ソース定義を追加し、期限・失敗・解放を確認。
4. ページ/registry/生成manifestへ接続し、実WorkerのE2Eと実クライアント受入を確認。
5. Draft PR、独立Codexレビュー、修正と最新headのCI/正式両レビューを確認。

今回の計画作成依頼はProduction実装・Merge・Deploy・権限変更の承認を兼ねない。JSON↔CSVの公開承認を次のR3へ拡張しない。
承認対象はAPI/空入力と改行・統計の意味/固定安全予算/Worker方式/既存関数への最小変更/担当/変更範囲/必須検証。
既存 root `implementation_plan.md` やJSON↔CSV計画を置換しない。本計画は独立した `docs/webmcp-next/text-diff/implementation_plan.md` として保存する。

## 承認・着手時照合（2026-10-14）

- ユーザーが本計画を承認し、独立レビュー担当をagyへ変更指定。実装・Draft PR・検証までの承認で、Merge/Deployは別途。
- 最新mainは4f495319362c91359d78f6c245c349bc5c15cbdd。text-diffの重複PRなし。
- 既存Notion親タスク cdcd2236-5b3f-45f6-b022-1d407a9ce93e を取得。今回は同タスクのtext-diff分割のみ。UI変更なし、単一ソース、引数付き実行、privacy、Split行アライメントのPC/モバイル回帰を追加ACとして照合した。他3項目は対象外、親全体を完了にしない。
- 依存PoC d4a8c918は完了。全ツール検証拡充c002ef0cは要計画のまま。ただし今回再利用する共通fixture、WebMCP登録/executeテスト、manifest検証、CIのHTMLレポートと既存lint/E2E/buildは最新mainで利用可能と確認。依存タスクの状態/リンクや検証基盤は変更しない。
- 既知の文字単位UI誤行番号は別タスク3ebdfd36-0336-8140-b765-ee7c0100c066。今回その修正を含めず、既存UIを悪化させない。MCPの構造化partsと統計は既存純粋関数に一致させる。
- Claude Codeは429 usage_limit_reached（日本時間00:50回復予定）で実装未開始。CodexへのMaker変更は確認中。レビュー担当agyは指定済み。Productionコードは未変更。

## 実装担当変更の承認（2026-10-15）

ユーザーが「承認」と回答し、Claude Code使用枠上限に伴うCodex Makerへの変更を承認。以後の担当は **Codex実装・agy独立レビュー**。計画のAPI・予算・変更範囲・Draft PRまでの停止条件は維持する。以前の担当変更確認中の記録は履歴。

## 2026-10-15 追加承認: PWA生成対象の最小修正

ユーザーが一括キャッシュ確認・復元・最新main/CI/再レビュー後のMerge/Deployを承認。受入で既存の /tools/ 404を確認し、SW対象修正も「最小修正を追加して進める」と明示承認した。R3を維持。scripts/generate-sw.mjsで既存除外条件を維持し、index.htmlが実ファイルとして存在する直下ディレクトリだけをページ一覧に含める。tests/unit/generate-sw.test.tsで実スクリプトを一時fixtureに対して実行し、空の親ディレクトリ、index.htmlというディレクトリ、既存除外、正常ページとトップを検証する。SW通信戦略・権限・CI・R2配信は変更しない。修正前失敗→修正後成功、build/PWA再確認、agy+正式レビュー、最新CIを経て同PRをMergeする。
