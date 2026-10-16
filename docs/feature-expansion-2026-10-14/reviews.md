# PDFツールの外部レビューと対応記録

2026-10-14。承認済み2ツール、R3（新規PDF描画依存と未信頼PDF処理）。自動承認・Mergeの根拠には使用しない。

## Claude Code

- 初期Maker: セッション23250d68-13cb-4940-a8c3-ff1c302257c9で実装・検証を実施。
- 別セッションの読み取り専用独立レビュー（Sonnet 5.5、1fd091b1-a613-45b6-94b8-9dc7725548e8）は13ターン後にHTTP429 `usage_limit_reached`。最終reviewなし、`is_error: true`。リセット表示は10月15日00:50 JST。
- **未完了**。Makerのテスト結果・Codex検証をClaude独立レビュー完了と置き換えない。課金、認証・権限設定は変更していない。

## agy

利用可能モデルgemini-3.8-flash-highで、行番号付きの明示ファイルを14分割して読み取り専用レビュー。コード生成・実行・変更は依頼していない。応答が空のbatch 6、途中のbatch 9はレビュー完了と扱わない。修正後の圧縮・rendererはgemini-3.8-flash-lowで再確認（セッション2e5ea454-555c-480a-9a04-fbd4d164356c）。すべての指摘を実装・テストと照合した。最終差分全体への包括的承認ではない。

| 指摘 | 照合・対応 |
| --- | --- |
| 間接参照Subtype/FT/Typeの署名・フォーム検出漏れ | 再現。dict.lookupへ変更、圧縮オブジェクト内Widgetの単体回帰テスト追加 |
| 画像化圧縮のpdf-lib例外が英語のまま表示される | 再現。withCorruptFallbackで日本語PdfToolErrorへ統一、不正JPEG回帰テスト追加 |
| 回転維持単体テストが元バイト列の比較で偽陽性 | 採用。圧縮可能ストリームを追加しreduced=true、別出力で回転・寸法維持を確認 |
| 標準圧縮の画像保持テスト不足 | 独立レビューで再現したDecodeParmsの画像変化を修正し、元/圧縮後の独立描画画素を比較 |
| 16MPの描画前拒否E2E不足 | 極端な縦長ページでcanvas面積超過を検知するE2E追加。プレビューも上限を確認 |
| 100ページ・16MP境界、開始前中断の単体テスト不足 | ちょうど許可・1画素辺超過拒否、100ページ目の変換、描画0回の事前中断を追加 |
| 非同期読込中の再選択でloading残留 | 両UIで状態リセットを修正、PC/mobile回帰E2E追加 |
| generate-fixturesのURL pathnameにスペースが残る | fileURLToPathへ変更、7PDF再生成ハッシュ不変を確認 |
| 200MiB保持上限・通常CSP/SW配信の確認不足 | 計画に安全停止を記載。本番相当ヘッダー/SW有効のローカル配信・オフライン変換で検証 |
| /Length更新なしでFlate出力破損 | 不採用。pdf-libのPDFStream.updateDictが保存時に長さ更新。実際の出力を独立解析/描画済み |
| PDF.jsのmetadataキーが存在しない | 不採用。6.4.299 worker実装に実在、実PDFの暗号化・署名・フォームを確認 |
| BinaryDataFactoryはクラスでなくインスタンスを渡すべき | 不採用。6.4.299 getDocumentはnew BinaryDataFactoryを呼ぶ契約。CMapを使う日本語描画E2Eが成功 |
| PDF→画像でも署名・フォームを拒否すべき | 不採用。承認仕様は圧縮のみ拒否。画像化は元文書を変更せず静的外観を描画する。署名検証を提供しない |
| 縮まない場合のダウンロードでユーザーが誤認する | 不採用。result.blob=nullにしダウンロードボタンを出さない実装とE2Eあり |
| getPageSizeへのsignal伝播・raw走査64B境界 | 情報扱い。ページ取得自体のキャンセルAPIは使わず、各取得前と描画前で中断を検査、UIは即時停止。latin1は単バイト、構文検査も併用。破損/任意長空白など完全検出を約束しない |
| ファイル名関数へ拡張子付き名を渡すテスト不足 | 呼び出し側がgetPdfBaseNameで除去する契約。実際のdownload名をE2Eで検証済み |
| 各テストファイル単独で50MiB・部分設定等の全ACを検証していない | 共通入力・純粋関数・UIを合わせて確認。単一ファイルへの重複検査は追加せず、未検証実機/codecをwalkthroughへ明記 |

