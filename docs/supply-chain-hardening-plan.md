# 外部実行資産・AIモデル配信のサプライチェーン対策 実装計画

作成: 2026-10-14 / 状態: 2026-10-14にユーザー承認済み。実装・検証・Draft PR作成まで承認。モデル差し替え・Merge・R2投入・本番公開は別判断。Claude利用上限につき同日にCodex実装への担当変更を個別承認済み。

## 目的と完了状態

背景削除・画像アップスケールの推論用JS/MJS/WASMは自サイトから配信する。モデルはレビューされたコミットSHAとファイルごとのSHA-256・サイズに固定し、取得時と推論へ渡す前に検証する。不一致、未知の資産、配信欠落では処理を停止し、外部CDNや最新mainへフォールバックしない。入力画像は引き続きブラウザ内で処理する。

今回の第一段階は既存モデルを維持して配信経路を安全化する。モデル品質向上は別の比較・採用判断とする。

## 調査結果と前提

- 手元のmainはリモートより古く、既存変更が混在している。最新GitHub mainのファイルを読み取って計画した。実装は最新mainから隔離した作業領域で行い、既存変更を上書きしない。
- `upscale.worker.ts`はONNX Runtime 1.27.0の実行資産をjsDelivrから取得。高品質モデルはHugging Faceの`resolve/main`、ハッシュ未検証。
- `bg-remove.worker.ts`はMODNet/BEN2をTransformers.js経由でロード。R2配信でもモデルrevisionは未固定。従来のR2投入スクリプトも`resolve/main`を使用。
- `/transcribe`には同一オリジン配信、SHA付きモデルマニフェスト、取得時検証、ランタイムコピー時検証がある。これらを参考にする。ただしマニフェストの存在をブラウザでの推論前ハッシュ検証の証明とは扱わない。
- 最新mainの文字起こし用ランタイムはTransformers.js 4.3.0が解決するONNX Runtime `1.31.0-dev.20260914-8d85527a0`。アップスケールのトップレベル1.27.0とは異なる。既存の`resolveRuntimePaths`もこの差を明示している。
- `/transcribe`のR2配信は既存Pages Functionによる静的資産配信。新規推論サーバーは作らない。
- SHAとハッシュは「レビューしたバイト列から変わっていない」ことを保証する。上流モデルが無害であること、自サイト/リポジトリ全体が侵害されていないことまで保証しない。

## スコープ・責任・承認境界

- Maker: 既存のClaude Makerフロー。Codex: 計画・独立レビュー。ユーザーが別の担当を明示した場合はその指示を優先。
- Risk Classは全差分で判定。PWA/buildへの対応が必要ならR3、CSPなどsecurity boundaryを変更する場合はR4。R4対象の具体的な変更は個別の範囲承認後に準備する。自動Mergeはしない。
- 対象: 背景削除・アップスケールの配信/取得/検証、必要最小限の共通資産コードとテスト。文字起こしは既存挙動の回帰検証対象。
- 非対象: モデルの採用変更、推論精度変更、UI再設計、依存更新、Analytics変更、権限・secret・Constitution・Workflow変更。
- 外部実行資産の意味はまず推論ランタイムに限定する。Cloudflare計測スクリプトやGoogle Fontsは残るため「全サイトで外部依存ゼロ」とは報告しない。着手時にその他のWASM/Worker/CDN取得も棚卸しし、別ツールに未対応があれば別項目として報告する。
- R2への新規キー投入、本番配信、Mergeは計画作成の承認に含めない。検証済み資産・対象キー・差分・結果を揃えて外部操作を判断可能にする。

## 設計

### 1. レビューするマニフェストを正本にする

モデルごとに取得元リポジトリ、40桁コミットSHA、ファイルパス、バイト数、SHA-256、dtype、用途、ライセンス/出典を記録。ONNX本体だけでなくconfig、preprocessor、必要な外部tensorデータも対象にする。同梱fastアップスケールモデルもハッシュと由来を記録する。由来を遡れない場合は未確認として明示し、安全な固定上流からの再取得を提案する。

通常ビルドは期待ハッシュを再生成しない。更新候補の生成と承認済みマニフェストでの検証を分離する。ネットワークから受け取ったハッシュをそのまま実行時の信頼根拠にしない。

### 2. JS/MJS/WASMを自前配信する

既存`copy-onnx-wasm.mjs`とランタイム解決処理を拡張し、Transformers.js側とトップレベル側をそれぞれ実解決バージョンで検証・コピーする。`/vendor/onnx-wasm/<version>/`へ必要なMJS/WASMを配置。WebGPU/JSEP、WASM、Safariに必要な種類は実際の解決版から確認して列挙する。JSとWASMの版ずれ・不足・ハッシュ不一致はビルド失敗。

