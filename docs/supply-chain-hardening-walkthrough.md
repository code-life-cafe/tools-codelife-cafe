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

初回の独立Codexサブエージェントの読み取りレビューで確定actionable defect/test inadequacyなし（後続の正式bot P2指摘は下記で対応）。テストをそのレビュー担当が再実行したわけではなく、正式GitHub botレビュー・CIの代用ではない。Makerとして自己承認・Mergeは行わない。

## 手動レビュー修正ループ 1/3

旧head 806d64dfeabddb28ceaa538e8f9e1461d0efe9a5 の正式Code/Security Reviewは両方Completed。Code側のP2 2件（大容量モデルの余分な全コピー、通常CIで実モデル成功ケースがskip）へ対応。Security側の個別findingなし。

- ORTは検証済みArrayBufferを直接消費。Transformers用Responseは共有viewのstreamを持ち、arrayBuffer()で同じ検証済みbufferを一度だけ返す。ライブラリのストリーム再結合を避けるため、進捗は検証fetch側へ集約。
- cacheへのclone/teeとBufferSourceによる全コピーを除去し、保存完了を推論開始の条件にしない。保存失敗でも次回の取得・hash検証は維持。
- buffer同一性とcache保存未完了でも返却できる回帰テストを追加。全unit 1,549件成功。build成功、Astro check 0 errors/0 warnings。
- 通常E2Eのopt-in skipを撤去。実行前に固定revisionの全ファイルを取得・hash/サイズ照合し、取得失敗はテスト失敗にする。並行workerの取得は一時ファイルのatomic renameで未完成資産の読み取りを防止。
- BEN2はV8 old-space 256MiB / semi-space 8MiBの条件で実推論し、CDPの1秒間隔memory dumpから全ブラウザプロセスのprivate footprint合計を記録。JS heap上限とWASM/全プロセスのメモリは別。最大観測値は厳密なピーク・実機モバイルの上限を証明しない。変更前同条件との改善率は未測定。

この修正差分の独立読み取りレビューは追加defectなし。正式bot再レビューと最新head CIは別途照合する。Draftを維持し、R2投入・Merge・本番公開は実施しない。

修正後の通常実モデルE2E: PC/モバイル幅の14件すべて成功、skipなし（2.8分）。外部HF/jsDelivrへの通信なし。BEN2の1秒間隔CDP dumpは各6サンプル、最大観測private footprint合計はPC 4,326,023,168 bytes / mobile project 4,331,061,248 bytes（約4.03GiB）。観測JS heap上限は両方293,601,280 bytes（280MiB）。これはV8以外のメモリが大きいことを示し、実スマートフォンでOOMしない根拠にはならない。実機のメモリ余裕と旧版同条件比較は公開前の判断事項として残す。

既存背景削除・拡大・文字起こしの対象回帰E2E: 46件成功（52.1秒）、skipなし。文字起こしは既存mockを含む。lint成功（既存15 warnings/1 info）。

## 2026-10-15: ユーザー承認済みのセッション管理改善

モデルmanifest・dtype・入力解像度・推論providerは変更しない。初期化・推論・切替を同じFIFOに入れ、旧pipelineのdispose完了前に新pipelineを確保しない。同一modeは再利用。解放開始後は旧modeへ戻ってもそのpipelineを使わず、解放を再試行してから再ロード。1件の失敗で後続キューを止めない。

- ライフサイクルunit5件成功。直列化を壊した変異体は失敗、disposeのawaitを除去した変異体は3件失敗し、回帰テストが問題を検出することを確認。変異体はignored cacheだけに置き、Productionを壊して検証していない。
- 全unit1,554件成功。Astro check 0 errors/0 warnings、lint成功（既存15 warnings/1 info）、build成功。
- 独立読み取りレビューで途中解放後の旧mode再利用へのP2を検出し、retiring状態と直接回帰テストで修正。再レビューで解消、追加defectなし。
- 実Workerへ同時に2要求を送り、順序どおり2結果・モデル取得1回を確認するE2Eを通常gateに追加。最新ビルドの全4モデル・背景削除UIを含む対象E2E22件すべて成功（3.2分）、skipなし。
- 変更前58aa235のビルドとsourceをignored比較領域に保持。モデル比較の候補はstudioludens/birefnet-lite-512 revision 962e67969ec6acec9c19fab76acee4f5e22e990c、FP1698,484,532bytes、SHA-256 eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516。local専用、製品manifestへの追加・モデル差し替えなし。
- 比較は固定revisionの同一6素材、同一WASM runtime/1thread、同一V8制限、モデルごとの独立browserで行う。BEN2前後/MODNet/BiRefNet512のcold初期化・推論・mode切替を記録。正解alphaなしのため目視評価と出力差分を報告し、定量的な品質優位を主張しない。測定の生データ・出力画像はlocal比較領域に保存し、結果はPR本文とユーザー報告に記録する。

Draft維持。R2投入・Merge・本番公開は実施しない。


## 2026-10-15: 高精度モードをBiRefNet Lite 512 WASMへ移行

ユーザーが採用計画の実装・検証・Draft #451更新とCode/Security Review確認を承認。R2投入・Merge・公開は未承認。

- high: BiRefNet Lite 512 fp16、revision 962e67969ec6acec9c19fab76acee4f5e22e990c、ONNX 98,484,532 bytes、SHA-256 eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516。config/preprocessor/LICENSEも固定検証。
- fast: 既存MODNet fp32のrevision/重みを維持。WebGPUは追加せずWASM/1thread。mode値、既定high、UIラッパー、FIFOとsession解放は維持。
- BEN2の配信manifestは旧Worker互換用に保持。新Workerの取得許可はMODNet/Liteだけに限定。旧cache/R2キーの削除なし。
- UI3箇所のモデル/容量とFAQを更新。細線・半透明部分の欠落と、初回runtimeの別途取得を明記。BEN2完全上位互換やアニメ全般の保証はしない。
- THIRD-PARTY-NOTICESへMIT原文と両著作権者を保持。LICENSE本体も固定配信候補へ追加。
- ローカル資産準備とprepare-only一覧生成まで。新規R2キーは未投入のため、このまま本番へ公開してはいけない。

