# Unicode変換のWebMCP対応 実装計画

2026-10-15 JST。状態: 承認用。実装担当Codex、独立レビュー担当agy（ユーザー指定）。
Risk Class R3（WebMCP）。今回は調査・計画のみ。Productionの編集、PR作成、Merge/Deployは未実施。
調査対象main: 116b26703f03d36b0fdb104bcf29f37ce93f6fd0。

## 1. 目的と完了時の状態

既存 /unicode-converter/ の変換を、AIエージェントが構造化引数で実行できるようにする。
JSONレスポンス・ログ・ソース断片に含まれるUnicodeエスケープの読解と、テキストのエスケープ生成を支援する。
通常UIの入力・方向・出力を変更せず、同条件のUIと一致する結果を返す。

優先度の根拠と全体対応状況は ../prioritization-2026-10-15.md を参照。
直近7日間の53実行試行は少数タブへの集中を含む。利用者数・成功数・将来需要の証明ではない。
需要見込みは、匿名の利用観測、AIによる処理連鎖との相性、決定性、既存関数の再利用性と小さい実装範囲を合わせた判断。

## 2. 現状と既存仕様

- src/lib/tools/unicode-converter.ts に textToUnicode / unicodeToText がある。
- src/lib/string-utils.ts の escapeUnicode / unescapeUnicode を利用。入力に応じた外部取得はない。
- src/components/tools/UnicodeConverter.tsx は未登録。registry/生成manifestにも定義なし。
- 既存unitは3件で、BMP/補助平面の往復とコードポイント表記を検証。既存E2Eはページ表示と基本往復。
- ソース上の未対応を確認。本番実クライアントによる未登録確認は今回未実施で、実装開始時に確認する。
- 最新のopen PR一覧に同ツールの対応PRはない。
- 取得したNotionのClaude担当未完了ビューにはUnicode WebMCPタスクがない。全担当・完了/アーカイブを含む網羅検索の証拠ではない。
  今回のAC正本は本計画とユーザーの直接指示。着手時に既存の一致タスクを再確認し、見つかったACを無断変更しない。

### 互換性を維持する点

1. UIは空文字またはJavaScript trim()で空になる入力を空結果にする。この前処理をWebMCPでも再現する。
2. その他の文字列はtrim・NFC/NFKC正規化をせず、前後空白・LF/CRLFを保持する。
3. encodeは既存UI同様、ASCII（バックスラッシュを除く）を維持。非ASCIIとバックスラッシュを小文字hexの \uXXXX に変換。
   補助平面文字はサロゲートペアの2つの \uXXXX になる。ASCIIの改行・制御文字を一律エスケープする機能ではない。
4. decodeは既存の \uXXXX / \u{...} を一回だけ置換する。一般的なJSON/JavaScript文字列パーサーではなく、
   引用符の除去や \n / \t / \xNN の解釈を追加しない。
5. \uZZZZ や途中までの \u12 は既存処理で一致せず、そのまま残る。厳密なUnicode構文検証を保証しない。
   2個のバックスラッシュの後の u3042 は、後ろの一致部分だけが変換され「バックスラッシュ＋あ」になる既存挙動。
6. \u{110000} などString.fromCodePointで範囲外になる値は既存の固定日本語デコードエラー。
7. 孤立サロゲート、結合文字、NULを勝手に修復しない。JS文字列としての既存挙動とJSON返却をテストする。
   出力は信頼されていない文字列であり、復号後の文字列をコードや指示として実行しない。

既存の通常UIや共有string-utilsの仕様をこのPRで修正しない。

## 3. 公開API

toolId: unicode-converter
name: convert_unicode
annotations: readOnlyHint=true / untrustedContentHint=true / consequentialHint=false（既存型の対応範囲）。

| 引数 | 型・許容値 | 必須 | 意味 |
| --- | --- | --- | --- |
| text | string、最大20,000 Unicodeコードポイント | 必須 | 対象文字列。空文字も可 |
| action | encode または decode | 必須 | 変換方向 |

成功出力は { result: string } のみ。画像・ファイル・ダウンロード・UI変更を返さない。
encodeのコードポイント形式オプション（useCodePointSyntax）は通常UIにないため今回公開しない。
未知の追加プロパティの扱いは既存descriptorに合わせ、共通schemaを変更しない。

