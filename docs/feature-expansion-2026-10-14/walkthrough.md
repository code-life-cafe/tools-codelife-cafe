# PDF圧縮・PDF→JPG/PNG変換 実装ウォークスルー

作成日: 2026-10-14。担当: Claude Maker（初期実装・テスト）、Codex（独立検証・指摘修正・Draft PR準備）。
対象: [implementation_plan.md](implementation_plan.md)（2026-10-14 ユーザー承認済み）の「PDF圧縮」「PDF→画像」。
実装・検証を専用worktreeで実施。レビュー結果は [reviews.md](reviews.md)。Merge・Deployは対象外。

## 変更ファイル

| 区分 | ファイル |
| --- | --- |
| 共通（純粋） | `src/lib/pdf/common.ts`（上限・入力検証・画素計算・日本語エラー） |
| 描画（DOM） | `src/lib/pdf/render.ts`（PDF.js 読み込み・canvas描画・プレビュー） |
| PDF圧縮 | `src/lib/tools/pdf-compress.ts`、`src/components/tools/PdfCompress.tsx`、`src/content/tools/pdf-compress.md`、`src/pages/pdf-compress.astro` |
| PDF→画像 | `src/lib/tools/pdf-to-image.ts`、`src/components/tools/PdfToImage.tsx`、`src/content/tools/pdf-to-image.md`、`src/pages/pdf-to-image.astro` |
| 登録 | `src/lib/tools/catalog.ts`（2エントリ、`llmsFull` 含む）、`README.md`（PDF表2行・件数・PDF.jsの記載） |
| 依存 | `package.json`、`package-lock.json`（`pdfjs-dist` 6.4.299 を固定版で追加） |
| テスト | `tests/unit/pdf-compress.test.ts`、`tests/unit/pdf-to-image.test.ts`、`tests/e2e/pdf-compress.spec.ts`、`tests/e2e/pdf-to-image.spec.ts`、`tests/e2e/helpers/pdf-expansion.ts` |
| フィクスチャ | `tests/fixtures/pdf-expansion/`（生成スクリプトと合成PDF 7件、計約850KB。個人情報なし） |

- `src/components/tool/registry.ts`（旧URL用の ToolIsland レジストリ）は新ツールで使わないため変更していない。
- 既存 `src/lib/tools/pdf.ts` は変更していない（`hasPdfSignature`・`parsePageRanges`・`ENCRYPTED_PDF_MESSAGE` を import して再利用）。
- AGENTS/CLAUDE/CI/Deploy/CSP/PWA/analytics/WebMCP は変更していない。WebMCP登録は範囲外。

## 依存（PDF.js）

- `pdfjs-dist@6.4.299`（Apache-2.0、engines: node >=22.13.0 || >=24）。optional dependency の `@napi-rs/canvas@1.0.11`（Node用、ブラウザbundleには含まれない）が lock に追加される。既存パッケージの版は変更なし。
- ローカルの npm 11.3.0 で install すると、既存 lock エントリの `libc` フィールドが66行消える差分が出た。npm 12.2.0（`npx npm@latest`）で取り直し、追加のみ（+278行）の差分にした。
- `npm audit`（追加後）: low 3 / moderate 3 / high 0 / critical 0。該当は dompurify・fflate（satori経由）・katex（mermaid経由）・smol-toml でいずれも既存依存。`pdfjs-dist` と `@napi-rs/canvas` に既知脆弱性の該当はない。
- **legacy ビルドを採用**: modern ビルド（`build/`）は `Map.prototype.getOrInsertComputed` 等の新しいAPIを前提にしており、モバイルSafari等の互換性に懸念があるため、polyfill を含む `legacy/build/pdf.mjs` を使う。
- PDF 6 では `isEvalSupported` オプションが廃止され、`pdf.mjs`・`pdf.worker.mjs` に `eval(` / `new Function` が含まれないことを確認した。

## 同一オリジン配信（Vite標準経路）

