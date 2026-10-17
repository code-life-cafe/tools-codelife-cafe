# WebMCP対応状況と次期対応計画

2026-10-14。調査対象は取得済み origin/main `be80cce`。実装前の承認用案。
既存のルート implementation_plan.md と未コミット変更は変更しない。

## 確認結果

- 単一ソースregistryは13種類のツール・14操作。tax、unix-timeの旧定義を加えると15種類・16操作。サイト共通操作は別枠。
- ページのprovideToolsFromFactory登録をソースで照合。実ブラウザ登録・本番Deploy・Site Tools呼出しは今回未検証。
- 対応済み: hash、zenkaku-hankaku、json-formatter、char-count、base64、url-encoder、uuid、cron-checker、jwt-decoder、qr-encrypt、mermaid、yaml-json-toml、masking、tax、unix-time。
- Mermaid・形式変換・マスキングはPR #435でmainへマージ済み。古いNotionタスクの「要計画」を未実装の根拠にしない。
- Mermaid描画は小型flowchart/graph/sequenceDiagram限定。マスキングはAI引数の原文を処理する方式であり、ページ内原文をAIへ渡さず処理する操作は未提供。QR暗号化はpayload処理で、画像の生成・読み取り対応を意味しない。
- tax/unix-timeは生成registry外。manifestの件数だけでは全対応範囲を表せない。
- 現在の公開中機能の利用統計を取得していない。下記順位はAIの処理連鎖、検証可能性、実装負担に基づく推測。

## 対応順序

1. JSON↔CSV: AI出力と業務表データの相互変換。既存Notion優先01を利用。
2. テキスト差分: AIによる修正前後の比較。既存テキスト系拡張タスクと調整して重複を避ける。
3. SQL整形: 生成SQLの整形。SQL実行は提供しない。既存優先08。
4. 正規表現: 抽出・置換の検証。既存Workerとタイムアウトを必須とする。既存優先04。
5. ダミーデータ、CSVフィルタ/ソート、郵便番号検索: 既存優先06/07/09。
6. URL解析・ログ時刻解析: 既存の開発者向けタスクと統合。YouTube等の外部取得はこの計画に含めない。

画像/PDF/音声はバイナリ授受、容量、実行時間の別計画を先行させる。対応済みの機能追加・legacy移行も独立した範囲として承認する。

## 最初の実装単位: JSON↔CSV

Risk Class R3。担当はClaude Code、Codexは独立レビュー。計画承認後にMakerが最新main上のimplementation_plan.mdへ確定版を記載する。
対象Notion: https://app.notion.com/3f1dfd360336814cbf08e79f0de50558

### API案

- json_to_csv: text必須、delimiterはcomma/tab/semicolon（既定comma）、includeHeader=true、flattenNested=false、newline=crlf/lf（既定crlf）。既存jsonToCsvを使用。
- csv_to_json: text必須、delimiterはauto/comma/tab/semicolon（既定auto）、hasHeader=true、inferTypes=false、unflattenDotKeys=false。既存csvToJsonを使用。文字列・先頭ゼロを既定で保持する。
- 成功はoutputとrowCount。失敗は既存の日本語エラーをfactoryのエラー経路で返し、原文は返さない。
- 入力上限10万Unicodeコードポイント、出力UTF-8 1MiB。ネスト上限50段。上限超過は省略せず拒否。Makerはネスト制限をパース前/変換前に適用し、既存純粋関数へ安全に到達する方式を計画で具体化する。
- 独立した引数処理でUI入力・結果を更新しない。ダウンロード、コピー、ファイルアクセス、外部URL取得は行わない。
- 入力・結果をログ、通信、localStorage、共有URLに保存しない。既存匿名計測の拡張も行わない。

### 対象ファイル

- 新規src/lib/tools/json-csv.mcp.ts。
- src/lib/webmcp/registry.ts、src/components/tools/json-csv/JsonCsvPage.tsxの登録箇所。
- public/.well-known/webmcp/tools.generated.json（生成物）。
- 新規tests/unit/json-csv-mcp.test.ts、対象WebMCP E2E。
- Maker用implementation_plan.mdとwalkthrough.md。既存別作業を含めない。

依存追加、共通schema拡張、既存UI改変、Analytics、CI、Constitution変更は対象外。

### 必須検証

- JSON/CSV双方向、日本語、引用符、引用符内改行、BOM、ヘッダー有無、全区切り、ネスト展開、先頭ゼロ、安全整数外の値。
- 空入力、不正JSON、不正CSV、未知enum・型、上限ちょうど/超過、深いネスト、出力上限。既存エラー挙動を維持。
- 実ページ登録から引数付き呼出しを行い、同じ設定の通常UI結果と照合。UI状態が変わらないことも確認。
- 入力を含む通信・永続化がないことを確認。共通E2E通信遮断だけを根拠にしない。
- lint、build、unit、対象E2E、型チェック。最新headの必須CIと独立レビューを別途確認。
- ローカル成功、mainマージ、本番Deploy、実クライアント受入は別々に記録する。

## 承認点

第一段階JSON↔CSVのAPI、容量制限、独立実行方式、担当・対象ファイルを承認対象とする。
後続項目は優先順位案であり、一括実装やMerge/Deployの承認対象ではない。
AGENTS.mdのR3人間承認および既存Notionタスクの「API・容量制限・UI同期・安全性・対象ファイルと検証を具体化し、人間承認後に実装する」に従う。

## 今回の準備検証

ローカル既存checkoutのnpm run lintはexit 0、479ファイル、既存警告15件（webmcp.spec.tsのnon-null assertion等）。最新mainのテスト成功を意味しない。Productionコードの変更はなく、unit/E2Eは今回実行していない。Notion優先01へ再調査結果と承認待ちの計画を追記。
