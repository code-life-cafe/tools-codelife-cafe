# 業務向け3ツールの実装・検証記録

2026-10-06。Risk Class: R2（新規ツール）。実装計画はユーザー承認済み。Merge・公開は別途人間承認が必要。

## 実装

- URLパラメータ解析・編集: http/https URLの構成表示、順序・重複・空キー/値を保持する編集、再生成・コピー。不正なエンコードは警告と原文保持。入力URLへの通信なし。
- ランダム並べ替え・グループ分け: Web Cryptoの乱数、重複保持、空行除外、人数差最大1の均等分け、コピー・テキスト保存。
- ログ時間差分析: ISO 8601/UNIX秒/ミリ秒、元行番号付き差分、上位10件、逆転・不正行診断、CSV保存。時刻の間隔と処理時間は区別。
- 4ファイル構成、catalogと旧URL用registry、README一覧・54件表記、unit/E2Eを追加。依存・CI・Analytics・WebMCP・PWA・権限は変更しない。

## 検証

- `npm run test:unit`: 1,275件成功。新規3ツールの41件を含む。
- `npm run build`: 成功（113ページ、54 OG画像）。既存の大きなbundle警告あり。
- `npx tsc --noEmit --pretty false --ignoreDeprecations 6.0`: 成功。
- `npm run check`: Astroはエラー0、警告0、hint48。Biomeは成功、既存警告15件。最終差分で`npm run lint`も成功。
- 対象E2E: 3ツール、category-filter、全ツールsmokeをPC/モバイルで実行し、172件成功（34.3秒）。
- 通信遮断を使わない別contextで、ダミー入力がリクエスト・console・localStorage・sessionStorageに含まれないことを検査。入力URLへのアクセスも検査。
- Chromeの実画面で日本語URLの解析・再生成を確認。
- 独立した読み取りレビューの不正行診断表示の指摘を修正し、再レビューで解消確認。これはGitHub上の必須Code/Security Reviewの代替ではない。

## 検証の境界と環境

- 大量行のPlaywright `fill`は単独でもタイムアウトした。10,001項目/行の上限ケースはネイティブtextarea setterと`input`イベントでReactの入力処理へ投入し、上限エラーを検査する。通常入力は`fill`で検査。巨大な貼り付け操作そのものの実測は未確認。
- 入力欄は初期高さ200px、最大400px、内部スクロールとし、大量行による自動伸長を避ける。
- 初回preview起動はPlaywrightのwebServer検出前にdaemon化して失敗した。起動済みの同じpreviewを確認して再実行し、基盤設定は変更していない。
- ローカル成功と公開の状態は別。最新PRコミットの必須CIおよび独立Code/Security Reviewを経て、人間承認後にMergeする。
- 元checkoutの既存変更`AGENTS.md`・`CLAUDE.md`・未追跡`video/`は今回のコミットに含めない。