- Worker: `pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url` で Vite の module worker として `/_astro/pdf.worker.min-*.js` に出力（既存 Worker と同じ形式）。当初の `?url` では `.mjs` のまま出力され、Cloudflare Pages の静的 `.mjs` 配信には前例がない（既存の ORT `.mjs` は専用 Function で Content-Type を付与）ため切り替えた。
- CMap（168件）・標準フォント（14件）・wasm（openjpeg・jbig2）: `import.meta.glob(..., { eager: true, query: '?url&no-inline' })` で個別アセットとして出力し、`useWorkerFetch: false` と独自 `BinaryDataFactory` でファイル名→URLを引いて `fetch` する。小さいファイルも data: URL にインライン化されないこと（CSP `connect-src 'self'` の範囲）をビルド出力で確認した。
- ICC（qcms wasm）は `useWorkerFetch: false` だと PDF.js 側で無効になり、CMYK/ICC画像は PDF.js 内蔵の近似変換で描画される。quickjs（スクリプト実行用）・`pdf.sandbox` は読み込まない。
- `getDocument` は `data` のみで呼び、`disableAutoFetch` / `disableStream` / `disableRange` を指定、`enableXfa: false`。注釈は見た目だけ canvas に描画し（`AnnotationMode.ENABLE`）、注釈レイヤー（リンク・フォーム操作）は生成しない。
- 既存の build / PWA / CSP 設定は変更していない。

### bundle・precache への影響（`npm run build` 実測）

| 出力 | サイズ | 読み込み時期 |
| --- | --- | --- |
| `PdfCompress.*.js` / `PdfToImage.*.js` | 18.9KB / 13.9KB | 各ツールページのみ |
| `render.*.js`（アセット対応表を含む） | 24.0KB | 各ツールページのみ |
| `pdf.*.js`（PDF.js本体） | 488KB | ファイル選択時に dynamic import |
| `pdf.worker.min-*.js` | 1.22MB | 同上（Worker） |
| CMap 168件 / 標準フォント 14件 | 1.17MB / 0.77MB | 必要なファイルだけ取得 |
| openjpeg / jbig2 wasm | 251KB / 104KB | JPX / JBIG2 画像の描画時のみ |

- トップページ（`dist/index.html`）は `render.*` / `pdf.*` を参照しない（初期bundleへの PDF.js 混入なし）。トップの増加は catalog の2エントリ分のみ。
- `scripts/generate-sw.mjs` は `dist/_astro/` 全ファイルを precache するため、上記アセット（合計約4.0MB）が Service Worker の precache に加わる（PWA設定は編集禁止のため未対応。オフライン利用方針と整合するが、初回インストール容量が増える点は主担当の判断事項）。

## 仕様と実装の対応

### PDF圧縮

- 入力: 1ファイル、50MiB以下（50MiBちょうどは可）、1〜100ページ。`%PDF-` シグネチャ・空ファイル・非PDFを読み込み前に拒否。
- 事前検査（`inspectPdfForCompress`）: pdf-lib で暗号化（`ignoreEncryption` 再読込で判定）・破損（ページツリー欠落などの想定外例外も破損として日本語化）・ページ数を検査。
  - 署名: カタログ `/Perms`、AcroForm `SigFlags > 0`、全間接オブジェクト（圧縮オブジェクトストリーム内を含む）の `/Type /Sig` `/DocTimeStamp` `/FT /Sig` `/ByteRange`+`/Contents` を検出。さらに生バイト列を1MiBずつ走査（境界64Bの重なり）。
  - フォーム: AcroForm の `Fields` 非空、`XFA`、全オブジェクト中の `/Subtype /Widget`（Fields が空でも残っているウィジェット）。
  - PDF.js の `IsSignaturesPresent` / `IsAcroFormPresent` / `IsXFAPresent` / `EncryptFilterName`（閲覧パスワードなしで開ける暗号化PDFを含む）でも二重に拒否（`assertCompressibleFlags`）。
  - 検出できない例: 署名・フォームの痕跡がPDF構文として解析できず、かつ生バイト列にも平文で現れない（例: 破損した圧縮ストリーム内にのみある）ケースは検出できない。この場合も pdf-lib が解析できなければ破損として拒否される。
