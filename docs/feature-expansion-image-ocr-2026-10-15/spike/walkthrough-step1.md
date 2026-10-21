# 画像OCR 実測記録（ステップ1: 資産配信・精度・時間スパイク）

日付: 2026-10-15 JST。対象: `implementation_plan.md` §4 の「最初の合格条件」。UI本実装には未着手。
本書の数値は下記コマンドの実出力のみ。測っていない項目は「未測定」と明記する。

## 1. 固定した版・ライセンス・SHA-256

| 資産 | 版/revision | ライセンス | 配信パス | bytes | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| tesseract.js（`worker.min.js`） | 7.0.0（npm latest、2025-12-15公開、gitHead `42eae669…`） | Apache-2.0 | `/vendor/ocr/7.0.0/worker.min.js` | 111,307 | `576b7df7…182c6d` |
| tesseract.js-core（LSTM専用・relaxed-SIMD） | 7.0.0（gitHead `acffef2b…`） | Apache-2.0 | `/vendor/ocr/7.0.0/core/tesseract-core-relaxedsimd-lstm.wasm.js` | 3,905,767 | `861a5365…9a59b3` |
| 同・SIMD | 同上 | 同上 | `…/core/tesseract-core-simd-lstm.wasm.js` | 3,899,472 | `c58b46a4…447b38` |
| 同・非SIMD | 同上 | 同上 | `…/core/tesseract-core-lstm.wasm.js` | 3,896,484 | `eef5f8b2…e8680` |
| tessdata_fast `jpn.traineddata` | コミット `87416418657359cb625c412a48b6e1d6d41c29bd`（2024-08-01） | Apache-2.0 | `/models/ocr/<revision>/jpn.traineddata` | 2,471,260 | `1f5de923…91b4d` |
| tessdata_fast `eng.traineddata` | 同上 | 同上 | `/models/ocr/<revision>/eng.traineddata` | 4,113,088 | `7d4322bd…170b2` |

- 完全なSHA-256・npm tarballのsha512 integrityは `src/lib/ocr/assets.ts`（正本）。tarball sha256: tesseract.js `9a93bf51…`、core `ba584355…`。
- ライセンス全文は準備scriptが `LICENSE-*.txt` として同じ配信ディレクトリへ配置する。THIRD-PARTY-NOTICES.md への追記は本実装で行う（未実施）。
- `tesseract.js@7.0.0` の依存は `tesseract.js-core ^7.0.0`。ブラウザ向け依存の `bmp-js` / `idb-keyval` / `wasm-feature-detect` / `zlibjs` / `regenerator-runtime` 等は本実装でのライセンス監査が未実施（`npm install` 時に実施する）。
- 既存依存の更新はしていない。`package.json`/`package-lock.json` は未変更（スパイクは npm pack した一時ディレクトリ `D:/tmp/ocr-spike` のESMバンドルを使用）。
- core は LSTM専用（`OEM.LSTM_ONLY`）の3経路のみ配置。ブラウザは1回に1経路だけ取得する。`.wasm` 単体や legacy 版は取得されないため配置しない。

## 2. 追加・変更したファイル

- `src/lib/ocr/assets.ts`（マニフェスト）、`scripts/prepare-ocr-assets.mjs`（取得・sha256/integrity検証・`--check`）
- `public/vendor/ocr/7.0.0/`（12 MiB、3 core + worker + license）、`public/models/ocr/<revision>/`（6.4 MiB）。**コミット対象**（`.gitignore` は変更しない。独立レビューの指摘に従い戻した）
- `tests/fixtures/image-ocr/`（`generate.mjs`、画像、`truth/*.txt`、`manifest.json`）
- `docs/feature-expansion-image-ocr-2026-10-15/spike/`（`spike.mjs`、`spike.html`、`results-step1-run2.json`）

## 3. 実行コマンドと結果

| コマンド | 結果 |
| --- | --- |
| `node scripts/prepare-ocr-assets.mjs` / `--check` | 成功（9ファイルのsha256・bytes一致） |
| `node tests/fixtures/image-ocr/generate.mjs` | 成功（清明12枚 / 1,206文字） |
| `node docs/.../spike/spike.mjs <dist> <results.json>` | 全段階完了、約21秒。2回実施（下記） |
| `npx biome check --write src/lib/ocr tests/fixtures/image-ocr/generate.mjs` | 整形のみ適用 |
| `npm run lint` / `check` / `test:unit` / `build` / E2E | **未実行**（本ステップは本実装前のスパイク） |