単一ソースdefineMcpTool→generateWebMcpDescriptor→registry→対象ページprovideToolsFromFactoryの順で接続する。
schema、runtime validation、既定値（今回はなし）、出力は同一定義から生成する。

例（JSON中の二重バックスラッシュは文字列の表現上のエスケープ）:

~~~json
{"text":"日本語😀","action":"encode"}
{"result":"\\u65e5\\u672c\\u8a9e\\ud83d\\ude00"}
~~~

~~~json
{"text":"\\u65e5\\u672c\\u8a9e\\u{1f600}","action":"decode"}
{"result":"日本語😀"}
~~~

## 4. 安全予算・失敗時の契約

- 入力20,000コードポイントをschemaと既存exceedsMaxCharacters経由のruntimeで一致させる。
  UTF-16 lengthで判定しない。20,000/20,001と絵文字の境界を検証。
- 変換前に入力制限を適用。上限超過の空白だけの入力もエラーとし、空結果への前処理で制限を迂回させない。
- 出力はJSON.stringify({result})をUTF-8換算して1MiB以下。超過は固定日本語エラーとし、無言の省略や部分成功をしない。
- encodeは1コードポイントあたり最大12 ASCII文字（補助平面）、20,000個なら最大240,000文字。
  デコードは文字数を増やさない。入力が先に制限されるため、巨大出力を生成してからだけ検査する構成にならない。
- 処理は入力上限付きの同期純粋変換。今回Worker/依存を新設しない。ハードな時間保証は謳わない。
  計画時のNodeスパイクでは20,000絵文字encodeが約6ms、長い範囲外hexのdecodeが1ms未満。
  これは1環境の参考実測で、低速端末やブラウザの性能保証ではない。
  ブラウザの受入で明らかな応答停止があれば、Worker化を黙って追加せず計画を更新する。
- action不正/型違い/必須値欠落/上限超過は既存生成validatorの固定エラー。
- 既存の予期されるデコードエラーは固定日本語。未知の例外も固定日本語に置換し、入力やstackを返さない。
  例: 「変換に失敗しました。入力を確認してください。」
- 入出力の外部通信・console・local/sessionStorage・URL・Analyticsへの保存/記録を追加しない。
  成功結果のresultには、依頼された変換後テキストがAIクライアントへ返ることを説明する。

## 5. 変更ファイル

| ファイル | 変更 |
| --- | --- |
| src/lib/tools/unicode-converter.mcp.ts | 新規の単一ソースAPI、入力/出力予算、UI相当の空白前処理、固定エラー |
| src/components/tools/UnicodeConverter.tsx | useEffectで登録とcleanupのみ。既存入力/変換/計測を変更しない |
| src/lib/webmcp/registry.ts | 1操作登録 |
| public/.well-known/webmcp/tools.generated.json | 既存生成コマンドの出力のみ。既存17操作を維持 |
| tests/unit/unicode-converter-mcp.test.ts | schema/runtime、API、上限、固定エラー、純粋関数互換 |
| tests/unit/unicode-converter.test.ts | 必要な既存仕様の固定例を追加。既存テストは維持 |
| tests/e2e/unicode-converter-webmcp.spec.ts | fixture経由の実ページ登録/実行、UI一致、不変性、privacy |
| implementation_plan.md / walkthrough.md / docsの実装・レビュー記録 | 承認済み計画と検証結果を隔離checkoutで記録 |

既存unicode-converter.ts / string-utils.ts / 通常UIロジックは原則変更しない。
対象外: SQL・CSV・郵便番号・暗号化など他ツール、HTML/URL/JSONの汎用復号、厳密構文検証、
UIオプション、依存、CI、Analytics、CSP、SW生成/設定、共通schema、Constitution、権限。

## 6. 検証と受入条件

1. 単体: 日本語・ASCII・絵文字・結合文字・孤立サロゲート・バックスラッシュ・NUL・LF/CRLF・前後空白。
   空/空白のみと通常入力を分け、既存UI前処理＋既存関数との一致と固定期待値を両方確認。