- 標準（lossless）: 同じ文書を pdf-lib で読み込み、`/Filter` のないストリーム（XRef・ObjStm・Metadata・DecodeParmsのあるストリームを除く）を `CompressionStream('deflate')` で Flate 化（24B以上小さくなる場合のみ置換）し、`useObjectStreams: true` で再保存。文字・ページ・リンク・注釈は文書構造ごと維持。結果が元以上なら元のバイト列をそのまま返し「これ以上小さくできませんでした」と表示し、保存ボタンを出さない。
- 画像化（raster）: ラジオで明示選択し、失われる情報（文字選択・検索、リンク・しおり・注釈・フォーム・添付、画質）を表示。同意チェックまで実行ボタンは無効。方式と同意は保存せず、ファイルを選び直すと「標準」に戻る。72/96/144dpi と JPEG品質 50/70/85/92% を選択（設定は `useToolSettings` で dpi・品質のみ保存）。
  - 各ページを PDF.js で表示上の向き（`/Rotate` 適用後）に描画し、`transform` で画素数ちょうどに合わせ、白背景 JPEG にして即座に pdf-lib の新規文書へ埋め込む（描画結果を溜め込まない）。ページ寸法は表示上の pt（回転ページは縦横を入れ替え、`/Rotate 0`）。
  - 1ページ16,000,000画素超を描画前に拒否（ページ番号と画素数を表示）。結果が元以上なら元を返す。
- 進捗（標準は%、画像化はページ数）・キャンセル（AbortController で描画タスクも中断）・元PDFと圧縮後の1ページ目プレビュー・前後サイズ・削減率・ページ数・処理時間を表示。出力名は `元の名前_compressed.pdf`。元ファイルは変更しない。

### PDF→JPG/PNG

- 入力上限は圧縮と同じ。PDF.js で開き、暗号化（閲覧パスワードなしのものを含む）・破損・ページ数を拒否。
- ページ範囲は既存 `parsePageRanges`（全角・空白許容、位置付き日本語エラー）で検証し、重複を除いた昇順で出力。初期値は全ページ（`1-N`）。範囲は保存しない。
- 形式 JPG（白背景、品質選択）/ PNG（`alpha: true` の canvas と透明背景で、ページに背景のない部分は透過）を選択。UIで扱いを説明。72/96/144dpi。描画前に選択ページの16MP上限を確認。
- 1ページずつ描画→Blob化→canvas解放。保持する画像の合計が200MiBを超えたら、その画像を破棄して停止し、未変換の先頭ページを案内する。
- 個別保存のみ（ZIPなし）。連番ファイル名 `元の名前_p01.jpg`（総ページ数に合わせて0埋め、最低2桁）。プレビューは選択中の1枚分だけ ObjectURL を持ち、差し替え・アンマウント時に解放。
- 埋め込み画像の抽出ではないことをUI・FAQで説明。

### 共通（状態管理・privacy・a11y）

- 読み込みは loadId、処理は `useSingleResultProcessing` の runId と AbortController で管理し、別ファイル選択・再実行・クリア・アンマウント時に古い結果やプレビューを表示しない。PDF.js の文書（Worker側を含む）は `loadingTask.destroy()` で解放。
- 入力ファイル・ファイル名・結果は通信・ログ・localStorage・URLに保存しない。localStorage は `tool_settings_pdf-compress`（dpi・jpegQuality）、`tool_settings_pdf-to-image`（format・dpi・jpegQuality）のみ。計測は既存 `useToolAnalytics(...).trackRun()` のみ（tool slug 以外の入力由来情報は送らない）。
- UI は既存 FileDropzone・shadcn（Button・Checkbox・Input・ToggleGroup）・Lucide。エラーは `role="alert"`、処理中・結果は `role="status"`/`aria-live`、進捗は `role="progressbar"`。非PDFを accept で弾いた場合も日本語エラーを表示（`onValidationError`）。

## 検証結果（ローカル、2026-10-14、Node v22.23.2 / Playwright 1.63.0 / Windows 11）