### ローカル検証

- build成功、Pagesの25MiB制限検査成功。モデル実体はGit/build静的配布へ混入しない。
- unit 1573件成功、skipなし。関連のmanifest/ライフサイクル/ラッパーも確認。
- 対象E2E 36件成功、PC/mobile幅、skipなし。実モデル推論、Liteの各config/ONNXの改ざん・欠落拒否、BEN2への取得0、実SWでoffline再推論のRGBA一致を確認。
- lint exit0、既存15 warnings/1 info（今回無関係、修正なし）。Astro checkは0 errors/0 warnings/107 hints。
- mutation: ローカルbuildのhigh registryをMODNetへ向けると、Liteの実ONNX取得assertで失敗。build Workerはbyte単位で復元済み。意図的な失敗であり、通常検証の失敗を隠したものではない。
- 既存4321のpreviewが旧UIを返したため専用4371で確認した。preview設定/CIを変更していない。
- offlineテストは結果直後のWorker terminateで未完了Cache.putが中断された。Cache.matchでmetadata/本文が読めてもput promise完了とは限らないことを診断した。テスト専用ローカル配信だけで実Cache.putの完了を観測し、実書込み後にWorkerを終了してofflineを確認。model/inference/networkのmockではなく、製品cache処理を変更していない。

### 品質・公開前の境界

採用前比較は[採用計画](bg-remove-lite512-adoption-plan.md)の14素材と提供GT7素材。ネットのalpha回収率はBEN2約99.4%に対しLite約93.0%。髪・商品は近い品質、煙/グラスはLiteのalpha MAEが小さい。完全上位互換・4K細部復元を主張しない。製品Workerの同素材比較と切替記録はPR本文/ローカル成果物で区別して報告する。

Firefox/WebKitのローカル実行バイナリは未導入。Safari・実iOS/Androidの連続/4Kとメモリ適合は未確認。PC上mobile viewportの合格で代替しない。新headのCI/独立Code・Security Reviewの結果はPR履歴で照合し、旧headの完了を流用しない。Draft維持、R2 read-backと実機の確認/未確認の公開判断は別承認。


### Lite採用の独立レビュー修正（2026-10-15）

- 最新main d6a80f8を通常mergeで統合。ライセンス表記は双方を保持。ビルド・unit1625・Astro check（0 errors/0 warnings/107 hints）成功、lintは既存15 warnings/1 info。
- 製品Workerの14素材は採用前Lite WASMのRGBAと14/14完全一致。中央値7.05秒、最大観測private footprint3.28GiB。high→fast→high→fast→high成功、BEN2取得0。計測時とmain統合後の配布WorkerはSHA-256 01e4051d94a7e90bce0f0b92a93d55311fb6ad34a626d2a6e3dfc26032e8cadaで同一。
- Code ReviewのP2 test inadequacy: 入力が既に透明だとecho/全透明でも成功する問題を修正。高精度の実モデル・offline再推論は不透明な白背景と赤い前景を使い、中央8×8の平均alpha >0.9、外周4pxの平均alpha <0.05を検証する。実測は前景約0.995、背景0。固定の意味的条件であり、今回出力の自己由来digestだけを合格条件にしない。
- Security Reviewは6affc52で指摘なし。修正後のheadでもCIと両レビューを再確認する。Draft維持、R2投入・Merge・公開なし。

- 修正後対象E2Eは36 pass/skip0。配布Workerだけを一時変更するmutationで、全透明（前景alpha=0）は前景条件、RGBA入力echo（背景alpha=1）は背景条件が失敗することを確認。配布物は元のSHA-256へ復元。製品コード変更は追加していない。


### Security Review修正: 実行前のruntime検証

cb65d50のSecurity Reviewで、同長のR2 runtime差替えはサイズ検査のみでは防げないP2指摘。画像WorkerのMJS/WASMを固定SHA-256で検証してから、その同じbytesのBlob URLをORTへ渡す。元URLを再取得せず、SWに不正bytesが残っても再検証で拒否する。BlobはWorkerごとに一度だけ保持し終了時に解放。CSP・権限・依存は変更しない。/transcribeの実行経路は今回の変更対象外。

単体テストでは同長MJS/WASM改変をBlob作成前に拒否し、成功時のBlob本文と検証対象の一致を確認。実E2Eでは同長かつ構文的に有効なMJSの実行マーカーが出ずハッシュエラーになること、WASM同長改変もハッシュエラーになることを両画像Workerで確認。実モデルの成功経路も維持。追加cache IOに対し、アップスケールのcache再利用テストでも書込み完了を観測してからWorkerを終了する。


### 有効なWASM改変の追加回帰検証

1103e9cのCode Review指摘に対応。実ORT WASMの末尾data sectionの1byteを変更し、同長・変更前後のWebAssembly.validate成功を確認してから配信する。両画像Workerでハッシュエラー拒否を確認する。unitの最小WASMもcustom section本文を変更し、有効性を保持したままBlob作成前に拒否。製品コードの追加変更はなし。

最終runtime検証付きWorkerの14素材再計測は中央値11.69秒、最大観測private footprint3.35GiB。採用前Lite WASMとRGBA14/14完全一致、high→fast→high→fast→high成功、外部/BEN2取得0。前段7.05秒との差をhash処理だけに帰属せず、最終測定を最新値として扱う。
