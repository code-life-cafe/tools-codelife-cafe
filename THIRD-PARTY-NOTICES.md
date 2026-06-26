# サードパーティ ライセンス表記

本プロジェクト（MIT ライセンス）は、一部の機能で以下のサードパーティ製ライブラリを利用しています。
これらは `/image-convert`（画像形式変換ツール）でのみ、必要になった時だけ動的にロードされ、
本体バンドルへは静的に取り込まれません。

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

---

その他の依存パッケージのライセンスは `package.json` および各パッケージの `node_modules/<pkg>/LICENSE`
を参照してください。
