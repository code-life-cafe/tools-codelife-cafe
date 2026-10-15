# 画像のクロップ・回転・反転ツール 動作検証ウォークスルー

## 対象
- `/image-edit`
- 画像のアスペクト比指定クロップ、任意角度回転、水平/垂直反転、PNG/JPEG/WebP書き出し、複数ファイル一括ZIP出力

## 手順
1. `/image-edit` を開く。
2. PNG / JPEG / WebP 画像をドラッグ＆ドロップ、またはクリックしてファイル選択で読み込む（最大30枚・1枚50MBまで）。
3. アスペクト比（自由 / 1:1 / 4:3 / 16:9 / 3:4 / 9:16 / 3:2 / 2:3）を選択し、プレビュー上のクロップ範囲がドラッグで調整できることを確認する。
4. 「左に90°回転」「右に90°回転」ボタン、または回転スライダー（-180°〜180°）で任意角度に回転し、プレビューへ反映されることを確認する。
5. 回転欄の「リセット」で回転角度が0°に戻ることを確認する。
6. 水平反転・垂直反転のトグルを切り替え、プレビューに反映されることを確認する。
7. 出力形式（PNG/JPEG/WebP）を切り替え、PNG以外を選んだ場合のみ品質スライダーが表示されることを確認する。
8. 90度単位以外の角度に回転し、背景色（余白）指定欄が表示されることを確認する。
9. 単一画像で「ダウンロード」をクリックし、加工後の画像ファイルが保存されることを確認する。
10. 複数画像を読み込み、「◯枚をZIPでダウンロード」をクリックし、`edited.zip` が保存されることを確認する。
11. 「クリア」をクリックし、読み込み前の初期状態（ドロップゾーンのみ）へ戻ることを確認する。

## 確認観点
- 画像処理は Canvas API のみで行われ、外部送信は発生しない。
- JPEG など EXIF Orientation を持つ画像は、読み込み時点で向きが自動的に補正される。
- 90度 / 270度回転時は出力画像の幅と高さが入れ替わり、180度回転では元の寸法を維持する（1px膨らみが発生しない）。
- JPEG書き出し時は透過部分が指定した背景色で合成される。
- 不正ファイル選択・上限超過（枚数・サイズ）時は日本語エラーメッセージを表示する。
- 数値入力によるクロップ範囲指定（旧 `/image-crop` の機能）は本ツールの対象外。


---

# WebMCP 第一段階 JSON↔CSV 検証ウォークスルー

上記は別作業の既存内容であり変更していない。以下が本作業のセクション。実施: 2026-10-14、ローカル（Windows 11 / Node v22.23.2）。コミット・push・PR・Merge・Deploy・外部へのユーザー入力送信は行っていない。

## 環境

- `node_modules` が空だったため `npm ci --no-audit --no-fund` を実行。`package-lock.json` は変更なし。
- ポート4321を別ビルドのプレビューサーバー（`JsonCsvPage` のチャンク名が今回の dist と異なる）が占有していた。標準設定は `reuseExistingServer: true` のため古いビルドに接続し、実ページ登録が0件になった。他者のプロセスは停止せず、一時設定 `playwright.tmp.config.ts`（ポート4399で今回の dist を `astro preview` 配信）でE2Eを実行した。一時設定は検証ごとに作成し削除済みで、最終差分に含まれない。標準設定（4321）でのE2Eは**未確認**。

## 結果（実測、修正ループ2/3後の最終）

| 項目 | コマンド | 結果 |
| --- | --- | --- |
| Lint | `npm run lint` | exit 0。既存の警告15件・info 1件（ベースライン同数、今回の変更ファイル起因なし） |
| 型チェック | `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0` | エラー0 |
| Build | `npm run build` | 成功（manifest 16 descriptor、25MiB上限OK）。OG生成が Google Fonts を取得する（既存スクリプト、ユーザー入力と無関係） |
| Unit | `npm run test:unit` | 1528 tests / pass 1528 / fail 0（`json-csv-mcp.test.ts` 37件） |
| 対象・関連E2E | 一時設定で json-csv-webmcp / json-csv / webmcp-top3 / webmcp（chromium + mobile-chrome） | 110 passed / 0 failed（ポート4399の別サーバー、4321は未使用） |

初回実装時の `astro check` は 0 errors（修正ループ後は未再実行）。

## 修正ループ2/3（Codex再レビュー 2件）

