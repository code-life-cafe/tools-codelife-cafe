# イベント計測設計

改善効果を前後比較するため、匿名・集計前提の最小イベントだけを計測します。計測は `src/lib/analytics.ts` の `track()` に集約し、Cloudflare Web Analytics 互換の `window.cloudflare.track()` または Cloudflare Zaraz の `window.zaraz.track()` が存在する場合だけ送信します。どちらも存在しない環境では何も送信せず、ツール本体の動作を妨げません。

## イベント一覧

| イベント | props | 発火条件 |
| --- | --- | --- |
| `tool_run` | `{ tool }` | 個別ツールページで実行・変換・生成・計算などの主要操作ボタンをクリックしたとき |
| `tool_engage` | `{ tool }` | 個別ツールページで初めて入力・選択・操作が起きたとき |
| `search_empty` | `{ q }` | トップ検索モーダルで検索結果が0件になったとき |
| `related_click` | `{ from, to }` | 個別ツールページ下部の関連ツールカードをクリックしたとき |
| `shared_url_open` | `{ tool }` | `?shared` / `?share` / `?from=share` / `?utm_source=share` 付きで個別ツールページを開いたとき |

## 送信しないデータ

- ツールに入力されたテキスト、CSV、JSON、SQL、正規表現、郵便番号、電話番号
- アップロードされた画像、PDF、CSVなどのファイル内容・ファイル名
- 変換結果、解析結果、生成結果
- 個人を識別するID、Cookie、ローカルストレージ内のユーザー設定

`track()` が許可する props は `tool` / `from` / `to` / `q` / `shared` のみです。`q` は検索結果0件の検索語だけに限定し、100文字で切り詰めます。計測失敗時は例外を握りつぶし、ツールの処理を継続します。