| コマンド | 結果 |
| --- | --- |
| `npm run lint` | exit 0。警告15件・info1件はすべて既存ファイル（CameraScanner・Bookmarklet・CronChecker・TextDiff・ZenkakuHankaku・mermaid.spec・webmcp.spec）。今回のファイルは0件 |
| `npm run check` | exit 0（astro check: 0 errors / 0 warnings / 65 hints、今回のファイルの hint 0件。Biome は上記と同じ既存警告のみ） |
| `npm run build` | exit 0（119ページ、OG 57枚、`[pages-assets] All files are within the 25 MiB Pages limit`） |
| `npm run test:unit` | 1531 tests / pass 1531 / fail 0（新規: pdf-compress 28件、pdf-to-image 12件） |
| E2E（pdf-compress・pdf-to-image・pdf-merge・pdf-split、chromium + mobile-chrome、workers=2） | 84 passed（最終コード、本番相当ヘッダー付きローカル配信） |
| E2E（smoke・seo-llms・related-tools・search-navigation・search-ranking・category-filter・accessibility・layout・og-image・legacy-tools、chromium、workers=3） | 113 passed |

- `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0` は `astro:content` / `import.meta.env` / `import.meta.glob` / `?url` 等の Astro・Vite 型が読み込まれない既存環境由来のエラーのみ（既存の `qr-reader.worker.ts` と同種）。型の判定は `npm run check` を正とした。
- **初期E2Eのサーバー**: ポート4321・4327で他作業の `astro preview`（同じworktree）が起動中だったため停止せず、gitignore 配下の一時設定（`node_modules/.cache/`、コミット対象外）で `vite preview`（`appType: 'mpa'`、`/foo`→`/foo/index.html`）をポート4339で起動して dist を配信した。`_headers`・`_redirects` は適用されない（astro preview と同様）。
- テストの有効性確認（ミューテーション）: 解析側の署名検出を無効化→hidden署名・ウィジェットの2件が失敗、`chooseSmaller` を常に採用→unchanged系3件が失敗、Flate置換を無効化→文字PDF削減テストが失敗、保持容量上限を無効化→上限テストが失敗、`render.ts` の回転を無効化して再ビルド→圧縮・画像化両方の回転画素テストが失敗。すべて元に戻して再ビルド・再実行済み。
- E2Eで独立に照合した項目: 出力PDFのページ数・寸法・`/Rotate`（pdf-lib）、日本語テキスト（Node の PDF.js + CMap で抽出し元と一致）、埋め込みJPEG・出力画像の画素寸法と赤/青マーカーの位置（sharp で 0/90/180/270度）、PNGの透過（中央 α=0）、JPGの白背景、通信先が同一オリジンのみで URL・本文にファイル名や `%PDF` が含まれないこと、localStorage・URLに入力由来の値がないこと、キーボード操作、375px で横スクロールなし。

## 実測（Chromium headless、上記 dist、`tests/fixtures/pdf-expansion/` の合成PDF）

| 入力 | 方式 | 結果 | 処理時間（UI表示） |
| --- | --- | --- | --- |
| text-ja.pdf（文字PDF・非圧縮ストリーム、3ページ、8,705B） | 標準 | 8.5KB → 2.1KB（75%削減）、テキスト・リンク維持 | 0.1秒 |
| text-ja.pdf | 画像化 72dpi/50%・96dpi/70%・144dpi/85% | いずれも元より大きく、元ファイルを保持 | — |
| scan.pdf（150dpi相当グレースケールJPEG、2ページ、833,919B） | 標準 | 縮まず元ファイルを保持 | — |
| scan.pdf | 画像化 72dpi / 品質50% | 814.4KB → 149.1KB（81.7%削減） | 0.2秒 |
| scan.pdf | 画像化 96dpi / 品質70% | 814.4KB → 275.4KB（66.2%削減） | 0.2秒 |
| scan.pdf | 画像化 144dpi / 品質85% | 814.4KB → 619.4KB（23.9%削減） | 0.2秒 |
| scan.pdf の2ページを50回複製した100ページ（41,666,006B） | 画像化 72dpi / 品質50% | 39.74MB → 7.26MB（81.7%削減） | 1.9秒（操作〜表示 2.4秒） |
| 同100ページ | PDF→JPG 144dpi（1191×1684px） | 100枚・各約310KB | 操作〜表示 3.4秒 |
| scan.pdf | PDF→JPG / PNG 144dpi | JPG 約310KB/枚、PNG 約1.69MB/枚 | — |