- P1: ループ1の予算はプロパティ数のみで、長いヘッダー×行数の反復（`k`×3000 + 400行、`k`×30000 + 10000行）を防げなかった。出力JSONの下限バイト数（8バイト＋JSONエスケープ後UTF-8キー長、行ごと）で変換前に拒否するよう再設計。重複ヘッダーは既存と同じ規則で `_N` 付与後に評価、extra_N は最短7バイト、hasHeader=false は `column_N`、展開は後述の構造モデルで評価。回帰テストは全モードで拒否かつ `Object.defineProperty` 0回を確認。
- P2: 非先頭の数値セグメントを常に配列扱いしていたため `a.x,a.1000000000.b` を誤拒否していた。既存 `unflattenObject` の処理順・コンテナ種別・スカラー上書きを、配列を実体化しないモデルで再現し、実際に配列へ入る添字のみを疎配列長として評価。既存object配下の数値キー・先頭数値キー・実在しない添字は受け入れ（既存converterの出力と一致を確認）、巨大な実配列は拒否。使い捨てファズ（4000件のランダム小型ヘッダー、数値/空/`1e1`/`__proto__` 等を含む展開入力）で、受け入れ可能な入力の誤拒否と出力不一致が0件であることを確認（ファズは差分に含めない）。
- 修正前に落ちる確認: 予算検証の呼び出しを無効化すると、新規・既存の予算系5件（ネスト50段、巨大添字、行×列、長いヘッダー、object配下/実配列）が失敗。P2の旧ガード（列数基準）そのものでの実行は、保存していないため未実施。
- 安全予算は「出力が1MiBを必ず超える下限」のみで拒否するため、1MiBちょうど成功など既存の境界は変わらない。

## 修正ループ1/3（Codex blocking 3件）

- P1: CSV→JSON が巨大な中間オブジェクトを作ってから1MiBを確認していた。`csvToJson` 呼び出し前に実行予算（プロパティ数・展開時の配列要素数）を検証。回帰テスト「巨大な行×列」は300列×600行（約4千文字）を通常・型推論・展開・区切り指定・hasHeader=false で拒否し、`Object.defineProperty`（既存実装のプロパティ生成）が0回であることを確認。
- P2: 全数値セグメントを配列添字扱いして `2026.value` を誤拒否していた。先頭セグメントは制限せず、2番目以降は予算で評価。`2026.value`・`items.9.name`・配列内の小型添字を受け入れ、`a.1000000000`・`9`×400桁・行数との積が予算超過のものを拒否。
- P2: `implementation_plan.md` / `walkthrough.md` はHEADの既存内容を復元し、本作業のセクションを末尾に追記した（元内容の削除なし）。

修正前に落ちることの確認: 予算検証の呼び出しだけを無効化して新テストを実行し、「巨大な行×列」「巨大な配列インデックス」「ネスト50段」の3件が失敗することを確認した（その後復元して34件pass）。`2026.value` / `items.9.name` は旧実装の判定（数値セグメント < 列数）では拒否されるコード構造であることをコード上で確認したが、旧実装そのものでのテスト失敗実行はしていない（旧実装を保存していないため）。

## 未確認

- 実ブラウザ・実 WebMCP クライアントからの呼び出し受入。
- 標準設定（4321）でのE2E、最新 head の必須CI（lint / e2e）、Codex 再レビュー、main マージ、本番 Deploy。
- ブラウザUIの手動操作は実施していない（Playwright のみ）。

## 2026-10-14 実クライアント受入・最新main追従

ユーザーが実WebMCP受入、最新main追従・CI・Codex再レビュー後のPR #448 Merge/Deployを条件付きで承認。

- 実クライアント: Codex In-app Browserのwebmcp capability（モック差替えなし）。localhost:4399/json-csv/で2操作を検出し、tools.callから引数付き実行。
- 両方向で同設定の通常UI出力と一致（textareaのCRLF正規化を考慮）。既定の文字列保持、先頭ゼロ・安全整数外の保持、不正CSVの日本語isError、UI状態不変を確認。
- 統合後に再読み込み・ツール再検出して両方向を再確認。長いヘッダーによる出力膨張を拒否。console error/warnは0。
- 最新main 974a11dを通常merge。統合コミット663a923、競合なし。JSON↔CSV Production・tests・manifestは5fda5ecの独立レビュー済み内容と不変。rootのdirty checkoutは未変更。
- 依存更新後のローカル検証: lint exit0（既存15 warnings）、tsc exit0、build成功、全unit1535/1535、PC/モバイル関連E2E110/110（別ポート4398）。一時設定は削除。
- Codex再レビュー:最新mainとの差分は承認済みJSON↔CSVの10ファイルのみ、diff --check成功、blocking findingなし。機械的main取り込みと検証はClaudeの使用枠上限によりCodexが実施。Productionの新規編集は行っていない。
- 修正ループ2/3を維持。新headのGitHub必須CIと正式Code/Security Reviewの完了を別途確認してからMergeする。Merge/Deployはこの記録時点では未実施。