### スパイクの失敗と原因（正直な記録）

初回の `spike.mjs` は10分でタイムアウトしたが、原因は未確定のままログを失った。外側timeout・段階別保存を追加して再実行し、全段階が完了した（診断では初期化 0.2 秒・1画像認識 0.4 秒）。
初回の停止は、最後に置いていた「言語データ404」試験で `createWorker` に `errorHandler` を渡さず初期化Promiseがsettleしなかった可能性が高いが、**初回を再現して確認はしていない**（推定）。`errorHandler` で reject し、再初期化で復帰できることは実測した（§4）。

## 4. 実測結果

環境: Windows 11、Intel Core i7-13700F（24論理コア）、RAM 63.8 GiB、Playwright同梱 Chromium 156.0.8078.4（headless）。**高性能PCの1環境のみ**。モバイル実機・低スペックPCは未測定。

### 配信・CSP

- 現行 `public/_headers` の既定CSP（先頭ブロック）をそのままHTTPヘッダで付与（COOP/COEPも同じ）。緩和なしで Worker（blob: 経由 importScripts）・core・jpn/eng が全て成功、`requestfailed` なし、console error/pageerror なし。
- ページ側で観測したリクエストの origin は同一オリジンのみ（`blob:` はWorker起動用）。jsDelivr等への通信なし。
- 既定の読込（relaxed-SIMD core + jpn + eng + worker）の実配信バイト数（サーバー側記録、HTTP圧縮なし）: 111,307 + 3,905,767 + 2,471,260 + 4,113,088 = **10,601,422 B（約10.1 MiB）**。30 MiB 目標以内。CDPの転送量（圧縮後）は Worker リクエストが取れず**未測定**。
- core の選択: 既定判定は relaxed-SIMD を取得。SIMD版・非SIMD版のcoreファイルを `corePath` で直接指定して初期化・認識が成功（CER 0）。ただしV8側でSIMDを無効化した「判定→非SIMDへ自動フォールバック」自体は**未測定**（コード上は `wasm-feature-detect` で分岐）。
- 最大ファイルは 4.11 MB（`eng.traineddata`）。Pagesの 25 MiB/ファイル制限内（`npm run build` の `check-pages-assets` は未実行）。

### 精度（清明な活字12枚 / 1,206文字 / 日本語＋英語モード、フォント: Meiryo・Yu Mincho・BIZ UDGothic、PNG/JPEG）

- 比較の前処理は CRLF→LF と改行除去のみ。空白やUnicodeは正規化しない。
- **CER 合計 2.40%（29/1,206）**。基準 5% 以下を満たす。参考値として、空白を全て除いた比較では 1.99%（合否判定には使わない）。

| 画像 | 誤り/正解文字数 | CER |
| --- | ---: | ---: |
| 01 Meiryo 文章 | 0/88 | 0.00% |
| 02 Yu Mincho 文章 | 2/86 | 2.33% |
| 03 BIZ UD 手順 | 1/91 | 1.10% |
| 04 Meiryo 混在 JPEG | 2/109 | 1.83% |
| 05 Yu Mincho JPEG | 1/94 | 1.06% |
| 06 BIZ UD 数値・記号 | 5/113 | 4.42% |
| 07 Meiryo 英語 | 0/182 | 0.00% |
| 08 Yu Mincho ニュース | 1/100 | 1.00% |
| 09 BIZ UD 22px JPEG | 7/112 | 6.25% |
| 10 Meiryo 40px | 0/35 | 0.00% |
| 11 Yu Mincho 記号混在 | 6/97 | 6.19% |
| 12 BIZ UD レシピ | 4/99 | 4.04% |

