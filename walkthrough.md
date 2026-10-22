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


## issue #469 Mermaid / upscale CLS改善（2026-10-17、Risk R1）

修正ループ2/3で完了。コーディネータによる修正後のE2E・CLS実測を確認済みで、ループ3は不要。

### 変更と原因への対策

- Mermaidの修正済み実装（ToolLayoutのMermaid専用初期幅、ページ描画前のURL→保存設定→既定値の同期復元、操作時のみtransition）は維持。今回これらのProductionコードは追加変更していない。
- `src/components/upscale/UpscalePage.tsx`: 設定・注意書き・実行ボタンを選択前から表示し、未選択時は設定と実行を無効化。ファイル名行を50px、ドロップゾーンとプレビューの共通枠をmin(60vh,320px)で固定し、同じ位置で入れ替える。共通FileDropzoneは変更せず、既存classNameで高さを指定。
- 処理前・完了後の画像は元画像の縦横比を維持した同一矩形にobject-containで重ねる。進捗32px、非表示DL、比較スライダー、説明文32pxを予約。出力予定寸法は常時1行を確保し、実行ボタンは幅固定で完了時の折り返し変更を防ぐ。比較・再処理・クリア・DLの処理は保持。結果表示時の最初のimgは拡大画像。
- 常時表示する処理前注意はrole=noteとし、エラーのみrole=alertにする。未選択時の解像度上限エラーに関する既存E2Eのalert検索が複数要素にならないよう対応。
- `tests/e2e/layout-shift.spec.ts`: 375×900・393×851・1440×900で選択前後の枠位置・寸法、完了前後とクリア後の枠寸法、未選択時の無効化、256px結果、横はみ出し、フローCLS≤0.1を検証。選択後1.5秒待機を維持。実行クリックによるスクロールがあるため完了後は位置ではなく寸法を比較する。
- Mermaid 375pxは保存幅・URL優先を検証し、幅切替操作は省略。実装を確認したところボタンにはモバイル専用の非表示・無効化条件はない。既存横はみ出しと報告されたclick timeoutへの対応であり、1440pxでは切替・保存・transition検証を維持。
- `implementation_plan.md`と本ファイルの#469記録を更新。

### ローカル検証（今回修正後）

すべて`~/.local/node22/bin`をPATH先頭に追加して実行。

| 検証 | 結果 |
| --- | --- |
| `npm run lint` | 成功。既存19 warnings / 1 info（webmcp.spec.tsのnon-null assertion等）。今回変更した2コードファイルは警告なし |
| `npm run check` | 成功。Astro 0 errors / 0 warnings / 227 hints。Biomeは上記既存警告のみ |
| `npm run build` | 成功、アセット検査まで完了 |
| `npm run test:unit` | ファイル単位106成功・2失敗。前回と同じmermaid-repair.test.ts / webmcp-top3.test.ts。直接実行で既存隔離テストのspawnSync EPERMを確認。今回これらは変更していない |
| 関連E2Eの`--list` | 成功、3ファイル50件を認識。テスト本体は実行していない |
| `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0` | 成功 |
| `git diff --check` | 成功 |

### コーディネータによる実測（修正ループ2/3適用後）

PerformanceObserverは各条件3回計測。upscaleの操作フローはsetInputFiles→1.5秒→実行→DL表示。

| 検証・対象 | viewport / 条件 | main → 修正後 |
| --- | --- | --- |
| 関連E2E（layout-shift / mermaid / upscale） | chromium + mobile-chrome | 50 passed |
| PerformanceObserver: upscale操作フロー | 393×851（4xCPU） | 0.150 → 0, 0, 0 |
| PerformanceObserver: upscale操作フロー | 1440×900 | 0.019 → 0.0024 ×3 |
| PerformanceObserver: upscale操作フロー | 375×900 | 0.187 → 0〜0.0007 |
| PerformanceObserver: Mermaid初期表示 | 1440×900 | 0.37〜0.41 → 0.0022 ×3 |
| PerformanceObserver: Mermaid初期表示 | 375×900 | 修正後 ≤0.0007 |
| PerformanceObserver: Mermaid初期表示 | 393×851 | 修正後 0 |
| PerformanceObserver: upscale初期表示 | 全viewport | 修正後 ≤0.0024 |
| Lighthouse 12 CLS: Mermaid | モバイル / デスクトップ | 0.0007 → 0.0007 / 0.4245 → 0.0011 |
| Lighthouse 12 CLS: upscale | モバイル / デスクトップ | 0.0007 → 0.0007 / 0.0087 → 0.0087 |

