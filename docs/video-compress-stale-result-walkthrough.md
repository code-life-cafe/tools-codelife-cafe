# 動画圧縮の旧結果表示修正

Risk Class: R1。base: main `f1e3c7d`。

成功時に圧縮設定と開始・終了秒の比較キーを結果へ保持する。現在設定が異なる間は完了通知を再圧縮案内へ切り替え、結果見出しとダウンロードを「前回」と明示する。元へ戻すと通常表示へ戻る。成功ファイルは設定変更だけでは破棄せず、再実行開始・読み直しでは従来どおり破棄する。失敗・キャンセルで旧結果を復活させない。

## 回帰検証

- `tests/e2e/video-compress-result.spec.ts`: 共通fixture、Worker応答mockを使う結果状態の回帰テスト。範囲・品質・解像度・音声・圧縮方法・目標容量の変更、元に戻す、新しい成功、再圧縮失敗、成功後の再実行キャンセル、連続成功とURL更新を確認。
- 標準Astro buildに依存問題があるため、補助環境で実VideoCompressをesbuild bundleし、ローカルHTTP上で同じPlaywrightテストを実行。PC/Pixel 7とも成功（2 passed）。CSSを省略した補助環境であり、本番配信・レイアウト・実コーデックを検証したとは扱わない。
- 同じ補助環境で修正前mainコンポーネントをbundleし、PC/Pixel 7とも設定変更後に旧「圧縮が完了しました。」が残るアサーションで失敗（2 failed）。回帰の検出を確認。
- `node --test tests/unit/video-compress.test.ts`: 8 passed。
- `npm run lint`: exit 0、既存15 warnings/1 info。変更2ファイルのBiome: 警告・エラーなし。
- `npm run test:unit`: 1442 passed/1 failed。失敗は `onnx-runtime-build.test.ts` が未生成dist/_astroを参照するため。
- `npm run build`: 失敗。lockfileに従い専用npm ci後もAstro syncで `node_modules/picomatch/index.js: require is not defined`（AGENTS.mdに記載済みの環境問題）。依存packageに一時的にtype commonjsを付ける試行では次のhtml-escaper解決エラーへ進んだ。回避変更は全て戻した。
- `npm test -- --workers=2`: build失敗によるdist不存在でpreview起動失敗。既存実動画E2Eは未検証。
- `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0`: Astro生成型がないためastro:content、ImportMeta.env、zxing WASM importの3エラー。変更ファイル由来のエラーは出ていないが、全体型検査成功とは扱わない。
- 独立レビューとテスト補強後の再レビュー: 修正要求なし。標準配信経路の未検証を明示。

## 既存作業との関係と次の操作

既存checkout D:/tools-codelife-cafeには他の未commit変更があったため編集せず、専用worktreeを作成。EDITHツールはこの環境に公開されておらず、local git/ghで確認した。Library画像は取得せず、提供された2.333秒→1〜2秒の再現をテストで独立に再現した。

PR433 (`codex/video-compress-ui` → main) とPR434 (`claude/epic-rubin-hk0dzg` → PR433 branch) は確認時OPEN。433はVideoCompressの範囲・品質・D&D変更、434は別VideoTrimRange等の修正で、今回の旧結果識別は含まれない。433と同一ファイルなので将来統合時は差分調整・再検証が必要。途中worktreeには触れていない。

push・PR作成・merge・deployは実施しない。次は依存環境を修復して標準build・E2E・型検査を通し、433/434の最新headとの統合差分を確認してDraft PRへ進む。