- 画像別では 09（小さい文字・JPEG）と 11（記号・全角/半角混在）が5%を超える。合計は合格だが苦手条件がある。誤認識の具体内容の分析は未実施（認識結果全文は `results-step1-run2.json`）。
- 苦手条件の参考測定（合否外、各1枚）: 低解像度 5.77%、4°傾き 5.66%、JPEG q20 3.17%、**縦書き 118.52%（非対応）**。1枚ずつなので一般化しない。縦書きは使えないことをUIで明示する必要がある。
- fixture は生成後固定。誤認識に合わせた正解文の変更はしていない。fixtureはCanvas描画の合成画像で、実写・スキャン・スクリーンショットの精度は**未測定**。

### 時間（約3.15MP: 2048×1536、モデル取得を除く、Worker作成済みのwarm状態、同一入力3回）

- 1回目の実施: 2,300 / 3,226 / 2,335 ms（中央値 2,335 ms）。2回目の実施: 1,600 / 1,447 / 1,454 ms（中央値 1,454 ms）。いずれも基準の30秒以内。実行間で最大約1.6倍のばらつきがある。
- 3MP合成画像（日本語・英語の密な28行）のCERは9.24%（3回とも同値）。**時間は通ったが精度は清明群より悪い**ため、大画像での品質は本実装で別途評価が必要。
- メインスレッドのタイマー遅延は認識中の最大 1 ms（Worker実行のためUIはブロックされない）。
- 初期化（Worker作成+core+言語データ読込、ローカルHTTP）は 0.1〜0.2 秒前後。ネットワーク越しの初回体験は**未測定**。メモリ使用量は**未測定**。

### cancel / terminate / 失敗

- 認識開始1.5秒後の `worker.terminate()` は呼び出し側で即座に完了（awaitは0 ms）。terminate後もメインスレッドの遅延は 1 ms。新しいWorkerを作り直すと再認識に成功（134〜211 ms）。
- **重要**: terminate後、進行中だった `recognize()` のPromiseは3秒待っても settle しなかった（resolve/rejectされない）。`client.ts` は自前のキャンセル/タイムアウトで確実にsettleさせ、古い結果を破棄する設計にする必要がある。
- 言語データ404: `errorHandler` を渡して reject させると初期化は約0.17秒で `Error … 404` として拒否され、同じページで正しい言語を再初期化して復帰できた。`errorHandler` を渡さない場合の挙動（初回タイムアウトの推定原因）は再現していない。
- 120秒の認識タイムアウトは未実装・未測定（スパイクでは最大待機が全て120秒以内に終了）。

### privacy（スパイク範囲）

- `cacheMethod: 'none'` + `gzip: false` で認識後の IndexedDB 名一覧・Cache Storage・localStorage・sessionStorage はいずれも空、URLに変化なし。合成マーカー画像の通信・ログ漏出検査は**未実施**（本実装のE2Eで行う）。

## 5. 現行 build / SW の挙動（変更なし。コード確認のみ）

- `scripts/generate-sw.mjs` は precache対象ページから `models` / `vendor` ディレクトリを除外し、`assetURLs` は `dist/_astro/*` と transcribe の allowed runtime だけ。`public/vendor/ocr` と `public/models/ocr` の資産は precache されない（**ソース確認のみ。`npm run build` で `dist/sw.js` を実生成して確認していない**）。
- `tesseract.js` 本体は本実装でVite経由のlazy chunk（約63 KB）として `dist/_astro/` に出力され、他のチャンクと同様 precache されると予想される（未確認、軽量）。トップページ初期bundleへの混入は動的 import で避ける（未検証）。
- 既存SWは `.traineddata` を `cache.put` しない（独立レビュー指摘）。モデル取得後のオフライン再認識は HTTPキャッシュ依存になり、**未検証**。SW変更は禁止のため、オフライン対応は「資産取得済みのHTTPキャッシュで再認識できるか」を本実装で実測し、できなければ仕様から外して報告する。
- `public/_headers` に `/vendor/ocr/*` `/models/ocr/*` の `Cache-Control: immutable` 行は無い（`_headers` は権限/CSP領域に近いため変更していない）。ヘッダ未設定ではCloudflare Pagesの既定キャッシュになる。計画変更が必要か人間判断を要する。

## 6. 本実装で扱う前提の確認

