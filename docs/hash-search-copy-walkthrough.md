# ハッシュ計算の検索訴求改善（2026-10-14）

## 実測と判断

Search Consoleのtools.codelife.cafe、ウェブ検索、2026-09-14〜2026-10-11、ページフィルタ「次を含むURL: https://tools.codelife.cafe/hash/」を閲覧。
ページ全体: 462表示・8クリック・CTR1.7%・平均掲載順位6.4位。

| 検索クエリ | 表示 | クリック | CTR | 平均順位 |
| --- | ---: | ---: | ---: | ---: |
| ハッシュ値 確認 サイト | 30 | 0 | 0% | 4.4 |
| ハッシュ値 確認 ツール | 27 | 0 | 0% | 6.2 |
| ハッシュ値計算 ツール | 27 | 1 | 3.7% | 9.5 |
| ハッシュ値 計算 | 23 | 0 | 0% | 5.7 |
| ハッシュ値計算 | 21 | 0 | 0% | 3.0 |
| ハッシュ計算ツール | 19 | 0 | 0% | 10.2 |
| ハッシュ照合 | 11 | 0 | 0% | 3.5 |

表示されたクエリ22件を確認。ページ合計とクエリ行の合計は一致しないため、表示されていない検索語を推測しない。少数母数なので低CTRの原因や改善効果は断定しない。
検索データ: https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Atools.codelife.cafe&num_of_days=28&page=*https%3A%2F%2Ftools.codelife.cafe%2Fhash%2F&metrics=CLICKS%2CIMPRESSIONS%2CCTR%2CPOSITION

## 変更と範囲

- title: ハッシュ値計算・確認・照合ツール｜SHA-256・MD5対応
- H1・パンくず用displayTitle: ハッシュ値計算・確認ツール
- description・summaryはファイル／テキストの計算と配布元のハッシュ値との照合を説明。5方式とブラウザ内処理を維持。
- updatedを2026-10-14へ更新。変換ロジック、通信、保存、依存、CI、カタログは未変更。
- 既存表示E2Eにtitle、H1、パンくず、meta descriptionの検証を追加。他のテストを削除・弱体化しない。
- 関連Draft #442はGNU形式のチェックサム貼付け機能。同機能を取り込まず、本文にも約束しない。同じファイルのマージ順に応じて統合・再検証が必要。
- Risk Class R1。

## 検証

最新main aeb7879を基点に専用ブランチcodex/hash-search-copyを作成し、他者の未コミット変更を保護。

- npm ci: 成功、lockfile変更なし。
- npm run build: 成功。
- npm run lint: 成功、既存15 warning / 1 info。
- npm run test:unit: 1536 passed、失敗・skipなし。
- ハッシュE2E: PC Chromium / mobile-chrome、20 passed。テキスト既知ベクトル、日本語、各方式、ファイル差替え、一致／不一致／判定不能／未選択方式、コピー、ファイル上限、375px／1440px、新文言表示を確認。
- 既存プレビュー44321が古いページを配信していたため、今回のビルドを未使用44323で起動。一時設定はPRに含めない。共有サーバーは停止しない。
- git diff --check: 成功。

## agyレビュー（一次確認済み）

agy-reviewスキルを使用。既定gemini-3.7-flash-highは利用不可だったため、agy modelsで確認したgemini-3.8-flash-highを使用。
標準スクリプトはheadlessのcommand権限拒否により回答を取得できず、権限を広げずに正確な差分と必要な実装契約を直接渡して再実行。提供資料に基づくレビューであり、agy自身によるリポジトリ探索ではない。

- verdict: blocking指摘なし。主担当がHashVerifier、HashPage、hash.ts、ToolLayout、schema、hashページとテスト差分を照合し、今回の文言と実機能が一致することを確認。
- agyの「最適な文字数」「検索結果の省略リスクが低い」といった一般化は採用しない。表示・順位・CTRの改善は未確認。
- 既存FAQの数GB・全方式ストリーム処理と、パスワードを安全に比較する用途は対象外の別課題として記録。今回summaryからパスワード用途は除いた。
- 正確な実装: ファイル上限256MB。全方式でチャンク読み取りを行うが、SHA系はフルバッファを保持してWeb Cryptoで計算する。agyへ渡したfile.arrayBufferという略記はこの実装を簡略化しすぎていたため、ここで訂正。新文言は大容量／省メモリを約束しない。

本番反映・検索効果・GitHub Actionsの最終結果はローカル検証とは別。Draft PRとして共有し、マージは行わない。
