# 業務向け3ツール追加計画

2026-10-06 ユーザー承認済み。Risk Class: R2。

| 名称 / コンポーネント | カテゴリ / アイコン | 関連ツール |
| --- | --- | --- |
| URLパラメータ解析・編集 / UrlParser | 開発ツール / Link | url-encoder、qr-generator、jwt-decoder |
| ランダム並べ替え・グループ分け / RandomSort | ユーティリティ / Shuffle | dummy-data、char-count、text-diff |
| ログ時間差分析 / LogTimeAnalyzer | 開発ツール / CalendarClock | unix-time、cron-checker、regex-tester |

## 第一弾の受け入れ条件

### 1. URLパラメータ解析・編集 (`url-parser`)

- http/https絶対URLを解析し、プロトコル・ホスト・パス・ハッシュを表示。入力URLへ通信・自動遷移しない。
- クエリを順序付きの行で編集・追加・削除。重複キー、空キー/空値、日本語、`+`と`%2B`を区別し、一度だけデコードする。再生成はURL標準の正規化を許容し、バイト列同一を保証しない。
- 元のパス・ハッシュを保持したURLをコピー。不正URL・不正パーセント/UTF-8はエラーまたは明示した警告とし、無言で入力を破壊しない。
- HTML風の値は文字列表示。入力/結果を保存・ログ・計測へ含めない。

### 2. ランダム並べ替え・グループ分け (`random-sort`)

- 改行区切りで入力。空行除外を明示し、重複行は別項目として保持。非空行の本文は勝手にtrimしない。最大10,000項目、入力1MiB上限。
- Web Crypto乱数とrejection samplingを使うFisher-Yatesで並べ替え。グループ数1〜項目数で均等分配し、人数差を最大1にする。
- 結果コピー、テキスト保存、クリアに対応。0/1項目・重複・不正グループ数・乱数API利用不能を扱う。
- 入力と結果はメモリのみ。本文localStorage保存は行わない。確率的テストで公平性を断言せず、固定乱数を注入した境界テストを行う。

### 3. ログ時間差分析 (`log-time-analyzer`)

- 初版はISO 8601（Z/オフセット必須）、UNIX秒、UNIXミリ秒。各行の先頭（任意の角括弧付き）のタイムスタンプを解析。単位は明示選択、曖昧な自動判定を避ける。
- 解析できた行を入力順に比較し、元行番号・時刻・差分msと上位10件の正の時間差を表示。同値は元順。負差分は順序逆転として別表示。
- 不正行/日時を件数と行番号で表示。スキップを挟んだ差分は「解析可能な前行との間隔」と明記。ログ間隔を処理時間や原因確定として表示しない。
- 空入力・1有効行・全行不正・同時刻・逆順・オフセット・小数秒のテストを用意。最大10,000行/1MiB、結果をCSV保存（表計算の数式注入を防止）。
- Syslog/Apache/任意正規表現は初版から除外。ログ本文を保存・送信・計測しない。
- UNIX形式は0以上の数値を対象とする。小数はマイクロ秒精度で扱い、それより細かい桁の切り捨てを画面とFAQに明記する。

## 変更範囲と進め方

- 各slugに `src/lib/tools/<slug>.ts`、`src/components/tools/<PascalName>.tsx`、`src/content/tools/<slug>.md`、`src/pages/<slug>.astro` を作成。
- 各toolの `tests/unit/<slug>.test.ts` と `tests/e2e/<slug>.spec.ts`、`src/lib/tools/catalog.ts` の登録・必要な関連リンクだけを変更。既存のページ生成経路・旧URL扱いは着手時に確認。
- `add-tool` の掲載要件に従いREADMEの一覧と件数を更新。旧URLで操作部を利用できるよう既存component registryへの3件登録が必要な場合は追加する。
- 共通部品・ToolLayout・日本語LP・SEOを利用。WebMCP、Analytics allowlist、CI、PWA、依存、権限、AGENTS/CLAUDEは変更しない。設定保持は必要な設定値のみ既存hookを使用。
- 承認後、最新mainと進行中作業の重複確認→各toolを別の小さな変更単位で実装→unit/E2E→独立レビュー→Draft PR。既存Maker/Reviewer分担を維持し、同じ実装者の自己承認を避ける。
- 必須検証: lint、unit、対象E2E、build/型確認、PC/モバイル・キーボード操作、入力非永続化。通信確認ではE2E fixtureの遮断だけを証拠にせず、通常ブラウザの通信経路も確認。
- R2のMerge・公開は別途人間承認。継続実装の意図は本計画内の順次追加として扱い、定期自動実行は新設しない。