- GIF/APNG/アニメーションWebP: Tesseract.js は入力のアニメーションを判別しない（スパイクでは未測定）。入力ファイルのコンテナ（GIF、PNGの `acTL`、WebPの `ANIM/ANMF`）を本実装側で判定し拒否する前提。
- 総画素数12MP・出力10万文字・120秒タイムアウト・EXIF向き・透明背景の白合成: 本実装で扱う（スパイクでは未測定）。入力はスパイクでは File Blob をそのまま `recognize` に渡している。本実装でCanvas経由にするかは未決。
- privacy（画像・認識文字を保存しない）は上記のとおり、設定面で保存先なしを確認。通信漏出検査は本実装で実施。

## 7. 判定と計画への指摘

| 条件 | 結果 |
| --- | --- |
| CSPを緩めず同一オリジンで全資産取得 | 合格（スパイクのヘッダ再現環境） |
| 初回転送 30 MiB 以下 | 合格（約10.1 MiB、無圧縮のサーバー送出量） |
| 清明画像 CER 合計 5% 以下 | 合格（2.40%） |
| 3MP warm 3回 中央値30秒以下 | 合格（2.3秒/1.5秒、この高性能PC・合成画像のみ） |
| cancel/terminate | 合格。ただし terminate後のPromise未settle に要対応 |
| 現行build/SWで全量precacheされないこと | ソース上は除外。実build未確認 |
| モバイル/低スペック/オフライン/非SIMD自動判定 | 未測定 |

計画変更が必要な点: (1) 資産のimmutableキャッシュ指定（`_headers`）の扱い、(2) オフライン再認識の仕様（SW変更なしでは保証できない可能性）。それ以外は計画どおり本実装へ進行可能。判断待ち。

---

# 本実装の結果（2026-10-15）

§1〜§7 は本実装前のスパイクの記録。以下は本実装後の実測。**測っていない項目は未測定と明記する。** UI の見た目の最終確認は主担当のブラウザ操作に委ねる（本担当はプログラムによる検証のみ）。

## 8. 実装内容

- `src/lib/tools/image-ocr.ts`: 入力検査（先頭ヘッダーの形式・寸法・APNG/アニメーションWebP/GIF判定、20MiB・8192px・12,000,000画素）、設定、結果の改行統一、10万UTF-16コード単位の検証、TXT生成（UTF-8・BOMなし・LF）。
- `src/lib/ocr/client.ts`: 固定Workerを直接起動する接続層。`decodeImageForOcr`（EXIF向き反映・白合成・PNG化）と `recognizeImage`（言語データ取得→Worker→認識。全経路で terminate し Promise を確定）。
- `src/lib/ocr/model-cache.ts`: 言語データの取得・サイズ/SHA-256検証・専用CacheStorage。`src/lib/ocr/assets.ts`: マニフェスト。`scripts/prepare-ocr-assets.mjs`: 準備・検証。
- `src/components/tools/ImageOcr.tsx`、`src/content/tools/image-ocr.md`、`src/pages/image-ocr.astro`、`src/lib/tools/catalog.ts`（`image-ocr`）、`src/lib/tools/tool-icons.ts`（`ScanText`）、`README.md`（59種・行・出典）、`THIRD-PARTY-NOTICES.md`、`docs/data-management.md` §4。
- 資産（`public/vendor/ocr/7.0.0/`・`public/models/ocr/<revision>/`、計約18 MiB）はコミット対象。

## 9. 計画からの変更・判断が必要な点（Codexへ）

