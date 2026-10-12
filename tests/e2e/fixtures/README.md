# テストフィクスチャ

ほとんどのフィクスチャは `scripts/generate-fixtures.ts` で決定的に生成される。

```bash
npx tsx scripts/generate-fixtures.ts
```

## 画像形式変換ツール（image-convert）用フィクスチャ

| ファイル | 生成方法 | 内容 |
|---|---|---|
| `convert-sample.webp` | `scripts/generate-fixtures.ts`（sharp） | 64×48・赤地＋中央の青矩形 |
| `convert-sample.avif` | `scripts/generate-fixtures.ts`（sharp / AV1） | 同上 |
| `convert-exif.jpg` | `scripts/generate-fixtures.ts`（sharp `.withExif`） | 同上＋EXIF（IFD0: Software / DateTime）。keep/strip 差分検証用 |
| `convert-sample.heic` | `scripts/generate-heic-fixture.ts`（ffmpeg + 手書き HEIF コンテナ） | 同上・HEVC/HEIC |

### convert-sample.heic（HEIC）

```bash
npx tsx scripts/generate-heic-fixture.ts
```

- **生成元**: `scripts/generate-heic-fixture.ts` 内で生成した 64×48 の画像（外部ファイル由来ではない）。
- **生成方式**: sharp / ImageMagick の同梱 libheif は HEVC エンコーダ（x265）を持たず HEIC を出力できないため、
  **ffmpeg(libx265)** で単一フレームの HEVC を生成し、最小の **HEIF(heic) コンテナ**（ftyp / meta{hdlr,pitm,iinf,iprp{ipco{hvcC,ispe},ipma},iloc} / mdat）へ手書きでラップしている。
- **検証**: 生成物は `libheif-js`（本ツールの HEIC デコード経路と同一）でデコードできることを確認済み（64×48・画素一致）。
- **要件**: 生成には **ffmpeg(libx265)** が必要。CI ではこのスクリプトを実行せず、コミット済みの `.heic` をそのまま使う。出力は決定的（固定サイズ・固定描画）。

## encrypted.pdf（暗号化PDF）

- **生成方法**: `npx tsx scripts/generate-encrypted-fixture.ts`
- **生成元**: スクリプト内で自前構築した1ページPDF（外部ファイル由来ではない）
- **暗号化方式**: PDF 1.4 標準セキュリティハンドラ（R=2 / V=1 / RC4 40-bit）
- **パスワード**: user / owner ともに `test`
- **用途**: `loadPdfInfo()` が `encrypted: true` を返すこと、および結合・分割の
  処理対象から除外されることの検証のみ。CI ではこのPDFを復号しない。

pdf-lib は暗号化PDFを生成できないため、`scripts/generate-fixtures.ts` ではなく
専用スクリプトで事前生成してコミットしている。出力は決定的（固定ファイルID・
固定パスワード）なので、再生成しても同一バイト列になる。

## 動画圧縮用フィクスチャ

外部の動画は使用せず、FFmpegの`testsrc2`と`sine`で生成した合成動画。CIではコミットしたファイルを使い、FFmpegは不要。

- `video-compress.mp4`: 960×540、24fps、4秒、H.264 + AAC（48kHz）。音声保持・トリミング・オフライン検証。
- `video-compress-portrait.mp4`: 360×640、24fps、3秒、H.264、音声なし。縦動画・目標容量。
- `video-compress-opus.webm`: 320×180、24fps、2秒、VP9 + Opus。AACエンコード非対応時の停止・音声削除。
- `video-compress-rotated.mp4`: 符号化640×360、表示360×640、24fps、2秒、H.264、音声なし。rotation正規化。

再生成（FFmpegのlibx264/libvpx-vp9/libopusが必要）:

```bash
ffmpeg -f lavfi -i testsrc2=size=960x540:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 4 -c:v libx264 -preset ultrafast -crf 12 -pix_fmt yuv420p -c:a aac -y tests/e2e/fixtures/video-compress.mp4
ffmpeg -f lavfi -i testsrc2=size=360x640:rate=24 -t 3 -c:v libx264 -preset ultrafast -crf 12 -pix_fmt yuv420p -y tests/e2e/fixtures/video-compress-portrait.mp4
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -c:v libvpx-vp9 -b:v 500k -c:a libopus -y tests/e2e/fixtures/video-compress-opus.webm
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=24 -t 2 -c:v libx264 -preset ultrafast -crf 12 -pix_fmt yuv420p -y /tmp/video-rotation-source.mp4
ffmpeg -display_rotation:v:0 90 -i /tmp/video-rotation-source.mp4 -c copy -y tests/e2e/fixtures/video-compress-rotated.mp4
```

`video-compress-offset.mp4` は縦動画に開始タイムスタンプ5秒を付けた3秒のH.264動画。正の開始時刻を実長として扱わない回帰テスト用。

```bash
ffmpeg -i tests/e2e/fixtures/video-compress-portrait.mp4 -c copy -output_ts_offset 5 -y tests/e2e/fixtures/video-compress-offset.mp4
```