## 2026-10-14 正式P2修正・独立再レビュー（修正ループ3/3）

- 対象: discussion_r4270853116（不正CSVと出力膨張が重なると、構文エラーより出力上限エラーが優先される）。
- Claude Codeの使用枠上限により、ユーザーがCodex修正・別Codex独立レビューへの担当変更を承認。
- 最小修正: preflightのPapa parseでMissingQuotes/InvalidQuotesを検出した場合のみ既存converterへ委譲。converterはオブジェクト生成前に日本語エラーと行番号を返す。正常CSVの予算判定・実出力1MiBチェックは維持。共通converter変更なし。
- 回帰テスト: 2種類の引用符エラー×全8設定で既存converterとエラー全文を照合し、プロパティ生成ゼロを検証。修正前に失敗、修正後38/38成功。既存テスト弱体化なし。
- 別Codexの読取専任レビュー: blocking findingなし。構文エラーの早期return、正常CSVの安全予算維持、Productionとテストの対応を確認（テスト実行結果は主担当が記録）。
- ローカル: lint exit0（既存15 warnings/1 info）、tsc exit0、build成功、全unit1536/1536、関連PC/モバイルE2E110/110。diff --check成功。
- 実WebMCPクライアント: 修正版を再読み込み・2ツール再検出。両方向実呼出しと文字列/先頭ゼロ/安全整数外の保持、30000文字ヘッダー＋10000行＋2種類の不正引用符で10002行目の既存日本語isErrorを確認。console error/warn0。
- 最新main974a11dを含むことを再確認。新headの必須CIと正式Code/Security Reviewはpush後に確認。Merge/Deployは未実施。4周目は自動開始しない。


## テキスト差分WebMCP検証（2026-10-15）

承認計画: approved-text-diff-plan.md。Codex実装・agy独立レビュー、Risk R3。
compare_textを追加し、既存computeDiffは任意の内部予算引数だけを拡張。既存UIは登録/解除のみ。
各入力20kコードポイント、編集距離1000/算法500ms/Worker2秒/同時1件/5000断片/成功JSON UTF8 1MiB。Nodeもbounded、ブラウザ同期fallbackなし。入力/結果を通信/ログ/保存しない。

- lint exit0（既存15 warnings/1 info）、型チェックexit0、build成功。
- 関連unit28/28、全unit1553/1553、関連PC/mobile E2E94/94成功。
- 実WebMCPクライアントで検出・両モード実呼出し・UI統計一致・入力不変・予算エラー・Split表示・console error/warn0を確認。ローカルpreviewであり本番確認ではない。
- agy独立レビューapprove、指摘0。読取専任スナップショットレビューであり実行テストは主担当が担当。詳細はdocs/text-diff-webmcp-review.md。
- WorkerのSWプリキャッシュへの収録を確認。PWAの一括キャッシュ有効化は自動承認レビュー拒否のため明示承認確認中、PWA実行は未確認。
- 既存文字単位UI行番号/LP課題は範囲外。親Notion全体未完了、修正ループ0/3。
- 最新headのCIはPR作成後に確認。Merge/Deploy/本番受入は未実施。

## PWA追加修正・受入

ユーザーが一括キャッシュ/復元/マージ/デプロイと、発見した既存SW対象不具合の最小修正を承認。/tools/はindex.htmlがない親ディレクトリだが一覧に混入し、本番でも404。生成処理で実ファイルindex.htmlの存在を確認するよう修正。新規unitは修正前に/tools/と/invalid/混入で失敗、修正後成功。