1. **公式 `createWorker` を使っていない**。tesseract.js 7.0.0 に次の2つの問題があり、実測で確認した（`D:/tmp` の一時プローブ。再現手順: 言語を `{code,data}` で `createWorker` に渡す）。(a) `initialize` が言語名に `l.data`（バイト列）を連結し、`Error opening data file ./24,0,0,…` で失敗し、`createWorker` の Promise は settle しない。(b) `createWorker` は初期化完了まで Worker を返さず、キャンセル・タイムアウト時に終了できない。そのため固定 `worker.min.js` を直接 Worker として起動し、公式Workerが受けるメッセージ（`load`/`loadLanguage`/`initialize`/`recognize`）だけを送る。`loadLanguage` に検証済みデータを `{code,data}` で渡し、`initialize` には言語名の文字列を渡すと動く。グローバルな Worker コンストラクタのパッチは使っていない。内部メッセージ形式は 7.0.0 固定版（SHA-256固定）にだけ依存する。
2. **`tesseract.js` を `package.json` に追加していない**（上記1のためメインスレッドで import せず、未使用の推移依存 `node-fetch` 等を増やさない）。`package.json`/`package-lock.json` は未変更。`npm audit` は既存の5件（low 3・moderate 2: dompurify, fflate, katex, mermaid, satori）のままで、依存を変えていないため新規の指摘はない（`scripts/security-audit.mjs` は比較元SHAが必要でCI形式では未実行）。依存追加を求める場合は指示がほしい。
3. **既存SWが言語データ用の専用キャッシュを消す**: `public/sw.js` の `activate` は自分の `CACHE_NAME` 以外のキャッシュを全削除する。サイト更新で新SWが有効化されると `ocr-models-v1` も消え、次回の読み取りで再取得・再検証する。オフライン再認識が保証されるのは同じサイト版のあいだ（SW変更禁止のため解消していない）。同じサイト版でのオフライン再認識は E2E で実測した（§10）。
4. Worker/core を実行時にSWがキャッシュする挙動は E2E で確認（オフライン時、`worker.min.js` と core は `fromServiceWorker`）。`.traineddata` は SW を経由せず専用キャッシュから読む。
5. `astro check` は `public/` 配下も走査するため、`public/vendor/ocr/**/*.wasm.js` 由来のヒント/警告が出力に増える（エラー0、終了コード0）。tsconfig は変更していない。
6. 現行CSPのままで動くことは確認したが、**ドキュメントだけでなく Worker スクリプトにも COOP/COEP が要る**（`Cross-Origin-Embedder-Policy: credentialless`）。本番の `_headers` は `/*` なので `/vendor/ocr/**` にも付くため問題ないが、E2E で CSP を再現する際は全同一オリジンレスポンスに付ける必要があった。

## 10. 検証コマンドと結果

| コマンド | 結果 |
| --- | --- |
| `npm run lint` | exit 0。既存警告15・info1、`ocr` 関連の指摘なし |
| `npm run check`（astro check + biome） | exit 0。astro check は 0 errors / 0 warnings / 226 hints |
| `npm run build` | exit 0。ページ63・SW資産509、Pages 25 MiB制限内。`dist/sw.js` に `vendor/ocr`・`models/ocr`・`traineddata` の記載は0件 |
| `npm run test:unit` | 1,720件すべて成功（うちOCR関連 `image-ocr` 20・`ocr-client` 28・`ocr-assets` 13） |
| `node scripts/prepare-ocr-assets.mjs --check` | 成功（9ファイル）。`ocr-assets.test.ts` がコミット済みファイルのbytes/SHA-256を単体テストでも検証する（CI既存のunitだけで通る） |
| OCR E2E（`image-ocr.spec.ts` + `image-ocr-delivery.spec.ts`、chromium と mobile-chrome（Pixel 7エミュレーション））| 33件×2プロジェクト＝66件成功。連続2回実行して2回とも66件成功 |
| 既存E2E（回帰、chromium。transcribe系・video-compress系・bg-remove・upscale を除く） | 726件成功・7件失敗。失敗のうち6件は検証用に自作した静的サーバーが `/path`→`/path/` へ301リダイレクトしたことによるURL不一致で、サーバーを直して再実行し related-tools・search-navigation は成功。**残る1件**: `sql-formatter.spec.ts` の「狭い画面ではレイアウト切替を表示せず…横スクロールが発生しない」が 横はみ出し 8px（許容5px）で、単独実行でも再現。変更範囲外のページだが、ベースライン（変更前）では未確認のため「既存の失敗」とは断定できない |

- E2E は `tests/e2e/fixtures/base.ts` 経由。配信検証は素の context（SW許可）。**専用ポート4361**で自分のbuild（`dist`）を配信した。`astro preview` は別セッションが同じディレクトリで4362に起動中のため併用できず、`D:/tmp` の最小の静的サーバーを使った（`astro preview` の挙動との差は上記のとおり）。一時のPlaywright設定はコミット対象外で削除済み。
- 異常系の遅延・404・破損は `page.route` で注入。主要な認識は実モデル・実Workerで実行した。