Lighthouse 12はローカルpreview・Playwright Chromiumで初期表示のみを計測し、upscaleの操作フローは対象外。

Mermaid 375pxの横はみ出し（scrollWidth 419〜443px）は本番mainでも発生する既存問題で、本issueの対象外。全体E2E・CI・独立レビュー（Claude Code Sonnet）はPR上で記録。

Worker・モデル配信・PWA/SW・WebMCP・CI・依存設定は変更なし。

---

# 2026-10-18: issue #467 シーザー暗号の強化（R2）

実装は作業ツリーのみ。commit・pushなし。issue本文を読み、再開指示で承認済みの範囲に限定した。独立レビュー・Merge・Deployは実施していない。

## 変更ファイルとAC対応

| ファイル | 対応 |
| --- | --- |
| src/lib/tools/caesar-score.ts | AC1: 既存caesarBruteForceを使った25/45候補、かなの頻出語・文字と英語の頻度による推測。決定的、同点はシフト昇順 |
| tests/unit/caesar-score.test.ts | AC1: 空・空白・境界・濁点/半濁点・非対応文字・混在、ひらがな3例/英文3例/混在1例、同点・決定性 |
| src/components/tools/cipher/BruteForcePanel.tsx | AC2: 全候補維持、シフト順/推測順切替、推測順の先頭に「推測: 有力」、正解保証なしの説明。選択時の既存コールバック維持 |
| src/components/tools/cipher/CipherPage.tsx | AC3: 「こんにちは」・シフト3・暗号化を設定する例文ボタンと文字処理説明。初期入力は従来どおり空 |
| src/pages/cipher/caesar-hiragana.astro | AC4: 固有title、99字description、H1、暗号化/復号/総当たりの例題、FAQ4件、CipherPage埋め込み、BaseLayout、既存generateJsonLd、既存cipher OG画像参照 |
| src/pages/cipher.astro | AC4: ランディングへのリンク追加。逆方向リンクはランディングに配置 |
| tests/e2e/cipher-hiragana-landing.spec.ts | AC5: SEO、JSON-LD3型とFAQ本文一致、相互リンク、プリセット/暗号化/復号、45/25候補、並べ替え・バッジ・キーボード選択、375px/1440px横はみ出しチェック |
| implementation_plan.md / walkthrough.md | 既存記録を保持して今回の計画と検証を追記 |

## 検証結果

Node v22.22.2（指定PATH）。初回はnode_modules不在でcheck/buildが失敗したため、`npm ci --offline --ignore-scripts`で既存lockfileの646パッケージを復元。依存定義・lockfileは変更していない。

