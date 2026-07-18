# 調査メモ: 2026-07-12 cipher異常アクセス（UA・IP・ASN分析用クエリ例）

## 背景

2026-07-12に `tool_run` イベント578件（全体の84%）が集中し、うち `cipher`（`/cipher`）単体で475件を占めた。現状は human/bot が同一イベントに混在しており、人間向け施策のゲート判定に使えない状態だった。本ドキュメントは正体特定（AIエージェント／検索クローラー／自動テスト／スクレイパーの分類）のための調査クエリ例をまとめる。**遮断・レート制限は行わず、観測のみを目的とする。**

> 実行自体はCloudflareダッシュボード／Colabで人間が実施する。本ドキュメントはクエリ例の提供のみを目的とする。

## 前提: 自前の Analytics Engine データセットには UA・IP・ASN が含まれない

`tools_codelife_cafe_events`（本リポジトリの `EVENTS` バインディング）は、プライバシー方針上、個人を特定しうる IP アドレスやリクエストヘッダーの生値を保存していない（`docs/analytics.md` 参照）。そのため、blob6 の `traffic_type`（本タスクで追加、`human` / `ai_agent` / `crawler` / `unknown`）は将来のイベントに対する分類には使えるが、**2026-07-12 時点のイベントには遡って付与されない**。

7/12 スパイクの UA・IP・ASN 分布を調べるには、Cloudflare のプラットフォーム側のログ・分析（Pages Functions / HTTP リクエストログ、GraphQL Analytics API）を参照する必要がある。

## 1. Cloudflare GraphQL Analytics API での調査例

Cloudflare ダッシュボードの **Analytics & Logs > HTTP Traffic**、または GraphQL Analytics API (`httpRequestsAdaptiveGroups`) を用いて、`/cipher` パスへのリクエストを日時・UA・ASN・Bot Score で集計する。

```graphql
query CipherSpikeInvestigation($zoneTag: string!, $start: Time!, $end: Time!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 1000
        filter: {
          datetime_geq: $start
          datetime_leq: $end
          clientRequestPath: "/cipher"
        }
        orderBy: [count_DESC]
      ) {
        count
        dimensions {
          clientRequestHTTPHost
          userAgent
          clientCountryName
          clientASNDescription
          botScore
          botScoreSrcName
        }
      }
    }
  }
}
```

- `$start` / `$end` は `2026-07-12T00:00:00Z` 〜 `2026-07-13T00:00:00Z`（JST基準の場合は要調整）。
- `botScore` / `botScoreSrcName`（Cloudflare Bot Management のスコア・判定根拠）が利用可能なプランであれば、既知AIクローラーかどうかの裏付けに使える。
- ダッシュボードから直接見る場合は **Security > Analytics > HTTP Traffic** で `URI Path` を `/cipher` にフィルタし、`User Agent` / `ASN` / `Bot Score` の内訳を確認する。

## 2. AIエージェント由来の場合の記録項目

AIエージェント由来と判明した場合は、Phase 3h AI対応の効果検証材料として以下を記録する（Notionタスクへの追記推奨）。

- サービス名（例: ClaudeBot / GPTBot / PerplexityBot 等、`functions/lib/known-bots.ts` の `AI_AGENT_USER_AGENTS` と突き合わせ）
- 参照元（Referer があれば）・想定される利用シナリオ（検索結果表示 / 回答生成時のRAG参照 等）
- アクセス時間帯・頻度パターン（bot特有の一定間隔アクセスか、bursty か）

## 3. 実装後の継続監視クエリ（自前データセット、`traffic_type` 付与後）

`traffic_type` 実装デプロイ以降のイベントであれば、`tools_codelife_cafe_events` 側でも `cipher` の traffic_type 別件数を監視できる。

```sql
-- cipher の traffic_type 別 tool_run 件数（実装デプロイ以降のみ集計可能）
SELECT blob6 AS traffic_type, COUNT(*) AS count
FROM tools_codelife_cafe_events
WHERE index1 = 'tool_run' AND blob2 = 'cipher'
GROUP BY traffic_type
ORDER BY count DESC
```

```sql
-- cipher の日次 tool_run 件数推移（traffic_type別、急増検知用）
SELECT
  toDate(timestamp) AS day,
  blob6 AS traffic_type,
  COUNT(*) AS count
FROM tools_codelife_cafe_events
WHERE index1 = 'tool_run' AND blob2 = 'cipher'
GROUP BY day, traffic_type
ORDER BY day DESC, count DESC
```

## 完了条件との対応

- ①humanセグメント単独でのゲート再レビュー: `docs/analytics.md` の「【human セグメント限定】ツール別の実行件数」クエリを使用する。
- ②AI利用の別枠KPI観測: `docs/analytics.md` の「【ai_agent セグメント限定】AI利用のKPI観測」クエリ、および本ドキュメントのクエリ2・3を使用する。
