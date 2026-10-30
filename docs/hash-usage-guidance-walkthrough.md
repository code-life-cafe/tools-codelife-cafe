# ハッシュ計算ページの用途説明修正（2026-10-30）

## 問題と変更

素のSHA-256でパスワードを安全に比較する用途が残っていたため、テキストのチェックサム計算用途に置き換えた。FAQに、このツールはパスワード保存専用の処理に対応せず、保存にはArgon2idなどの専用方式・ソルト・計算コストの適切な設定が必要と明記した。

ファイル照合は、配布元と同じアルゴリズムを選び、信頼できる配布元の期待値を使う手順に整理した。一致だけでファイルの安全性や配布元の真正性は保証されず、両方を置き換えられた場合は検出できないことを説明した。「完全に同一」という断定も除去した。

一次資料:

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): 高速なSHA-256はパスワード保存に不適切。専用方式・ソルト・計算コストの説明を確認。
- [NIST Hash Functions](https://csrc.nist.gov/projects/hash-functions): SHA-2の性質とSHA-1の非推奨を確認。

## 範囲・受入条件

Risk Class: A / R1（既存機能の説明修正）。変更はhash.md、関連E2E、本記録のみ。title/meta、暗号ロジック、通信・保存、依存、運用ルール、既存PR #528/#535は変更しない。新機能拡張Issue #472とは別。復旧は本差分のrevert。

- パスワード保存に素のSHA-256を推奨する用途を除去。
- パスワード保存専用処理でないこととチェックサム照合の限界を明記。
- 現UIのタブ、選択、コピー、期待値照合と説明が一致。
- 表示FAQと生成JSON-LDの回答一致をE2Eで確認。
- 既存操作の回帰を確認し、Draft PRまでとする。merge/deploy/正式Approveは行わない。

## 背景データの扱い

2026-10-30に取得されたGSC、sc-domain:codelife.cafe、正確URL https://tools.codelife.cafe/hash/、Web検索、PT 10/22–28対10/15–21の集計を依頼元から受領。「ハッシュ値 計算」は今0click/44表示/順位2.4、前0/20/1.9。「ハッシュ値計算」は今0/40/2.0、前1/12/1.9。2語合計は今84表示0click、前32表示1click。

ページ全体は今11click/333表示、前7/282でCTRは2.5%から3.3%へ改善している。2語のゼロクリックとページ全体の傾向を混同しない。本変更は内容正確性の修正であり、CTR低下の原因や改善効果を実証したものではない。title/metaはPR #450の公開済み変更を維持する。

## 検証

基点main: `6c4515d1817b15a28386d2de87f93af2555c5f67`。専用cloneとbranchを使い、既存作業を保護した。

- Node v22.23.4、npm ci --ignore-scripts、npm rebuild esbuild @biomejs/biome。lock変更なし。
- npm run build: 成功（124ページ、Pagesアセット検証成功）。初回はGoogle FontsのDNS制限で失敗したため、ネットワーク許可下で同じビルドを完了。
- npm run lint: 成功。既存23 warning / 1 info、今回のファイルに診断なし。
- npm run check: 成功。Astroは既存vendor JS等の大量の診断を出力するため、出力の少ない追加確認も実行。
- npx tsc --noEmit --pretty false --ignoreDeprecations 6.0: 成功。
- npm run test:unit（build後）: 1947 pass、fail/skipなし。
- ハッシュE2E（chromium / mobile-chrome）: 24 pass。追加回帰テストは修正前のビルドで旧パスワード用途を検出して失敗し、修正後は両projectで成功。FAQ回答とJSON-LD回答の一致、既知ベクトル、ファイル、期待値照合、コピー、サイズ上限、375px/1440pxを検証。
- 本番画面で旧説明と自動計算・期待値照合を確認。ローカル修正後画面でも用途・手順・FAQの反映を確認。
- Windowsのlocalhost:4321プレビューがHTTP応答しなかったため、このcloneの検証プロセスだけを停止。PRに含めない一時Playwright設定で127.0.0.1:44329のforeground previewを使用した。ブラウザ取得先も作業領域内に限定した。
- npm testによる全件E2Eと最終headのGitHub Actions結果・待ち状態はPRに記録する。ローカル成功を必須CIやbotレビューの代替にはしない。

別担当のread-only独立差分レビューで、説明の正確性・現UI整合・FAQ/JSON-LD検証・範囲を確認しblocking findingなし。正式bot Code/Securityレビューや承認の代替ではない。

実装管理用の新規Issue作成は自動承認レビューが許可範囲外の公開操作として拒否したため、再試行しなかった。AC・検証・待ち状態は許可されたDraft PRに集約する。
