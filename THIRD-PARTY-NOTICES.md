# サードパーティ ライセンス表記

本プロジェクト（MIT ライセンス）は、一部の機能で以下のサードパーティ製ライブラリ・モデルを利用しています。
いずれも該当ツールを開いて必要になった時だけ動的にロードされ、本体バンドルへは静的に取り込まれません。

## libheif-js

- **用途**: HEIC（HEVC in HEIF）画像のデコード。`/image-convert` に HEIC を投入した時のみロードされます。
- **バージョン**: 1.19.8
- **ライセンス**: LGPL-3.0
- **リポジトリ**: https://github.com/catdad-experiments/libheif-js
- **上流**: https://github.com/strukturag/libheif

libheif-js は LGPL-3.0 で配布される独立したライブラリであり、別チャンクとして動的に読み込まれます
（実行時にライブラリへ動的リンクされ、利用者は同ライブラリを差し替え可能です）。本プロジェクト本体の
MIT ライセンスは影響を受けません。LGPL-3.0 の全文は上記リポジトリおよび `node_modules/libheif-js/LICENSE`
を参照してください。

## @jsquash/avif

- **用途**: AVIF 画像のエンコード。`/image-convert` で出力形式に AVIF を選択した時のみロードされます。
- **バージョン**: 2.1.1
- **ライセンス**: Apache-2.0
- **リポジトリ**: https://github.com/jamsinclair/jSquash
- **推移的依存**: `wasm-feature-detect`（1.8.0, Apache-2.0）

## Whisper ONNX モデル（`/transcribe`）

`/transcribe`（ローカル文字起こし）は、以下の ONNX 変換済み Whisper モデルを実行時に取得します。
バンドルには含まれず、`/models/transcribe/` 経由（Cloudflare R2）で配信されます。
配信対象ファイル・コミットハッシュ・SHA-256 は `src/lib/transcribe/model-manifest.ts` が正本です。

- **用途**: ブラウザ内（Web Worker）での音声認識。音声・文字起こし結果は外部送信されません。
- **ライセンス**: MIT
- **上流**: OpenAI Whisper（https://github.com/openai/whisper, MIT）
- **配布元**:
  - https://huggingface.co/onnx-community/whisper-tiny （revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`）
  - https://huggingface.co/onnx-community/whisper-base （revision `1846881b6b3a3024392c1eea3ad983695bc23925`）
  - https://huggingface.co/onnx-community/whisper-small （revision `36050c46d777d46dc4b5f43f6d90574fc38f8732`）

## ONNX Runtime Web（`/transcribe` の自サイト配信分）

`/transcribe` は外部 CDN への通信を禁止しているため、ONNX Runtime Web の WASM 一式を
`/vendor/onnx-wasm/` として自サイトから配信します（`scripts/copy-onnx-wasm.mjs` が
`@huggingface/transformers` の解決する `onnxruntime-web` から配置します）。

- **用途**: Transformers.js の推論バックエンド（`/transcribe` のみ）。
- **バージョン**: `src/lib/transcribe/model-manifest.ts` の `RUNTIME_ARTIFACT.onnxRuntimeVersion` を参照
- **ライセンス**: MIT
- **リポジトリ**: https://github.com/microsoft/onnxruntime

---

その他の依存パッケージのライセンスは `package.json` および各パッケージの `node_modules/<pkg>/LICENSE`
を参照してください。
