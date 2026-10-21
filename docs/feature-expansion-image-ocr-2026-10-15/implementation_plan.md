# 次期ツール選定・画像文字起こし（OCR）実装計画

作成日: 2026-10-15 JST。状態: 2026-10-15にユーザー承認済み。実装・検証済み、Draft PR準備中。
§1〜8は承認された計画時点の記録。実装で確定した事項は§9、実測とレビュー結果はwalkthrough.mdを参照。

## 1. 結論と需要の評価

次は **画像文字起こし（日本語OCR / Image to Text）**、slug `image-ocr` を実装候補とする。
既存 `image-text` は画像への文字入れなので別機能。PDFテキスト抽出（#457）とPDF圧縮・画像化（#449）は公開済みとして除外する。

狙いは、スクリーンショット・横書きの印刷物画像を編集可能な文字へ変え、コピー・TXT保存すること。
PDF→画像で書き出したスキャンページも手動で渡せるが、PDF自体のOCRやツール間の自動転送は含めない。

### 残候補の比較

検索数は [2026-10-14の調査記録](../feature-expansion-2026-10-14/implementation_plan.md) の Ahrefs Free Keyword Generator、Google/Japanでの月間推定値の閾値表示を再利用する。取得から1日なので今回は再測定していない。実数・本サイトへの流入予測ではなく、類似語を合算しない。

| 候補 | 確認済み検索需要 | 今後の伸びに関する判断 | 今回の順位 |
| --- | --- | --- | --- |
| 日本語画像OCR | `画像 文字起こし` >1,000/月 | 文書再利用・AI投入前の文字化に用途拡張の余地。ただし前回Trendsの2025/2026年各40週平均指数は約38.9%減。検索成長の証拠はない | **1位。既存PDF導線を補完し、用途を限定して検証** |
| 動画→GIF | `動画 gif 変換` >1,000/月 | 成長時系列は未取得。需要規模ではOCRと優劣を付けられない | 2位。動画デコード・GIFエンコードの負荷と容量増が課題 |
| Office/HTML→Markdown | `excel markdown` は前回取得失敗。他の対象語は未測定 | 文書のAI利用は追い風になり得るが、日本の変換検索需要は未確認 | 3位。需要確認と既存CSV/XLSX・AI表プロンプトとの差分整理を先行 |
| PDF編集/回転/透かし/比較、ZIP、その他画像・音声・CyberChef型機能 | 個別検索数未取得 | 成長の比較証拠なし。検索結果件数や競合掲載数を検索数に代用しない | 残候補として維持。今回は実装しない |

順位は検索数だけではなく、既存利用導線・実装の責任範囲を加味した判断。将来の検索増・順位・利用数・収益は予測値として提示できない。
検索数の出典: https://ahrefs.com/keyword-generator/ 。Trendsの定義: https://support.google.com/trends/answer/4365533?hl=ja 。上記減少は正規化された人気度指数の比較であり、検索件数の前年比ではない。

### 今回確認した一次資料と推論の境界