### E2E で確認した内容（実測）

- 実認識: 清明12枚・1,206文字の合計CER **2.40%（29/1,206）**（スパイクと同じ。5%以下）。日本語＋英語／英語のみ。JPEG・PNG・WebP、透過PNG（白合成）、EXIF向き6の画像。
- 入力: 選択だけでは言語データ・エンジンを取得しない（実行ボタンで初めて取得）、複数ファイル拒否、貼り付け（テキスト欄への貼り付けには干渉しない）、APNG・アニメーションWebP・GIF・空・破損・SVG偽装の拒否、8193px・4001×3000の拒否と 4000×3000（12,000,000ちょうど）の受付、文字のない画像の案内とコピー/保存の無効化。
- 出力: 編集→コピー→TXT（UTF-8・BOMなし・LF・`元名_ocr.txt`）、10万コード単位ちょうど/超過、HTML/Markdownを解釈しない。
- 中断・失敗: 取得中キャンセル、認識中キャンセル（Workerが終了することを確認）、取得中のクリア、言語データ404、SHA-256不一致、Workerスクリプト404から復旧して再実行。いずれも古い結果・エラーが再表示されないことを確認。
- キャッシュ: 取得済みは専用キャッシュ（`ocr-models-v1`）にjpn/engだけを保存し2回目は再取得しない、CacheStorage無効・保存失敗でもオンラインで認識し日本語で案内。
- core: SIMD版・非SIMD版のcoreを返しても認識できる（**自動判定そのものは検証できていない**。V8でSIMDを無効にする手段がなかったため、relaxed-SIMD要求へ別経路のcoreを返す方法で代替）。
- 配信・privacy（通常配信）: 合成マーカー（ファイル名・PNGのtEXtメタデータ・認識結果の文）が全リクエスト（URL・本文・ヘッダー）・計測のbeacon本文・コンソール・URL・localStorage・sessionStorage・Cookie・Cache Storageのキー・IndexedDBに出ない。外部オリジンへの通信なし。送信系リクエストは既存の `POST /api/event` のみで、beaconは既存allowlist（`tool_engage`/`tool_run`/`settings_restore`、props キー一致）。保存は言語モードの設定と既存の `recent_tools`（slugのみ）だけ。
- オフライン: 取得後に `setOffline(true)` → 再読み込み → 同じ画像を再認識に成功（言語データは専用キャッシュ、Worker・coreはSW）。言語データのネットワーク要求は0件。
- 現行CSP（`public/_headers` の既定をそのまま全同一オリジンレスポンスへ付与）: 違反なし、認識成功、許可外オリジンへの接続は違反として検出されることも確認。通信先は同一オリジンのみ。
- 全サイトprecache・トップページ: `sw.js` に OCR資産の記載なし、トップページの読み込みにOCR資産・ImageOcr・tesseractのリクエストなし。
- UI: キーボード（Enter）で実行、ラベル・プレビュー画像の名前、長い出力・長いファイル名で横にはみ出さない（mobile-chrome はエミュレーションで、実機ではない）。

## 11. 未測定・未実施（成功とは言えない項目）

- モバイル実機、低スペックPC、メモリ使用量、ネットワーク越しの初回体験、圧縮後の転送量。
- 120秒タイムアウトの実時間での E2E（単体テストで、応答しないWorkerでもタイムアウト短縮値で確定することを確認。既定値120,000msの定数も確認）。
- V8でSIMDを無効にした自動フォールバック。
- 実写・スキャン・スクリーンショットの精度。劣化・傾き・縦書きは参考測定のみで、非対応のまま。
- サイト更新（SW再有効化）後に専用キャッシュが消えることの実測（コードの記述からの説明であり、再現は未実施）。
- `sql-formatter` の1件がベースラインでも失敗するか。transcribe系・video-compress系・bg-remove・upscale のE2E（今回の変更と無関係のため除外）。
- 独立レビュー（Codex・別Claudeセッション・agy）。THIRD-PARTY-NOTICES の core 内静的リンクライブラリの個別確認。