Codexは上記指摘の照合・修正を担当しており、自分の修正を最終承認していない。PRレビュー周回は作成前0/3。最新headのGitHub Actionsと独立レビューを残したDraftとして共有する。


## PR作成後のagy再レビューと境界テスト対応

対象9b767729f939995bbb2c4faca8994c0876b82514の実装・UI・unit/E2Eを8範囲に分割してgemini-3.8-flash-lowで再レビュー、8応答を受領。mediumの空のタイムアウト応答は完了扱いにしなかった。

照合したP2/test inadequacyは「保持容量の上限ちょうどを許可する比較がテストで固定されていない」1件。上限ちょうど・次の超過画像・最初の画像の超過を追加し、対象14件成功。>=への誤変更で失敗を確認、復元済み。他の主な指摘は既存の例外伝播・URL cleanup・処理中FileDropzone disabled・テストにより不採用。新しいProduction不具合は確認されなかった。

PR修正周回1/3。Claude独立レビュー未完了の記録は維持。追加テストへの独立最終承認や最新head CI成功の代わりとは扱わない。


## 2026-10-15 Claude Code 独立レビュー・修正（第2周回）

対象head: 5eac5dfa0e0ea0e02e5e03bc9eb54b1fc63ef945。Sonnet 5.5、独立セッションd1934a83-ba53-47bb-be93-887718a31177。読み取り専用レビューが完了し、前日の利用上限による未完了状態を解消した。レビュー自体はテスト未実行であり、主担当の検証と区別する。

- P2/actionable defect: toBlob失敗/getContext失敗を素のErrorで投げると画像化圧縮のwithCorruptFallbackが破損PDFへ変換し、解像度を下げる案内が失われる。toBlobをnullに差し替えたブラウザ回帰テストで修正前の誤案内を再現。render-failedのPdfToolErrorでnull/同期throwを日本語化し、withCorruptFallbackでそのまま維持。単体とPC/mobile E2E追加。
- P2/test inadequacy: 署名/フォームは圧縮のみ拒否、画像変換では受理するACを固定するE2Eなし。既存signed.pdf/form.pdfの静的変換・ファイル名・1190×1684画素・文字領域の描画を追加。
- P2/test inadequacy: 遅い有効PDF Aの読込中に有効PDF Bを選ぶ競合E2Eなし。AのFile.arrayBufferをゲートで止め、Bの採用後にAを再開。両UIでBの4ページ情報を保持するE2Eを追加。

修正差分を別セッション641336b7-2bd7-462d-8734-9bdfa4e8dd29で独立再レビュー。元3件はコード上で解消見込み、新たな具体的不具合なし。レビュー側はテスト未実行、主担当の全unit1534/1534・対象PC/mobile E2E92/92・check/build成功で確認した。

残るnit/informational: 競合テストの負例確認は再開後600ms待機であり、遅い実機での検出力に限界。ICC/CMYK色再現、PDF.js描画本体やBlob.arrayBufferの未知の失敗原因別表示は今回の修正外。実機・codec未検証を承認へ置き換えない。nit/informationalだけでblockingにはしない。

修正ループ2/3。独立レビュー結果はMerge許可・自己承認ではない。最新headの必須CI完了を別途確認し、R3の人間承認前はDraftを維持。