- `npm run lint`: 成功（exit 0）。既存19 warning / 1 infoあり（tests/e2e/webmcp.spec.tsのnon-null assertion等）。差分には指摘なし。
- `npm run check`: 成功（exit 0）。Astro: 0 errors / 0 warnings / 227 hints。Biomeは上記既存警告。
- `node tests/unit/caesar-score.test.ts`: 11/11成功。`node tests/unit/cipher.test.ts`: 15/15成功。`node --test`で両ファイルも成功。スコアを一時的に0にするmutationで追加testの失敗を確認し、即座に元へ戻した。
- `npm run build`: 失敗（exit 1）。Astroのページ生成と既存prepare-pages-runtimeまでは完了。その後の既存OG生成でGoogle Fonts取得失敗→ローカルTTC読込→`Unsupported OpenType signature ttcf`。scriptsは修正していない。build全体の成功としては扱わない。
- 生成済みdistをHTMLParserで検証: canonicalが `https://tools.codelife.cafe/cipher/caesar-hiragana/`、description99字、JSON-LDパース可能（SoftwareApplication / FAQPage / BreadcrumbList、FAQ4件）、相互リンクあり。dist/sitemap-0.xmlに上記URL掲載を確認。
- build停止後の`npm run test:unit`: 110ファイル中107成功、3失敗。links.test.tsはOG未生成のため`https://tools.codelife.cafe/og-image.png`不存在。mermaid-repair.test.ts / webmcp-top3.test.tsは子Nodeプロセス起動の`spawnSync ... EPERM`（各ファイル直接実行で特定）。初回のdist未生成時のonnx-runtime-build失敗は、Astro生成後の直接実行では成功。今回の変更外を修正していない。
- `npm test -- tests/e2e/cipher.spec.ts tests/e2e/cipher-hiragana-landing.spec.ts`: webServer起動失敗（exit 1）、テスト本体は未実行。`npm run preview:ci`も`Preview server process exited before becoming ready.`で失敗。サンドボックス外のコーディネータで既存cipher全件と新規specの実行が必要。
- Playwright `--list`: 成功。chromium / mobile-chrome合計30テスト（既存26 + 新規4）を検出。375/1440pxの実画面確認もE2E待ち。
- `git diff --check`: 成功。

詳細ログ: /tmp/467-lint-final.log、/tmp/467-check-final.log、/tmp/467-build-final.log、/tmp/467-unit-postbuild.log、/tmp/467-score-details.log、/tmp/467-cipher-details.log、/tmp/467-links.log、/tmp/467-mermaid.log、/tmp/467-webmcp.log、/tmp/467-e2e.log、/tmp/467-e2e-list.log。

### コーディネータ環境での再検証（commit 7af59eb、2026-10-18）

上記の失敗はMakerのサンドボックス固有（フォント取得・子プロセス起動・localhost待受けの制限）だった。コーディネータ環境（Node 22）で次を確認した。こちらを正本とする。

- `npm run lint` / `npm run check` / `npm run build`: 成功（OG画像生成・SW生成を含む）。dist/sitemap-0.xmlに `/cipher/caesar-hiragana/` を掲載
- `npm run test:unit`: 1791/1791成功
- E2E: cipher系（cipher.spec.ts・cipher-hiragana-landing.spec.ts）30/30成功（chromium + mobile-chrome、--retries=0）。全E2Eは1747成功・2失敗で、失敗はいずれも既知のflaky（sql-formatter.spec.ts:311、layout.spec.ts:44 mobile。後者は単独で3/3成功）
- 375px・1440pxで横はみ出し0

## 変更禁止対象・計測

WebMCP（*.mcp.ts含む）・catalog.ts・index.astro・astro.config.mjs・public/_redirects・functions・CI・package/lockfile・scripts・計測実装・E2E fixtureに差分なし。src/content/toolsには追加/変更なし。新ページはページ内メタデータのみ。既存変換関数・既存cipher E2Eも変更なし。

入力本文はブラウザ内の既存変換と純粋スコア関数で処理する。保存・送信処理は追加していない。`useToolAnalytics('cipher')`と発火条件は維持し、ランディングでの埋め込みツール利用も既存のcipherイベントとして扱う。今回、新規イベントやallowlist項目は追加していない。

## 未対応事項・引き継ぎ

- ネストした `/cipher/caesar-hiragana/` は既存SW生成のオフラインprecache対象外。scripts変更禁止のため未対応。
- OGフォントによるbuild失敗、隔離プロセスのEPERM、E2Eサーバー起動失敗はコーディネータ環境で再検証が必要。CI成功の代替にはしない。
- GSC対象クエリの表示回数・CTR・順位の再計測はデプロイ4週間後の運用事項。
- 変更禁止対象の修正を必要とする実装上の追加事項はない。上記ビルド環境問題やprecacheをこの差分に含めない。
