# 動画圧縮の旧結果表示修正

Risk Class: R1。元修正のbase: main `f1e3c7d`。以下は元修正の検証履歴で、PR433への統合結果は末尾に記載する。

成功時に圧縮設定と開始・終了秒の比較キーを結果へ保持する。現在設定が異なる間は完了通知を再圧縮案内へ切り替え、結果見出しとダウンロードを「前回」と明示する。元へ戻すと通常表示へ戻る。成功ファイルは設定変更だけでは破棄せず、再実行開始・読み直しでは従来どおり破棄する。失敗・キャンセルで旧結果を復活させない。

## 回帰検証

- `tests/e2e/video-compress-result.spec.ts`: 共通fixture、Worker応答mockを使う結果状態の回帰テスト。範囲・品質・解像度・音声・圧縮方法・目標容量の変更、元に戻す、新しい成功、再圧縮失敗、成功後の再実行キャンセル、連続成功とURL更新を確認。
- 初回の制限付き実行で標準Astro buildが停止したため、補助環境で実VideoCompressをesbuild bundleし、ローカルHTTP上で同じPlaywrightテストを実行。PC/Pixel 7とも成功（2 passed）。後述の通常実行では標準検査も成功した。
- 同じ補助環境で修正前mainコンポーネントをbundleし、PC/Pixel 7とも設定変更後に旧「圧縮が完了しました。」が残るアサーションで失敗（2 failed）。回帰の検出を確認。
- `node --test tests/unit/video-compress.test.ts`: 8 passed。
- `npm run lint`: exit 0、既存15 warnings/1 info。変更2ファイルのBiome: 警告・エラーなし。
- `npm run build`: 通常実行でexit 0。依存・configの回避変更なし。115ページ、生成OG/SW・配信アセット検査まで完了。
- `npx astro check`: exit 0、597 files、0 errors / 0 warnings / 65 hints。
- `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0`: exit 0。
- build後の `npm run test:unit`: 1443 passed / 0 failed。
- `npx playwright test tests/e2e/video-compress.spec.ts tests/e2e/video-compress-result.spec.ts --workers=2`: 標準dist/preview上でPC/Pixel 7計22件成功。既存実動画の映像・音声・トリミング・キャンセル・異常終了・オフライン処理と、新しい旧結果表示回帰を確認。
- 全体 `npm test -- --workers=4`: 1298 passed / 35 skipped / 3 failed（6.0分）。動画圧縮は全件成功。3失敗は今回変更と無関係で、production差分を一時的にmainと同一にしてbuild後、該当4テストを再実行して同じ3失敗を再現（SQL mobileの1件のみ成功）。専用worktree内の動画コンポーネントはfinallyで復元した。
- 独立レビューとテスト補強後の再レビュー: 修正要求なし。

## 初回の依存エラーの切り分け

専用worktreeへlockfile準拠 `npm ci` を実施した。依存を共有した初回は旧checkoutの版ずれがあり、専用installで解消。以後の `picomatch: require is not defined` は依存upgradeでは解消せず、同じNode v22.23.2・同じ無変更の依存で実行制限を外すと標準buildが成功した。

最小の再現コマンドは `npx astro sync`。制限付き実行では `astro/dist/core/sync/index.js` のcontent collection型生成で停止し、CommonJSの `picomatch/index.js`（require/module.exports）がVite ModuleRunner内でrequire未定義となる。通常実行では同期・型生成・build成功。成功後に制限付き `npx astro sync` を再実行しても同じエラーを再現した。単独Node importと設定なしVite ssrLoadModuleでpicomatch/html-escaperを読む最小probeは両環境で成功し、Astroの同期環境に限定される。さらに内部のどの制限が外部化判定へ作用するかまでは断定しない。

package.json、package-lock.json、astro.config.mjs、src/content.config.tsはmainと同一で、動画圧縮のUI変更は同期エラーの経路に含まれない。初回unitの1失敗とtscの3エラーはbuild未生成によるもので、標準build後に全て解消。依存packageへの一時type commonjs試行は元へ戻し、依存・lockfile・build設定へのコミット変更はない。ログはworkspace直下evidence/に保存。

## mainでも再現した全体E2Eの3失敗

`npm run build` 後に `npx playwright test tests/e2e/sql-formatter.spec.ts:311 tests/e2e/zenkaku-hankaku.spec.ts:24 --workers=2` で再現する。

