# 同一オリジンONNX runtime配信の検証・配備手順

Risk Class: R3。新規修正PRの初期実装（修正ループ0/3）。#389の修正履歴をリセットするものではない。

## 変更と配備順序

#389の本番配備はasyncify WASM 26,861,777 bytesがPagesの25MiB制限を超え失敗した。
Transformersが使用するORTだけを既存vendor URLへ解決し、manifestの静的コピーをPages出力から除く。
他のORT（upscaleの1.27.0）やAVIF/QR等のcodecは維持する。依存・CSP・音声処理・モデル取得先は変更しない。

1. 同じlockfileで`npm ci`、`node scripts/upload-onnx-runtime-to-r2.mjs`を実行し、全4ファイルの版・サイズ・SHA-256を確認。
2. 既存`codelife-models`の`onnx-wasm/`を読み取り確認。キーは`onnx-wasm/<version>/<sha256>/<filename>`。既存内容を差し替えず、同じURLの実体を変更しない。
3. 既存Wranglerの`bin/wrangler.js`を`WRANGLER_JS`に指定し、承認済み配置時だけ`node scripts/upload-onnx-runtime-to-r2.mjs --upload`。新規バケット・認証・権限・binding・契約は作らない。配置後は全量読み戻し検証。`--verify`は読み取りのみ。
4. `npm run build`。`dist`のvendor runtimeはFunctionで配信するため、通常のAstro previewでは実runtime配信を検証できない。公開前にR2配置を完了する。ビルド終端で全静的ファイルの25MiB上限を検査する。
5. 最新SHAの必須lint/e2eと独立Code/Security Review、未解決finding、最新main、strict gateを確認する。Draftや未完了ゲートのままMergeしない。
6. 既存Pages deployを確認し、公開URLで`node scripts/verify-transcribe-delivery.mjs --base <origin> --sha tiny`を実行。runtimeは全4ファイルのGET/hash、HEAD/サイズ/MIME/cacheを確認する。失敗時に外部CDNへ切り替えない。

## ローカル検証（2026-10-08）

- `npm run build`成功。Pages全ファイル25MiB以下。対象runtimeの重複emitなし。他のORT/codec WASMは残存。
- `npm run check`成功（Astro 0 errors）。Biomeの既存15 warnings、1 infoは変更していない。
- `npm run test:unit`: 1,418件成功。配信GET/HEAD/304、MIME/cache、未知/encoded path、POST、binding欠落、R2障害/欠落、サイズ不一致/空body、25MiBちょうどと+1 byteを検証。
- `npx playwright test tests/e2e/transcribe.spec.ts tests/e2e/bg-remove.spec.ts --workers=2`: PC/mobile合計36件成功。
- `wrangler pages functions build functions --outdir <QA output>`: Worker compile成功。
- 配置したR2全4ファイルをWranglerで読み戻し、サイズ・SHA-256一致。保存追加は41,204,053 bytes、既存Standard bucket/契約/権限を使用。通常の保存・操作利用量は増える。
- 本番生成済みWorker＋9個のhash確認済みtinyモデルを、実装Functionを呼ぶローカルR2アダプター経由で確認。Chrome通常起動（unsafe GPU flagsなし）のWASM load2,032ms/infer1,447ms、WebGPU load1,496ms/infer2,182ms、WebKitの非asyncify WASM load1,560ms/infer1,578ms。いずれもready→segment→done、外部要求0、page error0。
- 2秒16kHzの合成tone（Float32Array）であり、音声認識精度は評価していない。Playwright WebKitは実Safari端末検証の代替ではない。
- SW有効のChromeで4ファイルのcold取得→ネットワークofflineでwarm取得（全200、manifestサイズ一致）。SW内容更新・controllerchange後も新cacheで同じ4ファイルをoffline取得成功。古いクライアントが旧SWへ状態確認を送ると旧cacheを再作成する既存挙動を観測。URLは版固定で混在しないが、旧cacheの即時完全消去は保証しない。
- ローカルQAの音声fixture/起動順序を訂正した際の一時失敗は製品成功として数えていない。QA専用HTMLをdistから除き、全unitを再実行して成功。

## 未完了ゲート・制限

GitHub最新SHAの全CI・独立レビューと実Cloudflare Functionの公開URLによる検証はPRで追跡する。
本番には`TRANSCRIBE_MODELS=codelife-models` bindingがある。previewにはR2 bindingがないことをAPIで確認した。
previewに既存bucketを追加bindingするにはpreview Functionへbucketアクセス権を追加するため、個別承認なしに設定しない。
本番配備前にcloud previewで確認する場合、この追加bindingの承認が必要。
base/small、実Safari端末、実音声の精度は未検証。MakerはこのPRを自己承認しない。