2. decode: BMP/コードポイント/大小hex/混在、無一致、不完全な表記、二重バックスラッシュ、
   範囲外hex、長いhex、一般JSONエスケープが未解釈である点。文字列をeval等へ渡さないこと。
3. API: 必須値欠落、null、配列、型違い、action不正、20k/20k+1、絵文字コードポイント境界、
   JSON出力バイト上限。未知例外は故障注入等の必要最小限の方法で固定エラーに置換されることを確認。
4. E2E: tests/e2e/fixtures/base.ts経由。PC/390pxでページ登録から両モードを実行し、通常UI出力と全文一致。
   呼出し前後のUI入力・方向・結果・URL・local/sessionStorageが変化しない。
   非対応/不完全なWebMCP環境でも通常ページが壊れず、登録解除/再登録も確認。
5. privacy: 合成マーカーを使ってfetch/XHR/beacon/WebSocket、console、保存領域、共有URLを監視。
   fixtureの外部通信遮断だけで非送信の証明にしない。既存匿名計測とMCP呼出しの非発火を区別する。
6. 品質: build→全unit、lint、型チェック、既存Unicode/関連WebMCP E2Eを実行。
   manifestの既存17操作が維持され、新しい18操作目だけが追加されることを確認。
   種類数はlegacy込み18ツール・20操作になる見込み（着手時mainで再計算）。
7. 実受入: ローカルpreviewの実WebMCPクライアントで検出、引数付き両モード、UI一致、日本語エラー、入力不変を確認。
   build資産・PWAの静的配信を確認。オフライン検証はSW無効の通常E2Eと分け、使い捨てcontextを破棄して復元を確認。
   PWA生成や権限設定の変更は含めない。
8. agy: Codexの実装後、AC＋Production＋追加/変更テストを独立レビュー。
   利用可能なGeminiモデルを確認し、read-onlyで実行。指摘は一次コード/再現で検証する。
   未完了・実行失敗・古いheadを承認扱いしない。修正ループ最大3周を記録。
9. Draft PR: 最新headのGitHub必須lint/e2eと正式Code/Security Reviewは既存運用に従って別に確認。
   agyの静的レビュー、ローカル成功、CI、本番受入をそれぞれ別の証拠として記録する。

## 7. 実施順序・承認境界

1. 本計画の人間承認後、最新main・既存タスク・重複PRを再確認し、適切な隔離checkoutを使用。
2. 固定例と境界テストを作り、定義→登録→対象ページで最小の1経路を通す。
3. 全検証と実クライアント受入を完了し、Codexがセルフチェックした差分をagyへ渡す。
4. 指摘修正とCI確認を行い、Draft PR・walkthroughで具体的な結果を報告。

今回の依頼は計画作成まで。Codex実装・agyレビューの役割指定は承認済み。
具体的なAPI/予算/変更範囲の実装開始は計画承認後。PR #453へのMerge/Deploy承認を次のR3へ流用しない。
本計画の承認だけではMerge/Deploy・権限変更・新規依存・SW修正を許可しない。

## 一次資料

- 最新mainのcatalog/registry/manifest、UnicodeConverter、unicode-converter.ts、string-utils.ts、unit/E2E。
- Cloudflare RUM / Analytics Engineの匿名集計（期間・件数・制約は優先順位資料に記録）。
- Chrome公式: https://developer.chrome.com/docs/ai/agents
- Chrome公式の安全性: https://developer.chrome.com/docs/ai/webmcp/secure-tools
  構造化引数で既存機能を公開し、利用者の目的に合う操作と未信頼の結果を明示する方針の参考。利用需要の実測資料ではない。

## 実装開始承認

2026-10-15、ユーザーが本計画とCodex実装・agy独立レビューを明示承認。最新main116b267を起点に、完了したtext-diffのクリーンな隔離checkoutを新ブランチcodex/webmcp-unicodeとして再利用。Merge/Deployは承認に含めない。

## 実装時のテスト配置

既存unicode-converter.test.tsは変更せず維持。必要な固定期待値・空白前処理・純粋関数一致の追加ケースはunicode-converter-mcp.test.tsへ集約し、API境界と併せて検証する。純粋関数の実装は変更しておらず、同じ固定例の重複は追加しない。