- SQL Formatter、chromium、狭い画面の横スクロール検査: 実測overflow=9px、許容<=5pxに失敗（test line333）。
- 全角半角変換、chromium/mobile-chrome、方向switchの背景色検査: checked/uncheckedがどちらも `rgb(231, 229, 228)` で色差のassertionに失敗（test line41）。

これらの実装・テスト・共通UI・CSS・依存は変更していない。main同一productionの標準buildでも同じ値で失敗するため、本修正の回帰ではない。修正や期待値の緩和はスコープ外として行わず、全体E2Eをgreenと扱わない。残る既存問題の根拠は `evidence/main-unrelated-e2e.log` と `evidence/e2e-standard-full.log`。

## 既存作業との関係と次の操作

既存checkout D:/tools-codelife-cafeには他の未commit変更があったため編集せず、専用worktreeを作成。EDITHツールはこの環境に公開されておらず、local git/ghで確認した。Library画像は取得せず、提供された2.333秒→1〜2秒の再現をテストで独立に再現した。

最終確認ではPR433はOPEN/Draft、head `4ff396ccbe83443ef7f3f82126aa74570c56a3eb`。PR434は2026-10-12 04:10:56 UTCにPR433のbranchへMERGED（mainへのmergeではない）。434のheadは `9c99553a3412ba85cb38d4d6e627043eb31a2530`。433はVideoCompressの範囲・品質・D&D変更、434はVideoTrimRange等の修正で、今回の旧結果識別は含まれない。最新433と434 headのtree差分はなく、VideoCompress blobも同一。

`git merge-tree --write-tree HEAD origin/pr433-readonly` と434版を実行し、最新433についてもVideoCompressのref宣言部分1か所だけcontent conflictを確認。433が未使用input refを削除した隣で今回runJobKey/jobKey/resultIsStaleを追加したため。UI・結果保存・通知の他のhunkは自動統合された。branch checkout・既存途中worktreeの編集はしていない。

最小の取り込み手順: 434を含む最新433 headを基点に新しい専用branchを作り、本branchの2つのローカルcommitをcherry-pickする。競合部分ではrunJobKey/jobKey/resultIsStaleを残し、input refを削除する。新回帰テストは終了秒のfill後にTabで確定するため、434のblur/Enter確定方式にも対応する。433のサムネWorkerもmock対象なので、統合後にはそのUIと実Workerを含め標準build・unit・動画E2Eを再実行し、最新headの独立レビューとCIを得る。

元修正の検証段階ではpush・PR作成・merge・deployは実施しなかった。依存修正は不要。

## PR433への統合（2026-10-12）

ユーザーの承認を受け、PR433最新head `ae00bf4` を基点に専用worktree `task-3/integration` を作成した。元commit `5853099` と `d5d8903` をcherry-pickし、ref宣言1か所の競合では旧結果判定を保持、PR433で削除済みのinput refは復活させなかった。重複修正はなかった。

取り込み中の並行更新 `b6a9bb7`（短動画のスライダー表示・読み上げ桁数）を通常mergeで取り込んだ。`7b96717` のD&D動画base64受け渡し、`ae00bf4` の短動画入力精度、PR434の改善を全て保持する。これらのファイルと最新PR433との差分はない。

独立レビューでサムネWorkerにも圧縮用mock応答を返すテスト不備を指摘されたため、Worker URLで分岐しサムネには仕様上のnull fallback応答を返すよう補正した。fallback表示とpageerrorゼロも検証し、再レビューで解消確認済み。

統合版の標準lint・build・Astro全体check・tscは成功。unitは1448 passed / 0 failed、動画圧縮の標準E2EはPC/Pixel 7計28件成功。既存の実動画・サムネD&D・長尺/短尺範囲操作に、新しい旧結果ライフサイクル検証を加えた。ログはworkspace直下evidence/integration-final-*.log。元修正の全体E2Eでmainにも再現したSQL/全角半角の3失敗は別問題として残し、検査や期待値を緩和していない。

最新PR433への差分はVideoCompress、旧結果回帰テスト、本文書の3ファイルだけ。既存checkout/他担当worktree/PR435は変更しない。ユーザー承認の対象は通常の非force pushとCI確認までで、mainへのmergeと本番deployは対象外。push直前にPR状態・headを再確認し、並行更新時は再取得して保持する。
