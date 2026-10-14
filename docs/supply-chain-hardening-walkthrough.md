# 外部実行資産・現行モデルの安全化 検証記録

作業日: 2026-10-14。承認済み計画に基づく実装。Claude Makerは使用上限で起動できず、ユーザーの個別承認により今回のみCodexが実装した。モデル差し替え・Merge・R2投入・本番公開は未実施。

## 実装

Risk Class: R4。資産取得・配信の信頼境界を変更するため保守的に分類。人間が本計画の実装とCodex担当変更を個別承認済み。Merge・資産投入・公開の承認は含まない。

- 背景削除のMODNet/BEN2と高品質拡大のReal-ESRGANを固定コミットSHAで取得し、全必要ファイルのサイズとSHA-256を実測してマニフェストに記録。
- 同梱fast拡大モデルは元のバイト列を維持。本リポジトリの固定コミットを由来として記録。元のONNX変換工程・公式checkpointからの完全な再現は未確認であり、新しい上流モデルへ置換したものではない。
- 背景削除はTransformers.js専用env.fetch、拡大はInferenceSession.create前で検証。config/preprocessor/quantize設定も対象。任意設定のライブラリfallbackを防ぐため必要JSONを先に検証する。
- 内蔵モデルcacheを無効化し、専用Cache Storageを使用。新規取得・cacheヒット双方を検証し、不一致対象キーだけを削除して1回再取得。未知URL・外部origin・main・query・非GETを通信前に拒否。
- 入力画像はBlobからRawImageへローカル変換し、モデル専用取得APIへ渡さない。
- Transformers側ORTとupscale直解決ORTを別マニフェストで照合し、バージョン別の自前MJS/WASM URLを使用。JS/MJS/WASMはビルドコピー前と配信read-backで検証する。ブラウザでの実行前ハッシュ検証をモデルと同等に実装したとは主張しない。
- 大容量資産は既存TRANSCRIBE_MODELSバインディングを使う同一origin静的R2ルートで配信。許可パス・hash付きキー・サイズだけを配信し、未知パスは404、未設定/不整合は503。権限・secret・バインディング・Workflow・依存版・CSPは変更していない。
- SWは対象モデルの取得を専用cacheへ委ねる。activateはcl-tools-*の旧サイトcacheだけを削除し、他ツールやモデル用cacheを保持する。

## 固定資産

| モデル | revision | ONNXサイズ |
| --- | --- | --- |
| MODNet fp32 | 6af52070d14deafc5e55ce6cc4d752a322cdff76 | 25,888,640 bytes |
| BEN2 fp16 | c552aa82688edce09f0ac9d2e31ad53d9d629010 | 219,121,675 bytes |
| Real-ESRGAN x4plus | a1f365e2ef85ca5d4c66325e76bc7e26374c9642 | 67,160,311 bytes |
| 同梱Real-ESRGAN general x4v3 | repo commit 974a11de21cc53c3eb97a27f03b687b426be5903 | 4,866,421 bytes |

全ファイルのhash/サイズはsrc/lib/model-assets/manifest.ts、直解決ランタイムはruntime-manifest.ts、Transformers側ランタイムは既存transcribe/model-manifest.tsが正本。通常ビルドで期待hashを自動更新しない。

## 検証結果

