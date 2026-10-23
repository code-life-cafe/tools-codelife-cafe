# CSV抽出・並べ替えのWebMCP実装計画

2026-10-15 JST / 承認待ち / Risk R3（WebMCP）
調査基準: main d6a80f8d73399b183e6fc1243af3a9e0e13412cd。
実装Codex、実装後の独立レビューagy。今回は計画のみ。

## 目的・既存タスク

CSV/TSVの「条件に合う行を抽出して並べ替える」をAIから再現可能にする。
既存JSON↔CSVと連鎖でき、通常画面の入力や編集中データを上書きしない。
既存Notion [WebMCP優先07](https://app.notion.com/p/3f1dfd36033681699144f366194196c5)のACを具体化する。
同ページは要計画・旧担当Claude Codeだが、今回のユーザー指定Codex実装・agyレビューを優先する。
重複タスクは作らず、既存タスクのAC/担当/ステータスを無断で書き換えない。

## 調査で確認した前提

- CsvEditor.tsxはinferColumnType→queryRows→parseCsv/exportCsvを利用。CSVエディタのWebMCP登録はない。
- 純粋関数table-query.tsは文字列/数値/日付/boolean比較、複数条件と安定ソートを持つ。
- inferColumnType(['001','010','002'])はnumber。parseNumber('Infinity')はInfinity。
- parseCsv('a,b\n"unterminated')は部分データを返しエラーを表に出さない一方、Papa.parseはMissingQuotesを返す。
- このためUIの型推定や寛容なparseCsvをそのままAPI契約にはしない。既存UI/共通関数は修正しない。
- defineMcpToolの入力型はstring/number/booleanのみ。入れ子schema拡張やJSON文字列クエリを避け、初版は1フィルタ＋1ソートに限定する。
- source/registry/manifestとopen PRを確認し、CSV対応の重複PRは見つからなかった。Notion横断検索は未実施。

## 公開契約

toolId: csv-editor / name: query_csv / readOnlyHint:true / untrustedContentHint:true。
単一ソースdefineMcpTool→descriptor生成→registry→CsvEditorのuseEffect登録/cleanup。
consequentialHintは現行型にないため共通型を拡張しない。

| 入力 | 型・既定値 | 契約 |
| --- | --- | --- |
| text | 必須string、maxLength100000 | CSV/TSV本文。Unicodeコードポイント上限 |
| format | csv/tsv、既定csv | 区切りを明示。自動判定しない |
| hasHeader | 必須boolean | 先頭行をヘッダーとして扱うか |
| filterColumn | 空文字またはA〜AX、既定空文字 | 最大50列の物理列記号。重複/空ヘッダーでも曖昧にならない |
| filterOperator | none/eq/neq/contains/notContains/startsWith/endsWith/gt/gte/lt/lte/empty/notEmpty、既定none | 1条件だけ |
| filterCompare | text/number、既定text | 型推定しない |
| filterValue | string、既定空文字、maxLength1000 | eq/neqでは空文字も有効。trimせず比較 |
| sortColumn | 空文字またはA〜AX、既定空文字 | 1列だけ。未指定なら元順序 |
| sortDirection | asc/desc、既定asc | 安定ソート |
| sortCompare | text/number、既定text | 比較方式を明示 |

成功出力: { result:string, inputRows:number, outputRows:number, columns:number }。
resultは入力と同じ区切りのCSV/TSV。ヘッダーはhasHeader=trueのときのみ先頭へ保持。
inputRows/outputRowsはヘッダーを含めない。columnsはパディング後の列数。
配列/入れ子の入力schemaや未知の設定フィールドを追加しない。
列記号は固定enum（空文字,A..AX）としてschema/runtimeを同じ定義から生成する。
列存在・型と演算子の組合せ等のデータ依存制約は説明文と日本語の意味検証で明示する。

例:
query_csv({text:'ID,金額\n001,90\n010,120\n002,150',format:'csv',hasHeader:true,
 filterColumn:'B',filterOperator:'gte',filterCompare:'number',filterValue:'100',
 sortColumn:'B',sortDirection:'desc',sortCompare:'number'})
→ {result:'ID,金額\r\n002,150\r\n010,120',inputRows:3,outputRows:2,columns:2}

## 比較・CSV仕様

1. フィルタ無効はcolumn空＋operator none＋compare text＋value空の組のみ。片方だけ指定・無効設定への非既定指定は固定エラー。
   ソート無効もcolumn空＋direction asc＋compare textのみ。不要な引数を黙って無視しない。
2. textのeq/neq/contains等は既存matchesConditionの大小・前後空白を区別する文字列比較。
   gt/gte/lt/lteはnumberのみ。contains系はtextのみ。empty/notEmptyはセルの厳密な空文字を判定しvalue空を要求。
   同じ列でフィルタ/ソートする場合compareを一致させ、競合時は拒否。正規表現/日付/boolean/OR/複数条件/複数ソートは初版対象外。
3. 数値は既存parseNumberと同じ空白・全角数字・カンマ・¥/￥/$の扱いを使う。
   対象列の非空セルと数値filterValueを事前検証し、変換不能・非有限・絶対値がMAX_SAFE_INTEGER超を拒否。
   numberはJavaScript倍精度で比較し、parseNumberが受理する指数表記/16進表記も受理する。厳密十進演算を保証しない。IDはtextを使う。セル原文は書き換えない。
4. 数値フィルタの空セルはempty/notEmpty以外では不一致（neqも同じ）。
   数値ソートの空セル位置は既存applySortに合わせasc末尾/desc先頭。空同士は同値として元順序維持。
   textソートは既存Intl.Collator('ja',{numeric:true,sensitivity:'base'})を用いるため、大小/全半角等が同値になれば元順序維持。
   ロケール/ICUを跨ぐバイト単位のソート一致は保証しない。
5. parseは既存PapaParseをstring入力・download:false・dynamicTyping:false・header:false・skipEmptyLines:falseで利用。
   任意の構文エラーは部分結果を返さず固定日本語。raw parser message・原文・stackを返さない。
   既存UI同様、空/空白だけの本文は空テーブル。ただし入力上限判定が先。
   不均一行は既存UI同様に最大列数まで空セルを補う。空行/末尾改行由来の空行を保持し、ヘッダーは抽出/並べ替えから外す。
   BOM/引用符内改行/CRLF/LF/タブ/ダブルクォートの挙動は既存ライブラリと固定例の両方で検証する。
6. queryRows/applyFilter/applySortへ型を明示したColumnを渡し、既存exportCsvを再利用。
   通常UIとの一致は、UIの推定型と明示型が同じ正常データで検証する。
   IDの明示textとUI自動数値推定との差、不正CSVを厳密に拒否する差はAPI固有の仕様として説明し、UI全挙動一致とは主張しない。
7. =,+,-,@等を含むセルやHTML文字列もデータとして保持し、実行・DOM挿入・URL取得しない。
   Excel数式の無害化や自動ダウンロードは含めず、AIへ返す結果は未信頼データと説明する。

## 安全予算・失敗時

- 本文100000コードポイント、データ行1000（ヘッダー別枠1）、列50、パディング後総セル20000（ヘッダー込み）。
- filterValue1000コードポイント。成功オブジェクトをJSON化したUTF-8最大1MiB。
- 同期の有界処理。100k本文を全解析して構文エラーを確認後に行/列/セル上限を判定する。input上限で最悪の割当も有界。
- 上限超過は省略せず拒否し、truncate/preview/暗黙ページングをしない。Workerや新規依存は追加しない。ハードな時間保証はしない。
- エラー優先順位: schema/本文上限→操作指定の組合せ→CSV構文→行/列/セル上限→列存在→数値検証→クエリ→出力JSON予算。
- 固定日本語例:「CSVの形式が正しくありません。引用符や区切りを確認してください。」
  「入力データが処理上限を超えています。」「数値として比較できない値が含まれています。」
  未知例外は「CSV処理に失敗しました。入力と条件を確認してください。」に置換。
- UI入力/編集/Undo/フィルタ/ソート/タブ/共有設定を参照・変更しない。
  入力・結果・条件を通信/console/local/sessionStorage/URL/Analyticsへ追加しない。成功resultがAIに返る点は明示する。

## 変更予定ファイル

- 新規 src/lib/tools/csv-editor-query.ts: API用の有界パース・条件検証・既存クエリへのadapter。
- 新規 src/lib/tools/csv-editor.mcp.ts: 単一ソース宣言・予算・固定エラー。
- src/components/tools/CsvEditor.tsx: 登録/cleanupだけ。通常UI/型推定/ファイル処理は変更しない。
- src/lib/webmcp/registry.ts: 1操作追加。
- public/.well-known/webmcp/tools.generated.json: 生成のみ、既存18操作保持→19。
- tests/unit/csv-editor-mcp.test.ts: API/固定値/境界/故障注入。
- tests/e2e/csv-editor-webmcp.spec.ts: 既存fixtureで登録/実行/UI/不変性/privacy/非対応。
- approved plan / walkthrough / docsの実装・独立レビュー記録。

table-query.ts/csv-editor.ts、共通schema、Analytics、SW/PWA生成、CI/deploy、依存、Constitution、権限は変更禁止。
既存の型推定・日付不具合は別タスクとし、今回の差分に混ぜない。

## 検証・受入条件

1. 単体: CSV/TSV、header有無/空/重複、列A/AX/範囲外、全演算子、先頭ゼロ、全角/通貨/負数/小数、NaN/Infinity/unsafe数値、空セル、同値安定ソート、数値空値位置。
   引用符内区切り/改行、末尾LF、BOM、不均一行、空白本文、式/HTML文字列、欠落/型違い/未知enum/矛盾条件。
   schemaとruntime、既存関数との一致、固定期待値を別々に確認。
2. 100k/100k+1（絵文字コードポイントも）、1000/1001行、50/51列、20000/20001セル、出力1MiB境界を検証。
   複数の不正条件でエラー優先順位を固定。未知例外/出力超過を故障注入、RED確認後必ず復元。
3. E2Eはtests/e2e/fixtures/base.ts。PC1280/mobile390で登録→引数付き実行→固定結果。
   UI推定と型が合う文字/数値例を通常UIフィルタ/ソートと比較。MCP別入力の前後で入力/結果/方向相当設定/タブ/Undo/URL/保存不変。
   document現行/legacy fallback、非対応/不完全/登録失敗、解除/再登録を確認。
4. 合成マーカーでfetch/XHR/beacon/WebSocket/console/storage/URLを監視し、MCP由来のtool_run等が増えない。
   fixtureの遮断を非送信の唯一の証拠にしない。
5. build→全unit、lint、型チェック、既存CSV/JSON↔CSV/関連WebMCP E2E。
   manifest既存18操作を保持し19操作へ（registry17ツール、legacy込み19ツール21操作見込み）。
6. ローカルpreview実WebMCPで検出/実行/日本語エラー/UI一致/不変を確認。
   PWAはSW有効の使い捨てcontextでwarm-cache後のoffline処理、登録/キャッシュ/保存0を確認して破棄。永続設定変更なし。
7. Codex実装後、agyがAC＋Production＋追加/変更テストを独立レビュー（read-only、利用可能モデル確認）。
   指摘は一次コード/再現で採否を判断。修正ループ最大3周。未完了レビューは承認扱いしない。
8. Draft PRの最新headで必須lint/e2eと正式Code/Securityレビューを別に確認。既存CIのskip/flakyも内訳報告。
   ローカル/agy/CI/本番受入は別証拠。PR #454の成功を新機能の合格に流用しない。

## 実施順序・承認境界

1. 人間の本計画承認後、最新main/既存タスク/重複PRを再確認しcleanな隔離checkoutを使う。
2. 固定例・異常系を先に作り、本文→1フィルタ→出力の最小経路を検証。
3. ソート/残る予算/異常系を足し、通常UIを変えず登録/cleanupする。
4. 全検証と実クライアント受入→agy独立レビュー→必要修正→Draft PR/CI結果を報告。

今回の依頼は確認と計画作成。実装/Merge/Deployは開始しない。既存PR #454のマージ承認は流用しない。
計画承認だけで新規依存・共通schema拡張・SW修正・Merge/Deployは許可しない。

## 一次資料

- mainのCsvEditor.tsx、csv-editor.ts、table-query.ts、define-tool.ts、registry、生成manifest。
- 上記Notion優先07の取得内容。旧担当指定を今回の人間の役割指定で上書きするのは本作業の範囲のみ。
- 匿名需要集計の期間・制約は ../prioritization-after-unicode-2026-10-15.md と demand-evidence.json。
- Chrome公式 https://developer.chrome.com/docs/ai/agents : 構造化引数と既存機能公開・公開前evalの設計根拠。需要の実測根拠ではない。
- PapaParse公式 https://www.papaparse.com/docs : string parserのerrors、download、dynamicTyping、unparseの根拠。

## 計画時の独立批評状況

Codexのソース調査と設計整合確認まで実施。計画段階のagy設計批評は、計画/内部ソースの外部送信範囲が未承認として自動承認審査で拒否されたため未実施。CLIは起動されず外部送信していない。これはagyのreview findingsではなく実行前の承認拒否。実装開始と、計画・対象コード/テストをAntigravity CLI（agy/Gemini）へ渡す独立レビューの範囲を承認後に進める。実装後レビュー未完了を承認扱いしない。

## 実装承認

2026-10-15、ユーザーが本計画とCodex実装・agyレビューを承認。計画・対象コード/テストをagy（Gemini）へ渡す独立レビューの範囲も直前の確認に対して承認済み。base d6a80f8。完了したUnicodeのclean checkoutをcodex/webmcp-csv-queryとして再利用。Merge/Deployは含めない。
