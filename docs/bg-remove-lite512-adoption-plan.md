# 背景削除：BiRefNet Lite 512 WASM採用の実装計画

作成: 2026-10-15／**ユーザー承認済み・実装検証中**。
基点: Draft PR [#451](https://github.com/code-life-cafe/tools-codelife-cafe/pull/451)、head 6157b7890858bb88ec729f28731d95881c6e7ee7。
2026-10-15にユーザーが本計画の実装・検証・Draft更新とCode/Security Review確認を承認。R2投入・Merge・本番公開は未承認。

## 1. 採用方針・完了状態

- 高精度モード highを **BiRefNet Lite 512 / fp16 / WASM** にする。
- 高速モード fastは **現行MODNet / fp32 / WASM** を維持。既定モードもhighのまま。
- modeの公開値、Blob入力→透過PNG出力、背景合成、保存、進捗通知の契約を維持する。
- 同一origin、自前runtime、固定revision・サイズ・SHA-256検証、cache再検証を維持する。
- モード切替時の旧session解放とWorker処理の直列化を維持する。
- 初回採用にWebGPU選択UIを含めない推奨案。将来の選択式は§6で独立判断する。
- BEN2への自動退避、MODNetへの自動品質変更、第三のモード、輪郭補正・タイル合成は追加しない。

実装後はhighでLite、fastでMODNetの実推論が通り、安全性・切替・4K・品質差を確認したDraftを共有できる状態を目指す。最新headの必須CIと独立Code/Security Reviewを必要とする。
変更全体の予定Risk Classは **R3**（固定モデル資産と配信manifestを含む移行）。権限、CSP、CI/Deploy workflow、入力データの信頼境界の変更は対象外。

## 2. 実測根拠と限界

[比較レポート](C:/Users/marumo/.codex/visualizations/2026/10/14/01a13a5e-cf38-7201-9263-9382de233520/bg-removal-webgpu-comparison-20261015/report.html) /
[集計・生データ](C:/Users/marumo/.codex/visualizations/2026/10/14/01a13a5e-cf38-7201-9263-9382de233520/bg-removal-webgpu-comparison-20261015/summary.json)。
Windows、i7-13700F、RAM64GiB、RTX4070、Chrome155。同じ14素材で全モデル14/14成功。

| モデル | cold初期化 | 14素材 推論中央値 | 最大観測private footprint | 専用GPU最大観測 | 原寸4000×3000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| BEN2 WASM | 2.37秒 | 47.06秒 | 5.06GiB | 0.37GiB | 47.11秒 |
| MODNet WASM | 0.73秒 | 0.26秒 | 1.46GiB | 0.37GiB | 0.54秒 |
| Lite WASM | 5.34秒 | 5.98秒 | 3.46GiB | 0.40GiB | 6.32秒 |
| Lite WebGPU | 5.05秒 | 1.43秒 | 4.95GiB | 1.54GiB | 1.73秒 |

今回のLite WASMはBEN2より推論が約7.9倍速く、最大観測private footprintが約32%小さい。ONNXは219,121,675→98,484,532 bytes（約55%減）。ただしcold初期化はBEN2より遅い。

private footprintは**結果取り出しも含むブラウザ全プロセスの最大観測値**で、モデル単体RAM・RSS・厳密な瞬間ピークではない。GPUメモリと重複し得るため合算しない。coldはloopback配信で、実配信の転送時間ではない。warm3回も記録したが、OSの他プロセスは停止していない。他端末への速度・メモリ保証には使わない。

実スマートフォン・Safari実機は未検証。mobile viewport合格を実機メモリ適合とみなさない。4K出力寸法は保てるが、Liteのalpha推定は512×512からの拡大で、4Kの輪郭情報を復元するものではない。

## 3. 細線・透明素材の品質差

AIM-500鏡像から選んだ提供GT付き7素材の局所評価。alpha MAEは0〜1、小さいほどGTに近い。前景alpha回収率は sum(min(予測,GT))/sum(GT)。MAEだけでは小さい物体の消失を見落とすため併記する。

| 素材 | BEN2 MAE / 回収率 | Lite WASM MAE / 回収率 | 判断 |
| --- | ---: | ---: | --- |
| 髪 | 0.0063 / 99.1% | 0.0059 / 99.5% | 今回は近い品質 |
| 細線ネット | 0.0162 / 99.4% | 0.0142 / 93.0% | **全体MAEは小さくても細線の一部が失われる** |
| 単体の椅子 | 0.0036 / 98.2% | 0.0048 / 98.3% | 概ね保持。完全一致ではない |
| 単体の模型 | 0.0063 / 99.1% | 0.0062 / 99.2% | 今回は近い品質 |
| 煙 | 0.2521 / 99.7% | 0.1022 / 93.7% | Liteの透明度がGTに近いが誤差は残る |
| 透明グラス | 0.1177 / 98.6% | 0.0262 / 93.3% | BEN2の過度な不透明化が減る |
| 透明袋 | 0.0323 / 97.9% | 0.0323 / 98.2% | 今回は近い品質 |

採用時の扱い:
1. BEN2の完全上位互換とは説明せず、速度・メモリとのトレードオフを受け入れる。
2. 512推論への縮小は細線欠落の原因候補。ただし構造も異なるため、解像度だけが原因とは断定しない。
3. 高精度モード近くとFAQへ「細い線や半透明部分は一部欠けることがあります。結果を確認してください。」等の短い日本語説明を置く。
4. 現在の「BEN2（高精度・アニメ対応）」を新モデルと検証範囲に合う説明へ更新。「一瞬」「すべての画像」等の保証も対象ツール内で見直す。アニメ/ロゴ全般の適性は未確認。
5. MODNetへの切替を細線の救済策にしない（今回のネットの回収率はほぼ0%）。膨張・閾値変更等で欠落を隠さない。
6. 原寸クロップ・白/暗背景・提供GTを回帰資料として保持する。既知の約93%を、BEN2並みになるよう期待値や後処理で改変しない。

GTは鏡像提供で独立再注釈していない。7素材は統計的な品質順位ではなく、学習データとの重複も未確認。alpha評価は前景色の背景かぶり除去の保証ではない。

## 4. 固定資産・配信・ライセンス

採用予定元: [studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512)。
mainではなく、実測済みrevision **962e67969ec6acec9c19fab76acee4f5e22e990c** に固定する。
既存Transformers.js4.3.0と解決済みORTを使い、依存・lockfileは更新しない。

| ファイル | bytes | SHA-256 |
| --- | ---: | --- |
| config.json | 81 | 561965f7aa366c48b95ab1c24220d59a718df4025c2ecb359dd5736ceb49e912 |
| preprocessor_config.json | 389 | a79663b311d8404dfb329f7b45bc9f970a0c155aeedae8ac15b6b77d76789613 |
| onnx/model_fp16.onnx | 98,484,532 | eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516 |
| LICENSE | 1,106 | b5cd5faac84a0acb8a6bdb8aeef0919e528891be27216df84eab398d7c8bd2aa |

LICENSEは今回、固定revisionから読み取り、サイズ/hashを確認しただけで配信設定は変更していない。MITとnotice条件は[配布者のライセンス説明](https://huggingface.co/studioludens/birefnet-lite-512#license)を参照。実装時に固定LICENSE原文・由来を確認し、両著作権者と許諾文をTHIRD-PARTY-NOTICES.mdに保持する。LICENSE自体も固定資産として準備・配布する。

予定モデル名: birefnet-lite-512。
URL: /models/bg-remove/birefnet-lite-512/<revision>/<file>。
R2キー: bg-remove/birefnet-lite-512/<revision>/<sha256>/<file>。

- 既存manifestと汎用Pages配信ハンドラを使用。任意URLや外部HF/CDNフォールバックを追加しない。
- ONNXとJSONをcache hit/missとも検証。optional configも先行検証し、ライブラリ既定値への黙示的退避を許さない。破損時は既存の対象キー限定再取得上限で停止する。
- BEN2の既存固定manifest/配信許可は、初回移行では旧Worker互換・ロールバック用に保持する。ただし新Workerの許可fetch集合とモデル選択はMODNet/Liteに限定し、BEN2をロードしない。
- 旧BEN2 cacheはinactiveなディスク資産で常駐sessionとは別。一括cache削除・旧R2削除はしない。旧ページ/Workerの存続を確認せず配信を削除しない。整理は別作業。
- 取得/準備スクリプトがmanifest全体を扱う現行方式ではBEN2も列挙される。初回は仕組みを増やさず、準備一覧に現行/互換用途を明記する。必要な新規投入と既存資産の区別は外部操作承認時に示す。
- UIはモデル約98.5MB（10進）と表示。初回はruntime分も必要で、「初回総転送量98.5MB」とは説明しない。

## 5. 承認後の実装・検証

| 段階 | 変更 | 検証してから次へ進む条件 |
| --- | --- | --- |
| 1. 固定資産を追加 | manifestにLite4ファイル、由来/notice。既存取得・準備処理でローカル準備 | 全hash/サイズ一致。未知パス・main・改ざん・欠落を拒否。LICENSEも配布一覧に存在。R2操作なし |
| 2. highを縦断置換 | Workerのhigh.idとloadPipeline内のasset参照をLiteへ。env.fetch許可集合も整合。fastは現行値 | 実Workerでhigh→Lite、fast→MODNet。初回/cache双方のPNG成功。BEN2への要求0。wasm/1threadと既存Safari分岐を維持 |
| 3. 切替・失敗を検証 | 既存FIFO/retiring/disposeを維持し、必要な回帰テストを更新 | high/fast反復と同時要求でロード/推論/解放の重複なし。dispose失敗で部分解放sessionを再利用しない。失敗後の次要求が動く |
| 4. UIと説明を整合 | モデル名・容量・準備中表示・初回説明・FAQ。mode Switchと既定highは維持 | PC/モバイル幅、ラベル/状態通知、再処理、背景差替え、PNG保存が正常。入力の保存・送信・追加計測なし |
| 5. 品質・性能・レビュー | 同じ14素材/提供GT7素材を製品Workerで再比較。検証記録とDraft本文を更新 | 下記AC、ローカル検査、最新headのCI・独立Code/Security Review。Draft維持 |

### 対象ファイル

必須:
- src/lib/model-assets/manifest.ts
- src/workers/bg-remove.worker.ts
- src/components/tools/BgRemove.tsx
- src/content/tools/bg-remove.md
- THIRD-PARTY-NOTICES.md
- tests/unit/model-assets.test.ts
- tests/e2e/model-assets.spec.ts
- tests/e2e/bg-remove.spec.ts
- docs/data-management.md（現行選択と旧互換資産を区別）
- docs/supply-chain-hardening-walkthrough.md（過去の実測を消さず移行記録を追加）
- 本計画とimplementation_plan.md

必要性を再現で示せる場合だけ:
- tests/e2e/helpers/model-asset-server.ts
- tests/unit/pipeline-lifecycle.test.ts / tests/unit/bg-remove.test.ts
- 既存モデル取得/準備スクリプト（LICENSEを既存処理で扱えない場合）

src/lib/tools/bg-remove.tsの公開API、lifecycle本体、配信ハンドラ本体は原則変更不要。新Agent/Workflow、汎用backend抽象化、CSP/権限/依存変更は対象外。重み等はgitignoredなローカル領域に置く。

### 受け入れ条件（AC）

1. **資産安全性**: Lite4ファイルの固定revision/hash/サイズ。ONNXと各JSONの改ざん/欠落、未知パス、破損cache、有限の再取得を検証。期待hashを通常build/ネットワークから再生成しない。
2. **実モデル選択**: highでLite、fastで現行MODNetの実GET/実推論を初回/cache双方で確認。BEN2が互換manifestにあることと、新Workerがロードすることを別に検証する。
3. **ライフサイクル**: high→fast→high→fast→highと直接Workerへの連続要求。解放後に次モデル初期化。UIラッパーの上書きキャンセル/idフィルタ/リスナー解放を維持し、永久待ちにしない。
4. **入出力**: JPEG/PNG/WebP、空/不正画像、日本語エラー、透過PNG alpha、原寸4000×3000、再処理/背景合成/保存。単なるresize・全透明等を推論成功にしない。
5. **品質回帰**: 固定14素材、提供GT7素材のMAE/半透明部MAE/前景回収/背景漏れと白/暗背景・原寸クロップを保存。今回のLite WASM出力を実装経路の基準とし、同じbrowser/runtime/入力で差が出れば原因確認。異ブラウザのbit一致は要求しない。
6. **性能**: 同じ環境・同じ経路でBEN2/Liteのcold/warm、4K、切替、成功率、private/GPUメモリを記録。5.98秒/3.46GiBを汎用CIの固定上限にしない。同条件で改善しない/悪化する場合は採用理由を再評価する。
7. **ブラウザ**: Chromium実Workerに加え対応方針内のFirefox/WebKitも確認。Safari非asyncify経路と実iOS/Androidの4K/連続処理は公開判断前に確認。実機未確認は未確認のまま記録し、公開可能の根拠にしない。
8. **プライバシー/PWA**: 許可された静的資産以外への画像送信なし。画像をcache/localStorage/ログへ保存しない。初回取得前offlineは明示エラー、アプリshellと検証済モデル取得後offlineは実SW経路で確認。通信遮断fixture/SW無効のE2Eだけで本番PWA正常を証明しない。
9. **Quality Gate**: npm run lint / npm run test:unit / npm test / npm run build とAstro型チェック。E2Eはtests/e2e/fixtures/base.ts経由。新規テストは旧BEN2選択に戻す/検証を外す等の限定mutationで失敗検出を確認。未実行/skip/環境失敗を成功にせず、最新headの必須CI lint/e2eで確認する。

既知の細線差は採用方針に含まれる差として説明し、それだけを実装の開始不能理由にしない。それを超える退行、安全性失敗、不正な入出力は停止理由にする。期待値変更や検査弱体化で未解決の失敗を隠さない。

## 6. WebGPU選択式の是非

**推奨: 初回はWASMのみ。WebGPUは後続の別計画/別PRで任意選択を検討し、自動GPUを既定にしない。**

| 観点 | WASM既定 | 選択式WebGPUを追加 |
| --- | --- | --- |
| 速度 | 今回5.98秒 | 1.43秒、約4.2倍高速。繰返し処理に利点 |
| メモリ | 今回最大観測3.46GiB | 4.95GiB、専用GPU1.54GiB。省メモリ目的では選べない |
| 品質 | 固定した基準 | 今回は概ね近い。平均alpha差0.013〜0.571/255だが、棚の局所最大差100/255。完全一致ではない |
| 可用性 | 現行方式を継続 | adapter/fp16/limits/driver/runtime差、GPU喪失、初期化失敗、timeoutの制御が必要 |
| 操作 | 現行2モードのまま | 高精度時だけ方式選択を追加し、選択と実際の方式を区別する必要 |
| 保守 | 小さい移行差分 | lifecycle識別キー、起動待ち、キャンセル/再試行、実ブラウザ検証の組合せが増加 |

通常設定のChrome155ではGPUの人物推論にも成功。一方、同梱Chromium156は実初期化に失敗。配布者の「自動fallback」やnavigator.gpuの存在だけで成功を保証しない。[ORT公式WebGPU資料](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)と現行依存/実測を基に実装する。

ローカル実験ではGPU非対応、fp16非対応、初期化失敗、推論失敗、timeout、実GPUDevice喪失、実Chromium初期化失敗の7種から復旧。4KでのGPU喪失からもWASM基準とRGBA一致。両backend失敗時の有限終了も確認済み。これは実験用制御で、製品fallback実装や全ブラウザ互換性の証明ではない。

将来追加する場合の最低条件:
- 高精度時の「標準 / GPU高速化」程度の選択。既定はWASM、fast MODNetはWASM固定。選択前にGPUモデルを先行ロードしない。
- modeとbackendを分離し、lifecycleのキーを両者で識別。同じhighでもGPU/WASM切替時に旧sessionを解放し、両方を常駐させない。
- adapter/fp16/必要limitsを検査して実session初期化まで確認。現在の依存から解決されるruntimeを自前配信。推測で旧JSEPに置換したり依存更新を併せたりしない。
- Workerの明示的boot待ち。GPU固有失敗/喪失/timeoutでは失敗Workerをterminateし、新規WASM Workerで同じ元Blobから最大1回だけ再実行。transfer済ArrayBufferを再利用しない。
- hash不一致/配信改ざん/不正画像は別分類で停止し、GPU障害扱いにして安全性エラーを隠さない。
- request idで進捗・上書きキャンセル・遅れた旧attempt結果を分離。WASMも失敗したら日本語エラーで有限終了。他モデルへ自動退避しない。
- fallback後は「標準処理に切り替えました」等で実行方式を伝える。
- timeout値は低速端末実測から後続計画で決める。障害注入用1秒/10秒を製品値に流用しない。
- 設定保存を行う場合は既存useToolSettingsに従い、方式等だけを保存し、入力画像は保存しない。
- 実機のメモリ負担、実SW経路、4K復旧、キャンセル競合を確認してから採否を判断する。

この後続機能を初回WASM採用の完了条件に混ぜない。

## 7. 承認境界・Draft・公開の順序

1. **計画作成時**: 計画と索引のみ変更した。その後、ユーザーが実装・検証・Draft更新を承認。R2操作・Merge・公開は禁止を維持。
2. **計画への実装承認後**: §5だけを実装・ローカル検証し、既存Draft #451へ反映する想定。AC、固定資産、既知の細線差、検証/未確認実機をPR本文に記録。新headのCIと独立Code/Security Reviewを依頼し、旧headの完了を流用しない。Makerは自己承認しない。WebGPUは含めない。
3. **外部操作前**: 既存prepare-model-assets.mjsで固定hash付き投入一覧を生成するだけ。対象キー/サイズ/licenseと新規/既存資産をレビュー可能にする。未投入のままコードを公開すると取得に失敗するため、先に公開しない。
4. **別途R2承認後のみ**: 承認された新規キーを投入しread-backでhash/サイズ/ヘッダー確認。immutableキーを上書きせず、旧資産を削除しない。
5. **別途Merge/公開承認後のみ**: 最新head/base、必須CI、独立レビュー、R2実体、実機の確認/未確認を照合して判断。今回の依頼では実行しない。

ロールバックは移行差分revertによりBEN2選択・manifest・説明文の整合を戻す手順を用意する。旧revision/hash/配信資産を保持。実際のrevert公開も別承認とし、UIやmodel idだけを部分的に戻さない。

## 8. 計画作成時に確認したこと

現行Workerのmode/WASM/JSON検証/lifecycle、UIのBEN2と容量の参照箇所、公開wrapper、manifest・配信・取得/準備処理、notice、既存テスト、比較summary、固定LICENSEの読み取りを確認した。
現行UIのモデル/容量はモード説明、準備中表示、初回説明の3箇所で整合させる。
この計画は将来実装の合格報告ではない。計画作成時の差分は本計画とimplementation_plan.mdの索引だけだった。実装後の結果は検証記録に追記する。

計画作成後の確認: npm run lintはexit 0（既存の警告15件・info1件、修正なし）。文書のみの変更で、実装後のunit/E2E/build・実機確認はまだ実施していない。


### Security Review修正: 実行前のruntime検証

cb65d50のSecurity Reviewで、同長のR2 runtime差替えはサイズ検査のみでは防げないP2指摘。画像WorkerのMJS/WASMを固定SHA-256で検証してから、その同じbytesのBlob URLをORTへ渡す。元URLを再取得せず、SWに不正bytesが残っても再検証で拒否する。BlobはWorkerごとに一度だけ保持し終了時に解放。CSP・権限・依存は変更しない。/transcribeの実行経路は今回の変更対象外。

単体テストでは同長MJS/WASM改変をBlob作成前に拒否し、成功時のBlob本文と検証対象の一致を確認。実E2Eでは同長かつ構文的に有効なMJSの実行マーカーが出ずハッシュエラーになること、WASM同長改変もハッシュエラーになることを両画像Workerで確認。実モデルの成功経路も維持。追加cache IOに対し、アップスケールのcache再利用テストでも書込み完了を観測してからWorkerを終了する。