- 100ページ変換後の JSヒープ（`--expose-gc` で GC 後）は 9.5MiB で変換前と同じ。画像は Blob として保持され、JSヒープには残らない（Blob の合計は上限200MiBで制御）。
- 削減率は内容依存であり、全PDFに同じ率を約束しない。数値は高性能PC上の headless Chromium の参考値で、実機・モバイルでは遅くなる。

## 制約・未実施・判断事項

- モックと実装画面のPC/375pxスクリーンショットを目視確認済み。375pxでscrollWidth=375、ファイル差し替え後の読み込み表示残留なしを再確認。モバイル実機は未検証。
- 最終E2Eは既存`public/_headers`を適用したローカルHTTP配信。別の通常ブラウザコンテキストでCSP・SWを有効にし、圧縮→ユーザーの全体キャッシュ有効化→オフラインで初めてPDF→画像ページを開き変換に成功。観測範囲で外部通信、入力漏洩、CSP違反は0件。本番Cloudflareへのデプロイ後確認を代替しない。
- PDF.js本体・同梱フォント・codecのライセンス原文を`public/vendor/pdfjs-dist/6.4.299/NOTICE.txt`に配布し、`THIRD-PARTY-NOTICES.md`へ追記済み。
- トップページの目的別ブロック（`purposeCategories` の「PDFを扱う」）には新ツールを追加していない（表示レイアウトと top_block_click 計測への影響を避けた）。追加するかは判断事項。
- README の件数は変更前から実数（catalog 55件）と1件ずれて「54種」だった。追加後の実数57に合わせて更新した。
- 全ツールのオフライン保存をユーザーが有効化した場合、PDF.js関連アセット約4.0MBが全体キャッシュに加わる。通常アクセスの最小キャッシュとは別。PWA設定変更なし、トップページ初期bundleへPDF.jsを追加しない。
- 上限（50MiB・100ページ・16MP・72/96/144dpi）は計画どおりで、緩和・引き下げはしていない。16MP は 16,000,000画素として実装した（Safari の canvas 面積上限 4096×4096 未満）。
- JPX・JBIG2 画像を含む実PDFでの描画、ICC/CMYK の色再現、低メモリ端末での100ページ処理はフィクスチャを用意しておらず未検証。


## 独立検証と修正

- 標準圧縮が既存DecodeParmsを新しいFlateに適用し画像を変える事例を合成PDFで再現。対象ストリームを最適化から除外し、独立PDF.js描画の画素比較で差分0を確認。回転テストは実際に縮小した出力を必須にして偽陽性を除去。
- 読み込み中に空PDFへ差し替えると読込表示が残る問題を両UIで修正。PC/モバイル回帰テストを追加。
- 極端に細長いページのプレビューが16MPを超えないよう事前に抑制。描画処理もPDF.jsのページ取得後にキャンセルを再検査。極端なページでcanvas上限を超えないE2Eを追加。
- 間接参照のSubtype/FT/Type検出、画像化圧縮の例外日本語化、100ページ・16MP境界と事前キャンセルを単体検証。フィクスチャ生成パスをfileURLToPathへ変更し、再生成7PDFのハッシュ一致を確認。
- `npm audit --json`: low 3 / moderate 3 / high 0 / critical 0。base `be80ccec1ff52349ac1e654fdd46d4082a51a7a1`とvulnerabilities全体（advisory・severity・nodesを含む）が一致し、新規依存による追加なし。既存`node scripts/security-audit.mjs`はWindowsでnpm起動に失敗するため、CIの監査成功とは扱わない。
- Claude Codeの初期Maker検証とCodexの独立検証は役割を区別。Claude Codeの別セッションによる独立レビューは利用上限で未完了。agyのレビュー内容・対応・範囲制限はreviews.md参照。最新headの必須CIと独立レビュー完了前はDraftを維持。
