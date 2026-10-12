# WebMCP上位3件の実装・検証

対象: Mermaid、YAML/JSON/TOML、個人情報マスキング。Risk Class R3。

## 受け入れ条件と実装

- 55件を対象に、既存のmanifest・レガシー定義・ページでの実登録を照合。既存12件対応、未対応43件。全順位と理由は `webmcp-priorities-2026-10-12.md` に記録。
- 上位3件の既存処理を `defineMcpTool` の単一ソース定義で公開し、registryと各ページのuseEffectへ接続。生成manifestは10定義から13定義へ増加。レガシーtax/unix-timeは既存のまま。
- Mermaidは修復・SVG生成、形式変換は6方向・整形・キーソート、マスキングは対象6種・全文字/一部伏字・2種の伏字を提供。
- UIの既定値とWebMCPの既定値は独立。WebMCPのマスキングは共有用途を想定し全文字伏字を既定にする。AIへ既に渡した情報の漏えいを取り消す機能ではない。
- 入力は100000文字上限。入力データのfetch・保存・ログ・計測を追加していない。既存のSVGレンダラーはstrictモード。ブラウザ非対応では登録がno-op。

## 実測

- `npm run lint`: 成功。15警告と1infoは変更前でも再現。追加・変更ファイルへのBiomeチェックは指摘なし。
- `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0`: 成功。
- 対象単体テスト9件とregistryテスト3件: 全12件成功。文法修復・複合形状保持、全変換方向の値維持、TOML制約、マスキング設定・既定値・原文非返却、型/列挙/サイズエラー、現行document登録と旧navigator登録の実行・解除を確認。
- `npm run webmcp:generate`: 成功、13定義。
- 全単体テスト: ONNXランタイムのビルド成果物検証1件が失敗。変更前のmainでも同じテストが失敗（成果物の配置によりアサーションは異なる）。成功扱いにしない。
- `npm run build`: Astroの115ページ生成は成功。最後のCloudflare Pages 25MiB検査でONNX/WASM容量超過となり全buildは失敗。変更前mainでもWASM容量超過を再現。依存・ランタイム配信は本スコープ外のため変更していない。
- `npm test -- tests/e2e/webmcp-top3.spec.ts --project=chromium --workers=1`: preview webServer起動失敗で実行不可。ChromiumダウンロードもZIP取得失敗。E2Eは追加済みだが未検証。ブラウザ登録、実SVGレンダリング、非対応時のUI、実行中リクエスト観測をCIで確認する必要がある。

## レビューと公開境界

差分セルフチェックを行ったが、独立レビューの代替ではない。AGENTS.mdの「R3: 追加リスクレビューと人間承認を残す」「最新PRコミットのlint・unit・E2E・build/型チェックが成功しない限りMerge不可」に従いDraft PRで共有し、Merge/Deployしていない。既存ONNX課題・E2E実行環境を解決し、最新SHAの必須CIと独立レビューを確認後、人間の承認を得る。


## 独立レビュー修正（1周目）

入力上限と省略時既定値が公開スキーマに出ていない指摘を受け、3件のtextにmaxLengthを宣言し、共通生成器でmaxLength/defaultを出力するよう修正した。実行時の検査・既定値は変更せず、クライアントへ明示する。既存ツールのdefaultも同じ宣言からmanifestへ反映。生成器と3件のスキーマの回帰テストを追加。

GitHub CIの初回lint/型チェック/build/全unitは成功。ローカルでのみ発生したONNX課題とは区別する。初回E2EとSecurity Reviewの結果はGitHub PRの最新状態を参照。修正後headのCI・独立レビューを改めて確認してからMergeする。