- 固定SHAから実モデルをローカル取得して全ファイルのhash/サイズを照合。取得元メタデータだけでhashを検証済みとは扱っていない。
- node scripts/fetch-model-assets.mjs --check: 全現行モデル資産一致。
- node scripts/copy-onnx-wasm.mjs --check: 両ランタイムと同梱モデル一致。
- 1byte改変した同梱モデルおよびORT MJSをcopyゲートが実際に拒否。finallyで元バイト列へ復元し、正常照合成功を確認。
- npm run build: 成功。Pages静的ファイル25MiB上限検査も成功。大容量モデル/ランタイムのローカル実体はdistから除外。
- npm run lint: 成功。既存警告15件。モデル安全化の追加エラーなし。
- npx astro check: 0 errors、0 warnings（既存hintあり）。
- npm run test:unit: 最新main取り込み後に1,547件成功（初回は1,509件）。追加検証11件は同サイズ1byte改変、サイズ不一致、破損cache、再取得上限、未知URL、配信欠落、GET/HEADとR2 keyを検証。
- 初回実Worker E2E: chromium 7件成功。全4現行モデルが正常結果を返し、改変ONNX/configと欠落configは停止。HF/jsDelivr通信は観測なし。
- 対象回帰E2E: PC・モバイル幅で54件成功、明示大容量実推論6件skip（上の別実行とは区別）。
- 全E2E（当初base 974a11dに対する安全化ビルド、専用44321ポート）: 1,382件成功、5件失敗、41件skip。5件中2件はvideo-compress.spec.tsがlocalhost:4321を固定比較し、専用ポートの同一origin通信を外部と判定したもの。残るSQL formatter横はみ出し（chromium、8px > 5px）と全角半角スイッチの色（両project、同色判定）は単独再実行でも再現した。
- 変更前のclean main 49516d8を別worktreeでinstall/buildし、SQL/全角半角4件を再実行: 同じ3件が失敗、1件成功。今回の差分以前にも同条件で再現することを確認。範囲外のProductionやテスト期待値は変更していない。最新headのCI成功とは区別する。
- 実モデルと両ランタイムのローカルread-back: 全21ファイルのサイズ/hash一致。実際の配信ハンドラとローカルR2 adapterを使用。
- 最終対象E2E（最新main aeb7879取り込み後、全4実モデルとPC/mobile幅・取り込んだcipher/JSON-CSV WebMCP回帰を含む）: 92件すべて成功、skipなし（3.3分）。SWの実制御と共通CSP/COOP/COEPを含む。
- GitHub CI/正式レビューはPR作成後の対象headと照合する。

最初の全E2Eは既存4321サーバーが別checkoutの古い成果物を配信していたため検証対象不一致として中断。既存サーバーは保持し、今回専用44321ポートの設定で再実行する。元の既存未コミット変更は隔離前のcheckoutに保持。

## 実測の範囲

最初のローカルchromium実Worker測定（32x32合成画像、取得と推論を含む。モデル性能ベンチマークではない）:

| モデル | 所要時間 |
| --- | --- |
| fast拡大 初回 / 検証済cache | 約370ms / 278ms |
| MODNet | 約1.34s |
| BEN2 | 約66.76s |
| Real-ESRGAN x4plus | 約18.24s |

Mobile Chrome projectはPC上のモバイル幅/UAエミュレーション。実スマートフォンの速度/メモリ/Safariの成功は未確認。WebGPU providerの実使用も未確認（maxのprovidersにはWASM fallbackを含む）。変更前の同条件測定とピークメモリは未取得であり、性能差を断定しない。

既存公開R2の背景削除資産とのバイト比較は全GETが403で未確認。モデル名/dtypeは維持したが、既存本番R2実体と固定上流の完全一致までは断定しない。公開判断前に取得可能な管理環境で比較する。

## 公開前の必須手順（今回未実行）

1. 承認済みマニフェストと資産を維持してnode scripts/fetch-model-assets.mjs、node scripts/copy-onnx-wasm.mjsを実行。
2. node scripts/prepare-model-assets.mjsで検証済みファイル・R2キー・URL・MIMEの投入一覧を生成。このコマンドはR2操作をしない。
3. 別途承認後、一覧にある新規hash/revisionキーだけを既存codelife-modelsへ投入する。旧キーは上書き/削除しない。旧upload-models-to-r2.shはmutable main取得を防ぐため明示失敗する。
4. 配信検証環境でnode scripts/verify-model-delivery.mjs <explicit-base-url>を実行し、モデルと両ランタイムをread-backしてhash/サイズ照合。
5. 最新headのCIと正式Code/Security Review、人間のMerge/公開判断を確認。
6. 公開後に本番URL・CSPヘッダー・実Worker通信をread-backする。失敗時は旧コード/旧資産へ戻し、旧キーは維持。

**新規R2キー未配置のまま本番へMerge/公開すると背景削除・max拡大・upscaleランタイムの取得は404になる。** Draft PRは公開可能な完了を意味しない。今回の外部操作承認に資産投入は含まれていない。

## 証拠の限界

ローカル検証サーバーは実際のPages関数をローカルファイルR2 adapterで実行し、共通CSP/COOP/COEPも再現する。本番Cloudflareの設定・アップロード完了・配信内容まで証明しない。文字起こしのUI回帰テストには既存のmock Workerが含まれ、Whisper実推論の新規成功とは報告しない。全サイトの外部依存除去、計測スクリプトの自前配信、共通CSPの厳格化、Safari/実モバイル、権限・レビュー強制設定は今回の範囲外。

独立Codexサブエージェントの読み取りレビューで確定actionable defect/test inadequacyなし。テストをそのレビュー担当が再実行したわけではなく、正式GitHub botレビュー・CIの代用ではない。Makerとして自己承認・Mergeは行わない。