各WorkerでwasmPathsを明示し、CDN既定値への復帰を許さない。`/transcribe`の既存資産構成を維持する。MJSを事後にハッシュ検証しても実行前防御にはならないため、実行資産はコピー時および配信read-backで検証し、ブラウザ上の事前検証範囲とは区別する。

### 3. モデルを固定パスで自前配信する

推奨パス: `/models/bg-remove/<model>/<revision>/...`、`/models/upscale/<model>/<revision>/...`。大きなモデルは既存R2の静的配信方式を利用し、同一オリジンの限定ルートでマニフェストにあるキーのみGET/HEAD配信。別ツールのモデルキー・既存バインディングは変更しない。Pages静的ファイル上限を確認し、大容量モデルをdistへ無理に同梱しない。

候補資産は固定SHAから取得し、サイズとハッシュ一致時だけ配置可能にする。既存キーを上書きせず新規revisionキーへ配置。未知パス・任意URL・パストラバーサルを拒否し、404/503時もHugging Faceへ迂回しない。

### 4. 推論前のモデル検証とキャッシュ

アップスケールは取得ArrayBufferのサイズとSHA-256を検証してから`InferenceSession.create`へ渡す。背景削除はTransformers.jsの実ロード経路を小さな試作で確認し、正式に使えるcustomCache等の経路で全モデル/config取得を検証する。未検証の内蔵キャッシュや標準fetchへ抜ける経路を残さない。全体fetchの無差別差し替えや独自推論フレームワークは避ける。

取得直後の新規データとキャッシュヒットの両方を検証。破損した対象キーだけ削除し、再取得は最大1回。不一致が続けば日本語エラーで停止。ハッシュ値を含む資産ID/バージョンでキャッシュを分離し、他ツールのキャッシュを削除しない。進捗・取消・再実行を維持する。

Web Cryptoによる検証時のピークメモリ、初回/キャッシュ時の待ち時間を計測。大容量ArrayBufferの重複を抑える。現行ライブラリで検証前にパース/セッション生成される場合は採用せず、計画を見直す。

### 5. 通信制限と更新手順

本対策の成功条件は対象モデルと推論実行資産が同一オリジンからのみ取得されること。共通CSPからCDN許可を消す場合は全ツールの依存確認後に実施する。`unsafe-inline`/`unsafe-eval`の全サイト削除は別段階。Analytics許可を無断変更しない。

PWAは新しいrevision URLを使い、旧キャッシュを新モデルとして認識しない。大容量モデルを全ページprecacheに追加しない。マニフェスト・資産・コードの整合を確認してから切替し、ロールバック時は旧資産を参照するコードへ戻す。旧キー削除は別承認。

## 工程と検証の切れ目

1. **棚卸し・試作:** 最新mainを固定して全外部実行資産を列挙。背景削除の検証付き取得経路と、両ランタイムの自前WASMロードを最小画像で試す。検証前に推論へ到達しないことを確認して設計を確定。
2. **固定資産準備:** 既存モデルの固定revision・ライセンス・全必要ファイルを確定。マニフェストと検証スクリプトを作り、1バイト改変・欠落・サイズ不一致を確実に拒否。
3. **アップスケール縦断:** 自前ランタイム＋固定モデル＋推論前検証をfast/max双方に接続。WASM/WebGPU、初回/キャッシュ、破損時を確認。
4. **背景削除縦断:** MODNet/BEN2双方に接続。config/モデルの改変、未登録ファイル、配信欠落、再取得上限を確認。
5. **回帰・公開準備:** 文字起こし、PWA、対象PC/モバイルを検証。必要なら限定CSP差分を提示。資産read-back手順とロールバック手順を揃え、Draft PRと独立レビューへ進む。

## 予定変更ファイル

- `src/workers/{bg-remove,upscale}.worker.ts`、`src/lib/tools/upscale-core.ts`
- 新規 `src/lib/model-assets/manifest.ts`、`src/lib/model-assets/verified-fetch.ts`（純粋検証とブラウザ取得を分離）
- `scripts/copy-onnx-wasm.mjs`、`scripts/lib/onnx-runtime-paths.mjs`、新規モデル取得・検証スクリプト。旧`upload-models-to-r2.sh`のmain取得を安全な方式へ置換。
- 新規 `functions/models/bg-remove/[[path]].ts`、`functions/models/upscale/[[path]].ts`。既存R2設定で配信できるか確認し、追加権限/バインディングが必要なら別判断。
- 対応unit/E2Eテスト、`docs/data-management.md`、検証ウォークスルー。
- 必要性を実証した場合のみ`public/_headers`、PWA資産管理、`package.json`の既存build連携を最小変更。Workflow、依存バージョン、`/transcribe`公開仕様は変更しない。

