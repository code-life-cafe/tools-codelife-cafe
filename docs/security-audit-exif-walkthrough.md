# EXIF cleaned export: 個別修正・検証記録

- Base: `dc76201302a6be03e4b008988d0fa724e2677710`
- Fingerprint: `exif/non-jpeg-original-byte-cleaned-download`
- Risk Class: R3。メタデータ削除を保証できない元ファイルの出力を停止する、privacyに関係する局所修正。Merge・Deployは対象外。
- 対象: `src/lib/tools/exif.ts`、EXIF unit/E2E regression test、本記録のみ。UI・新しい日本語文言・依存・共通hook・設定・権限は変更しない。

## 受け入れ条件と方針

1. TIFF/WebPの未削除元bytesをcleanedファイルとして出力しない。
2. JPEGの既存ロスレス削除処理を維持する。
3. 単一処理では失敗として通知し、自動・個別ダウンロードへ進まない。混在バッチでは失敗画像をZIPに含めず、成功JPEGだけを出力する。

最小修正は`stripMetadata`の非JPEG分岐を、元bytesとwarningの返却から既存warning文による例外へ変更する。新しいエンコーダーは追加しない。既存`useBatchProcessing`が例外を各itemのerrorにし、`resultsRef`へのpush・Blob作成より前に停止する。

## 静的確認

- `validateImageFile`はJPEG/TIFF/WebPを受理する。
- 修正前の`stripMetadata`は非JPEGで`data: bytes`をそのまま返す。
- callerはwarningを失敗と見なさず、`_cleaned`のBlobを結果配列に追加し、自動ダウンロード/ZIPに渡す。
- `parseExif`がJPEG APP1のみを読む問題は別件であり、本差分では拡張しない。TIFF/WebPの表示結果でmetadataの有無は証明しない。

## Regression準備

- unit: 合成TIFF IFD（Make=TEST）およびWebP EXIF chunkを入力し、非JPEG削除が例外になることを検証。既存JPEG regressionは保持する。
- E2E: 各非JPEG単一入力で成功表示・個別ボタン・自動downloadなし。2 JPEG+TIFF+WebP混在でZIP中央directoryがJPEG2件だけになることを検証。
- fixtureは合成のダミーメタデータ。個人情報・外部データを使用しない。

## 実行状況

2026-10-21、承認済みWSL bubblewrap runner内でEXIF unitを実行した。sourceと既存dependenciesはread-only、networkなし、environment allowlist、scratch tmpfs 64MiB、file 1MiB、CPU 10秒、AS 768MiB、NPROC 32、wall 20秒、stdout 64KiB。target生成ファイルを保存・持ち出していない。

- 修正前: 28件中26成功・2失敗、exit 1。TIFF/WebP両方が`Missing expected exception`となり、非JPEGのfail-closed条件を満たさないことを確認。
- 指定base snapshotで追加再現: 既存`convert-sample.webp`（232 bytes）に合成EXIF chunkを追加し、`validateImageFile`の受理と`stripMetadata`の元bytes同一参照・全bytes一致・warning 1件をassertしてexit 0。実画像fixtureを基にしたAPI経路の観測であり、EXIF追加後のブラウザrenderは未検証。
- 修正後: 同じテスト28/28成功、exit 0。JPEGの既存EXIF/XMP/IPTC除去・JFIF/ICC保持テストを含む。
- Nodeの`--jitless`では組込TypeScript strippingがWASM不足で初期化失敗したため、既存TypeScript `transpileModule`を使った。production・test・参照constantsの3ファイルをscratchへ変換し、import参照先だけ置換して実行。テスト条件・期待値は変更していない。
- 追加確認: runnerの`ts-loader.mjs`で原本`tests/unit/exif.test.ts`を直接読み込み、28/28成功、exit 0。同loaderも既存TypeScriptでメモリ上変換し、JIT無効を維持する。
- `git diff --check`: 成功。
- lint: 未実行。既存Biome binaryはWindows版のみで、承認済みLinux runnerでは実行できない。Windows側target実行や新規dependency導入は行っていない。
- E2E、full unit、check、build: 未実行。browserの安全runnerは今回の承認範囲外。E2EはCI向けに準備したが、単一/混在downloadのブラウザ実測成功は主張しない。

原本unit確認コマンド（runner自身への絶対パスは監査記録側）:

```text
runner.py --deps /mnt/d/tools-codelife-cafe/node_modules --source <EXIF専用worktree> /usr/bin/node --jitless --single-threaded --v8-pool-size=0 --max-old-space-size=128 --import /runner/ts-loader.mjs --experimental-test-isolation=none --test /source/tests/unit/exif.test.ts
```

Draft PRとして引き渡し、最新headのCIおよび実装と異なるモデルによる独立レビューを待つ。未実行のlint/E2E/buildやローカルunit成功を、Merge gateの成功として扱わない。
