# テストフィクスチャ

ほとんどのフィクスチャは `scripts/generate-fixtures.ts` で決定的に生成される。

```bash
npx tsx scripts/generate-fixtures.ts
```

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