## 受け入れ条件・必須検証

- 承認済みモデルSHA・ファイルハッシュ・ランタイム版が追跡可能。マニフェスト外のファイルとmain/latest取得を拒否。
- 正常ファイルで画像処理が完了し、改変ONNX/config/外部tensor、破損キャッシュ、404で推論開始を阻止。エラーに入力画像・ファイル名・個人情報を含めない。
- 改変・欠落ランタイムでbuildが失敗。CDNを利用不能にしても自前資産で動作する。
- unitは`node:test`と`node:assert/strict`。新テストが改変・未検証経路を実際に検出することを確認。
- E2Eは共通fixtureを使用。ただし通常fixtureの外部遮断・SW無効化をprivacy/PWA証明に使わず、別の通信記録・SW有効テストも実施。
- 通常の必須E2Eで固定SHA・hash照合済み実モデルの実Worker成功ケースを全モード実行する（opt-in skipを使わない）。PCのWASM/WebGPU、WebGPU非対応時、モバイル幅で確認。レイアウト検証と実モバイル端末の性能は区別する。モックだけで推論成功を報告しない。
- 初回ロード、キャッシュロード、推論時間、モデル容量、ピークメモリ（取得できる範囲）を変更前後で記録。許容差は試作の基準測定後に計画へ記載。
- `npm run lint`、型チェック、`npm run test:unit`、`npm test`、`npm run build`。最新headの必須CIと独立レビュー成功をMerge条件とする。
- 公開前は同一オリジンR2配信を再現する検証環境で実ファイルを取得しハッシュ照合。公開後の本番ヘッダー・資産・通信確認は別証拠として記録。

## モデル差し替えの余地（別工程）

背景削除は**BiRefNetのONNX版**が有力な比較候補。ONNX配布者がTransformers.jsによる推論例とMIT表記を公開している。現行BEN2を上回ることは未実測。髪・毛・細線・商品写真・複雑背景を同一素材で比較し、ダウンロード容量、初回/再実行時間、メモリ、WASM/WebGPU対応、配布重みのライセンスを確認する。現行`background-removal`とのAPI・前後処理互換性も未確認。

アップスケールはまず現行Real-ESRGANを維持するのが妥当。作者のmodel zooは汎用軽量版とアニメ向け版を用途別に案内している。イラスト用途ならアニメ向けモデルの追加比較に余地があるが、写真・文字・図版すべてでの上位互換とは扱わない。生成型の大型モデルはブラウザの時間・メモリ・描き足しのリスクがあり、今回の対策に混ぜない。

比較用に人物/髪/動物/商品/細線/複雑背景の背景削除素材と、写真/アニメ/文字/図版/強いJPEG劣化の拡大素材を準備。代表PCと実モバイルで現行と候補を同条件比較し、品質改善・性能・ライセンスを揃えて採否を判断する。

一次資料:

- [現在の背景削除Worker](https://github.com/code-life-cafe/tools-codelife-cafe/blob/main/src/workers/bg-remove.worker.ts)
- [現在のアップスケールWorker](https://github.com/code-life-cafe/tools-codelife-cafe/blob/main/src/workers/upscale.worker.ts)
- [既存ランタイム解決処理](https://github.com/code-life-cafe/tools-codelife-cafe/blob/main/scripts/lib/onnx-runtime-paths.mjs)
- [既存文字起こしマニフェスト](https://github.com/code-life-cafe/tools-codelife-cafe/blob/main/src/lib/transcribe/model-manifest.ts)
- [BiRefNet作者](https://github.com/ZhengPeng7/BiRefNet)、[ONNX版と利用例](https://huggingface.co/onnx-community/BiRefNet-ONNX)
- [BEN2作者（公開baseと商用モデルの区別）](https://github.com/PramaLLC/BEN2)
- [Real-ESRGAN作者のmodel zoo](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/model_zoo.md)

## 判断待ち

本計画の実装範囲は承認済み。CSPのsecurity boundary変更を含める場合は、対象ページと具体的なポリシー差分の個別承認を追加で残す。モデル差し替えはこの計画の承認に含めず、比較結果を見て別途判断する。