使い捨てPlaywright contextで全370資産のisComplete=trueを確認。通信オフ・再読込後、WebMCP登録経路からcompare_textの両モードを実Worker実行。2回ともWorkerレスポンスfromServiceWorker=true、pageerror0。初期テストの文字単位行統計の誤期待を既存断片仕様へ訂正。ローカルpreviewにはPages R2経路がないので、ONNX5資産のみmanifest SHA一致のpublic実体をrouteで補った。本番R2全体の証明ではない。テストcontextのcaches=[]、SW登録0、local/session={}へ削除しcontext破棄。通常Chromeのキャッシュ設定は変更していない。


## Unicode変換 WebMCP（2026-10-15）

- Risk R3。ユーザー承認済みapproved-unicode-plan.mdをACとし、Codex実装・agy独立レビュー。base:116b26703f03d36b0fdb104bcf29f37ce93f6fd0。
- convert_unicode({text,action:encode|decode}) → {result}。最大20000コードポイント、成功JSON UTF-8 1MiB。UIと同じ空白前処理・既存純粋関数・固定日本語エラー。UI変更は登録/解除のみ。
- manifest:既存17定義のJSON内容をすべて維持し18定義へ。共通型/SW/依存/CI/Analyticsは未変更。consequentialHintは既存型にないため宣言へ追加せず、実ブラウザ表示ではfalseだった。
- build成功。lint成功（既存15warnings/1info、今回追加なし）。tsc --noEmit --pretty false --ignoreDeprecations 6.0成功。build後の全unit:1563/1563、関連PC/mobile E2E:78/78。初回の全unitはbuildと重なり中間dist参照で2件失敗したため、完成buildで全件再実行して成功。
- 上限20000→20001の一時mutationでschema/境界テスト2件が失敗し、必ず復元して12/12成功。生成manifestのmaxLength20000と実クライアント20001拒否も確認。
- 通信監視をfetch/XHR/beacon/WebSocketへ補完後、新Unicode E2E12/12と使い捨てPWA2/2成功。390px単独6/6成功。最終E2EではPC1280x900/mobile390x844をテスト内で明示。
- 実WebMCP:本番ページでは実装前の登録なしを確認。ローカル4397でネイティブdocument.modelContext登録を検出し、encode日本語😀→\u65e5\u672c\u8a9e\ud83d\ude00、decode\u3042\u{1F600}→あ😀、範囲外・不正action・20001コードポイントを拒否。20000絵文字encode成功。UI出力一致、別入力のMCP実行後もUI本文/方向/結果/URL/local/sessionStorage不変。モック実行とは別の証拠。
- 実ブラウザ1280px/390pxで横はみ出しなし、console errorなし。表示幅は復元。画像docs/webmcp-unicode/acceptance-desktop.png。
- SWを有効にした使い捨てcontextでページ/Unicode chunkをwarm cache→offline reload→通常UI encode/MCP decode成功。registrations0/caches[]/local0/session0を確認してcontext破棄。詳細pwa-local-acceptance.json。一括precache/R2配信や本番デプロイは今回確認していない。通常fixtureのSW無効E2Eとは別。
- agy初回:needs-attention。390pxをテスト内に明示して対応。既存unitファイル未変更の指摘は、必要な固定例が新unitに存在し既存純粋関数も未変更のためコード不具合としては不採用、集約意図を計画追記。PWA pendingの記録は完了結果へ更新。初回raw structured reportはagy-review-initial.json。最終差分の再レビューを実施する。修正ループ1/3、Production修正0。
- 元のD:/tools-codelife-cafeの未コミット変更は含めない。完了済みtext-diffのclean worktreeを新Unicodeブランチへ再利用したためcheckoutのパス名はwebmcp-text-diffのまま。
- Merge/Deployの承認は今回に含まれず、Draft PR/CIまで。GitHub正式Code/Security Review、必須CI、本番受入は別の証拠として扱う。


### 最新main追従・agy最終結果

- mainのPDF追加0d9f1bbを通常mergeで取り込み。依存はmainのlockに同期し、npmのlibc metadata正規化差分は復元（今回の依存変更なし）。最新build成功・全unit1606/1606。
- agy再レビュー gemini-3.8-flash-high / plan read-only: approve、findings=[]。初回指摘解消とAC1〜8を確認。コード/追加テスト/manifestの全文が再レビューsnapshotと一致することをmain取り込み後に照合した。ハッシュと結果はdocs/webmcp-unicode/agy-review-final.json。正式Code/Security bot review・CI・Merge承認とは別。
- 最終Unicode E2E12/12（明示1280px/390px）成功。最新main上でも関連78件を再確認。
