# 動画圧縮ツールの実装・検証記録

2026-10-12。Risk Class R2。新しいページは `/video-compress`、旧形式 `/tools/video-compress` は正規ページへ転送。公開・merge・deployは未実施。

## 仕様と実装

参考の[チヂメル](https://shin-yu.net/nyups/chidimeru/)の目標容量・トリミングと、[OpenReplay](https://openreplay.com/ja/tools/video-compressor/)の品質・解像度指定を調査して設計した。原サイトの処理・通信を独立検証したものではない。

- 動画1件の選択・ドロップ、情報表示・プレビュー、品質3段階／目標容量、長辺上限、開始・終了秒、音声削除、進捗・キャンセル・再実行、結果比較とMP4保存。
- Mediabunny 1.61.3を固定し、同一オリジンのWorkerとWebCodecsで処理。入力はBlobSource、出力ArrayBufferはtransfer。キャンセル・ファイル変更・unmountでWorkerを終了し、Object URLを解放する。
- 出力H.264/AAC。AAC音声は再エンコードせず元品質を保持し、その他の音声は対応環境のみ128kbps・48kHz・最大2chへ変換。必要な全音声トラックが利用されるか確認し、音声欠落を成功扱いにしない。
- トリミング音声はサンプル境界で内側へ丸め、映像との時刻同期を維持。rotation込み表示寸法で縮小し、出力の回転はフレームへ反映する。
- 入力256MiB・出力128MiBまで。目標容量は推定（MB=1,000,000バイト）。全音声の平均ビットレートと5%の付加データ余裕を含む。容量不足・推定上限超過は開始前に拒否し、実出力の上限も監視する。厳密な容量保証や削減率保証は行わない。
- ページ固有meta CSP、既存disableAnalyticsを適用。入力・ファイル名・範囲は通信・ログ・保存に使用しない。localStorageには品質等の設定だけを保存。ファイルデータをAPI・外部CDNへ渡す経路はない。

## 独立レビュー

ユーザーの指定によりCodexサブエージェント `review_video_plan` で計画とProduction／テストをレビュー。計画のblocking指摘なし。ProductionではWorker異常終了後に終了済みWorkerへ再送する問題が1件見つかり、参照・情報のクリアと読み直し案内を実装し、復旧E2Eを追加。再レビューで解消確認済み。AACコピー方式もレビューし、最終差分に未解決のactionable findingなし。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| `npm run lint` | 成功、489ファイル。既存の15 warnings・1 info。今回の追加ファイルに警告なし |
| `npm run test:unit` | 1,430件成功、失敗・skipなし。新規6件を含む |
| `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0` | 成功 |
| `npx astro check` | 成功、598ファイル、0 errors・0 warnings・83既存hints |
| `npm run build` | 成功。Pagesの25MiBアセット上限チェックを含む |
| `playwright test tests/e2e/video-compress.spec.ts --workers=2` | Desktop Chrome・Pixel 7の計14件成功、失敗・skipなし |
| `git diff --check` | 成功 |

E2Eは共通の通信遮断fixtureを使用せず、実Worker・実WebCodecsで変換する。音声付き動画のトリミング・縮小を、静的Workerロード後のネットワークオフライン状態で実行した。ページの実リクエストを監視し、外部URL・POST等のGET以外のリクエスト・入力ファイル名を含むURL・計測APIへの送信は0件。Service Workerは既存Playwright設定に従って無効であり、PWA自体のオフライン機能をこの検証で保証するものではない。

実出力をMediabunnyで再解析し、H.264/AACトラック、854×480px、2秒を確認。合成入力3,126,290bytesから117,138bytesへ縮小（切り出しと縮小を含む結果であり、一般の削減率の保証ではない）。映像開始0秒、音声開始0.012秒、音声終了1.996秒。元音声AACの48kHzを保持した。

他に縦動画・音声なし・目標容量・不正時間範囲、キャンセル後再実行、破損／非対応形式からの回復、AAC非対応時の明示停止と音声削除、Worker異常終了後の読み直し、回転情報のフレーム反映、キーボード実行、PC／スマホで横あふれがないことを検証。両幅の生成スクリーンショットを目視確認した。動画fixtureはFFmpegの合成映像・音声から生成し、個人情報や外部素材は含まない。

## 環境メモと限界

- このLinux ChromiumではAACエンコードが非対応。入力AACをコピーする正常系と、非AACの変換ができない場合の停止・音声削除の両方を実検証した。対応OSでの非AAC→AAC再エンコードは未実機検証。
- Firefox／Safari／実スマートフォンの各コーデック対応は未検証。非対応時は日本語エラーで案内する。mobile-chromeはPixel 7のエミュレーション。
- 初回npm installは既存onnxruntime-nodeのインストールスクリプトがネットワークエラーで失敗したため、ignore-scriptsで依存を配置した。Mediabunnyに必要なインストールスクリプトはない。既存のWASM配信・ビルド検証は成功。
- build前の全unit実行は旧distを参照する既存ONNX生成物テスト1件が失敗。build後は全件成功。
- 初回rotation fixture生成はFFmpeg 7のrotateメタデータ指定では回転情報が付かなかった。display_rotationで生成し直し、ffprobeで実回転情報を確認してから最終E2Eを成功させた。

## リリース前の本番CSP検証・修正

本番の共通CSPヘッダーをpreviewに付与する実検証で、`media-src`省略時のdefault-srcによりblob動画が拒否されることを確認した（preview readyState=0、MEDIA_ERR_SRC_NOT_SUPPORTED、media-src違反）。Cloudflare Pagesは重複するCSPヘッダーを連結するため、新しいヘッダーでは共通制限を緩和できない。`public/_headers` に `/video-compress` と `/video-compress/` の完全一致だけ `! Content-Security-Policy` を追加し、当該ページは既存のmeta CSPを実効制限として使用する。metaは同一オリジンとblobだけを許可し、共通CSPより通信・script制限を厳しくする。共通CSPや既存ページの境界は変更しない。両パスのCSP解除とmeta指定をunitで、共通ヘッダー解除後にもmetaが存在して元・結果動画がreadyState>=2になることをE2Eで検証する。ページ固有の配信ヘッダーを追加したため変更全体をR3として記録し、独立レビューを追加する。ユーザーからのリリース指示を人間承認として扱う。

追加R3レビューで、ワイルドカード解除が共通404ページのCSPまで消す問題を指摘され、解除を実ページ2パスの完全一致へ限定。新規7unit・PC/mobile16E2Eで検証。

正式GitHub Code Review（aeb0330）のP2指摘2件を修正: 読み込み中キャンセルはWorkerを終了してファイル選択可能な状態へ戻し、再読み込みを開始しない。正の開始タイムスタンプは実長へ正規化し、UIの相対切り出し秒を元の時刻へ変換する。遅延loadと開始5秒・実長3秒の合成動画をE2Eに追加した。

最終修正のローカル結果: lint/build/astro check/tsc成功、全1,432unit（新規8件）・PC/mobile20E2E成功、失敗・skipなし。修正周回は3/3。独立再レビューで追加blocking findingなし。最新コミットの正式Code/Security Review・CI成功を確認してからMerge・Deployする。

## UI改善（2026-10-12）
- 品質選択に元ファイル全体と比較した推定削減率を表示。解像度・音声・書き出し範囲に追従し、増加時も明示。
- 書き出し範囲を左右ハンドルのスライダーに変更。矢印・PageUp/Down・Home/Endに対応し、全範囲に戻せる。
- 動画から8フレームを専用Workerでローカル抽出（スマホでは4枚表示）。rotation・正の開始時刻を考慮し、ファイル変更時にWorker/Object URLを解放。抽出失敗時も圧縮できる。
- image-compressと同じFileDropzoneを使用。領域全体のクリックとD&Dに対応。
- build・TypeScript・lint成功（既存警告15件）。unit 1,434件成功。PC/モバイルの対象E2E 24件でオフライン圧縮、実フレーム、D&D、キーボード範囲変更、AAC保持、キャンセル回復、抽出失敗時の継続を検証。
- Codexサブエージェントがproduction/test差分を独立レビューし、actionable findingなし。
- モックは認識合わせ資料のため今回のPRには含めない。完全ローカル処理と既存CSPを維持。