- 前回5競合の一つ [sakuttoAIの画像文字起こし](https://sakutto.ai/tools/image-to-text) は、日本語/英語のブラウザ内OCR、コピー/TXT保存、横書き中心の制限を案内する。取得できた公開本文では無料利用にログイン・回数制限がある。今回、実動作や精度は未検証。競合にもローカルOCRがあるため「外部送信なし」だけを独自性としない。こちらは既存方針どおりログインなしで提供する案。
- [Adobeの2026年9月公開レポート案内](https://business.adobe.com/resources/reports/state-of-ai-in-documents-how-ai-mature-organizations-turn-adoption-into-measurable-results.html) は、匿名Acrobatデータと約800人の幹部調査を基に文書AI活用を扱う。文書を再利用可能にする用途の材料にはなるが、日本のOCR検索数や成長率の証拠ではない。以前確認したAI利用の増加率をOCRの成長率へ転用しない。
- Markdownへの関心が強くても、既存AI表データプロンプトはMarkdown表出力、CSVエディタはXLSX読込に対応している。単にExcel貼り付けを変換するだけでは重複になる。
- OS標準の文字認識・汎用AI・既存無料OCRが代替となる。公開後の利用が増えない可能性もある。スクショの手直し、端末内処理、PDF関連の回遊を検証仮説とする。

## 2. 現状と開始条件

2026-10-15確認時GitHub mainは `d09d9494add40f22a0d06b085ffed3462202208f`。catalogに画像OCR/動画GIFはなく、対象の重複PRも取得した公開PR一覧にはない。実装開始時に再確認する。

既存 `ImageDropzone` はファイル選択・ドロップ・画像貼り付けに対応。`image-common.ts` はJPEG/PNG/WebP、20MB、8192pxの検証とデコードを持つ。仕様を合わせて再利用し、他ツールの制限を変更しない。OCR用の総画素数検証は別に追加する。共有Dropzoneは複数入力の扱いとtextareaへの貼り付け干渉を確認し、必要なら本ツール側で入力経路を限定する。

既存依存にOCRエンジンはない。画像AI配信の修正PR #451は別作業中なので、OCRから背景削除/音声文字起こしの配信コードを変更しない。
元checkoutには無関係な未コミット変更が多数ある。ルートの `implementation_plan.md` や既存計画を上書きせず、承認後は最新mainの隔離checkoutで作業する。

## 3. 初回リリース仕様

カテゴリ: 画像・テキスト解析。アイコン: `ScanText`（catalogで利用可能か実装時確認）。related: `pdf-to-image`、`pdf-to-text`、`image-edit`、`char-count`。

1. JPEG/PNG/WebPを1枚選択・ドロップ・貼り付け。プレビューを確認後、明示的に「文字を読み取る」で実行する。ファイル選択だけでモデルを取得しない。
2. 日本語＋英語の横書き活字を初期対象とする。言語モードは「日本語＋英語」「英語」の2種。手書き・縦書き・段組み・表の構造復元は非保証と入力前に表示する。誤認識があることを明示し、業務書類の正確さを保証しない。
3. 結果を編集可能なtextareaに表示し、全体コピー・UTF-8 TXT保存（BOMなし、LF、元名＋`_ocr.txt`）。OCR文字をHTML/Markdownとして解釈しない。原文の要約・翻訳・AI補完・意味を変える正規化をしない。出力の改行コードだけ統一する。
4. モデル読込と認識の進捗、キャンセル、クリア、再実行。進捗値を取得できない工程で架空の百分率を出さない。処理中の差替え・キャンセル・画面破棄で古い結果/エラーを反映せず、WorkerとObject URL等を破棄する。
5. 空/空白のみの結果では「文字を読み取れませんでした」と案内し、コピー/保存を無効化。写真からの幻覚的な誤認識を完全には検出できないので、結果確認を促す。

上限案: 入力20MiB以下、各辺8192px以下、総画素数12,000,000以下、出力100,000 UTF-16コード単位以下。上限ちょうどを許可し、超過は切り捨てず日本語エラー。画素数はOCR開始前に確認し、勝手に縮小しない。デコーダ段階の最大メモリ保証とは区別する。OCR開始から120秒で停止し、切り抜き/縮小して再試行する案内を出す。初回資産取得は別工程として通信失敗を扱う。

PDF、SVG、HEIC、GIF/APNG等のアニメーション、URL指定、複数画像一括、ZIP、検索可能PDF出力、カメラ撮影、表/レシート構造化、翻訳、AI接続は対象外。PNG/WebPでもアニメーション入力は拒否し、静止画抽出を案内する。HEICは既存画像変換へのリンクのみ。画像内EXIFの向きはデコード結果で確認し、独自の二重回転を避ける。

## 4. 技術方針と最初の合格条件

[Tesseract.js公式](https://github.com/naptha/tesseract.js) を第一候補とする。ブラウザでWASM/Workerを使用できるが、本サイトのCSP・配信・日本語精度・所要時間は未検証。
[公式API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) と [ローカル配信手順](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) の `workerPath` / `corePath` / `langPath` を固定して、CDN既定値を使わない。古い説明中の版番号をそのまま採用せず、承認後に現行安定版と互換coreを監査して正確な版を固定する。

言語データ候補は [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) の `jpn` / `eng`（LSTM用）。依存ライブラリ・core・モデルのライセンスを個別確認し、出典・固定revision・SHA-256・必要なNOTICEを残す。日本語モデルによる追加データ取得も観測し、必要資産をすべて同一オリジンに固定する。非SIMD経路も確認する。

承認後、UIの完成前に以下を通す。満たせない場合は問題と代替案を計画へ戻し、サーバーOCRや追加課金へ自動で切り替えない。

- 現行CSPを緩めず、Worker/core/WASM/モデルの全取得が同一オリジンで成功。初回資産は転送合計30MiB以下を目標上限とし、実バイトを記録。Pagesの現行アセット制限内で静的配信できることを確認する。
- 個人情報のない正解付き横書き画像を最低12枚・合計1,000文字以上用意。日本語3フォント、英数字/記号混在、PNG/JPEGを含める。清明な活字群の文字誤り率CERを合計5%以下とする。CER=(置換+削除+挿入)/正解文字数。比較時はCRLF→LFと改行除去だけを事前規定し、誤字を隠すUnicode正規化はしない。画像別の結果も記録し、平均だけで苦手条件を隠さない。
- 劣化写真、傾き、低解像度、縦書き等は別群で評価し、対応済みと報告しない。試験fixtureは生成後固定し、誤認識に合わせて期待文を変更しない。
- 約3MP画像でモデル取得を除く認識時間を同じ入力3回測定し、PC中央値30秒以内を暫定合格基準とする。モバイルは可能なら実機を測り、未保有ならブラウザの狭幅テストと区別して未確認を明記する。タイムアウト・キャンセル・操作応答も検証する。

推論自体はTesseract.js内蔵Workerを利用する。重複する独自WorkerやWorkerプールは作らず、DOM操作/Worker寿命は `src/lib/ocr/client.ts`、純粋な上限/出力処理はtoolロジックへ分離する。依存は認識開始時に遅延ロードする。

資産は `/vendor/ocr/<固定版>/` と `/models/ocr/<固定revision>/` の静的ファイルを第一案とし、再現可能な準備scriptとmanifestで配布する。既存モデル用R2への書込や新しいプロキシは今回含めない。ページを開くだけでモデル全量をprecacheしない。現行SWがこれを避けられない場合は実装を止め、影響を示して計画を見直す。PWA/CI/権限変更を便乗させない。

## 5. プライバシーと設定

画像・ファイル名・認識文字・編集結果は通信、ログ、IndexedDB、localStorage、URL、Cache Storageへ保存しない。Worker内の入力・結果は完了/中断後に解放する。エンジンの診断ログも入力や内部結果を露出させない。
モデル/コードの静的HTTPキャッシュは入力保存と区別する。エンジン独自の永続キャッシュは無効化し、利用者画像をキャッシュしないことを実測する。
保存する設定は言語モードのみ。`useToolSettings` と既存共有URL検出パターンを使用する。認識結果・ファイル・画像は共有URLへ含めない。既存の許可済み匿名計測のみ使用し、新イベント/props、WebMCP、入力内容の収集を追加しない。

## 6. 予定変更ファイル

- `src/lib/tools/image-ocr.ts`：入力/寸法/文字数検証、結果とTXT出力の純粋処理。
- `src/components/tools/ImageOcr.tsx`：入力、プレビュー、進捗、編集、コピー/保存。
- `src/content/tools/image-ocr.md`、`src/pages/image-ocr.astro`：日本語LPとページ。
- `src/lib/ocr/client.ts`、`src/lib/ocr/assets.ts`：エンジン接続・寿命管理、資産manifest。
- `src/lib/tools/catalog.ts`、必要時 `src/components/tool/registry.ts`、`README.md`：登録・related・llmsFull・実数の件数更新。
- `package.json` / `package-lock.json`：監査したTesseract.js追加のみ。既存依存の一括更新はしない。
- `scripts/prepare-ocr-assets.mjs`、`public/vendor/ocr/`、`public/models/ocr/`：固定資産の準備/検証と必要なlicense/NOTICE。準備時だけ公式配布元を取得し、利用時のCDN取得は不可。
- `tests/unit/image-ocr.test.ts`、必要時 `tests/unit/ocr-client.test.ts`、`tests/e2e/image-ocr.spec.ts`、`tests/e2e/image-ocr-delivery.spec.ts`。
- `tests/fixtures/image-ocr/`：正解テキスト、画像と生成script。個人情報なし。
- `docs/data-management.md`：OCR資産の固定配信と準備手順。既存R2設定は変更しない。
- このディレクトリの `walkthrough.md`：承認後の実測、品質、未確認事項。

既存PDF解析/描画、背景削除/音声のモデル配信、AGENTS/CLAUDE、CSP/権限、CI/Deploy設定、共通SW生成処理は変更対象外。範囲外が必要なら差分・理由を提示して再判断する。

## 7. 実装順序と検証

1. 最新mainと重複PRを確認、隔離checkoutで資産配信・認識精度・時間のスパイクを実施。依存/モデル監査と合格条件を確認。
2. 最小の入力→認識→編集→TXTを縦につなぐ。日本語UI・共通部品・進捗通知を実装する。
3. 境界・失敗・中断・privacyを検証。既存画像/PDF機能の回帰確認。
4. Claude Makerによる実装と修正、Codex独立レビュー。Claude Code別セッション・agyの追加レビューも実装時に依頼する。最新headの必須CIを確認してDraft PRを共有。

Risk Class **R3**（新規WASM/モデル・信頼しない画像処理）。実装・検証・Draft PR作成は計画承認後。Merge/Deploy・R4変更の承認は別に必要。

| 項目 | 合格条件 |
| --- | --- |
| 正常系 | 日本語/英語混在、JPEG/PNG/WebP、透明背景の白合成、EXIF向き、画像貼り付け、編集、コピー、TXT実ファイルを独立期待値と照合 |
| 境界 | 空ファイル・破損・形式不一致・アニメーション拒否。20MiB/8192px/12MP/100,000コード単位の直前・ちょうど・超過。巨大実画像と合成境界テストを区別 |
| 非同期/失敗 | core/WASM/モデルの404・読込失敗、タイムアウト、中断、差替え遅延、画面離脱、再実行。古い成功/失敗が再表示されない |
| 精度 | 固定fixtureのCER・画像別結果、認識限界を記録。モックで精度を証明しない。回帰テストが実モデル/Workerを実行する経路を持つ |
| privacy | 共通fixtureの遮断とは別に、通常配信で合成マーカーの通信・ログ・URL・永続保存への漏出なし。静的資産は同一オリジン。匿名イベントは既存allowlist一致 |
| 配信 | 初回モデル未取得と取得済みを区別。必要資産取得後のオフライン再認識、非SIMD経路。トップページ初期bundleへエンジン混入なし、全サイトprecacheへの重い資産混入なし |
| UI | PC/モバイル幅、キーボード、ラベル、フォーカス、aria-live、長い出力とエラーの横はみ出しなし。モバイル実機とエミュレーションは区別 |

`npm run lint`、`npm run check`、`npm run test:unit`、`npm run build`、対象/回帰E2Eを実行。E2Eは `tests/e2e/fixtures/base.ts` 経由、通常配信検証は同fixtureから素のcontextを明示作成して通信遮断を使わない。実OCRの不具合をunitの期待値変更やE2Eのskipで隠さない。Mergeには最新headのGitHub Actions必須CI成功が必要。

## 8. 公開後の判断

公開後28日/56日で、取得可能ならSearch Consoleの日本・対象ページの検索語別表示/クリックと、既存匿名page_view/tool_engage/tool_runを比較する。Search Console権限は未確認。tool_runを認識成功数・保存数と解釈しない。
初期28日を基準に次の28日を比較し、低母数・検索順位・インデックス遅延を記録する。需要があって認識品質が足りなければ前処理/モデルを再評価。需要が弱ければLPの検索意図を見直し、PDF一括OCRへ自動拡張しない。本文・エラー画像の自動収集は追加しない。

今回の完了範囲は比較・選定・一次資料確認・本計画の作成。OCRの実動作/認識精度はまだ検証していない。実装開始の判断点は、上記の小規模OCRをスパイクの合格条件付きで進めるかどうか。

今回の検査: `npm run lint` はexit 1（479ファイル、作業前から変更のある `tests/e2e/cipher.spec.ts` の整形エラー1件・既存警告15件）。自動修正なし。unit/E2E/buildは実装未着手かつMarkdown計画だけの追加のため未実行。既存の未コミット変更を保持し、stage/commit/pushは行っていない。

## 9. 実装で確定した事項（2026-10-15、承認後の追記）

実装中の実測で、§4・§6 の前提を次のとおり具体化・変更した。実装の詳細は `walkthrough.md` と `docs/data-management.md` §4。

- **エンジン接続**: 公式 `createWorker` は使わず、固定した `worker.min.js` を直接 Worker として起動する（`src/lib/ocr/client.ts`）。tesseract.js 7.0.0 は言語データを `{code,data}` で渡すと `initialize` が言語名に `l.data` を連結して失敗する（実測）。また `createWorker` は初期化完了まで Worker を返さず、キャンセル・タイムアウトで終了できない。直接起動なら Worker の寿命を完全に制御でき、グローバルなパッチも不要。
- **依存**: 上記のとおりメインスレッドで tesseract.js を import しないため、`package.json` / `package-lock.json` には追加していない（未使用の推移依存を増やさない）。版・SHA-256・tarball integrity は `src/lib/ocr/assets.ts` に固定し、準備scriptが検証する。固定vendor配布物を直接依存として管理する通常実装判断であり、不要なnpm依存を追加しない。
- **オフライン**: 言語データだけを専用 CacheStorage `ocr-models-v1` へ保存する（`src/lib/ocr/model-cache.ts`）。固定URL・サイズ・SHA-256 を検証してから保存・読込し、画像・ファイル名・認識結果は保存しない。保存できなくてもオンラインで認識する。Worker/core の `.js` は現行SWが実行時キャッシュする。
- **既存SWの制約**: 現行SWは有効化時に自分のキャッシュ以外を全削除するため、サイト更新後は `ocr-models-v1` も消え、次回に再取得・再検証する。SW変更は禁止のため、オフライン再認識の保証範囲は「同じサイト版のあいだ」。
- **配信**: `/vendor/ocr/<版>/` と `/models/ocr/<revision>/` はコミットして静的配信する（`.gitignore` 追加なし）。`_headers` は変更しない（immutable なし）。
- **追加ファイル**: 計画外だが同ディレクトリの責務として `src/lib/ocr/model-cache.ts`（モデルのキャッシュ層・単体テスト可能）、`tests/e2e/helpers/ocr.ts` を追加。`src/lib/tools/tool-icons.ts` に `ScanText` を登録した。

- ライセンス補完: src/lib/ocr/licenses.tsと固定原文21件を追加。Worker付属LICENSEも配布し、準備script/unitで検証する。
- 最終状態: 全unit1742件・OCR/delivery E2E72件成功。既存SQLの局所環境での失敗、Claude最終再レビューの利用上限はwalkthrough.mdに明記。Merge/Deployは別途承認を残す。
