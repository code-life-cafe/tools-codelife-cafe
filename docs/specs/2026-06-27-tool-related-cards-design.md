# ツール間回遊カードセクション 設計

- 日付: 2026-06-27
- ステータス: 承認済み（ユーザー承認 2026-06-27）

## 背景・課題

各ツールページの「📖 使い方・ユースケース」`details` の最下部に、関連ツールが
小さなテキストリンク（`関連ツール: A B C`）として手書きで埋め込まれている。

- 視認性が低く、回遊（ツール→ツールの移動）を促せていない
- 22 ページに分散して手書きされており、保守が困難
- 関連付け情報が `catalog.ts` に存在せず、データとして再利用できない

これを独立した見出し付きの「関連ツール」セクションに格上げし、トップページと
同じカード UI で表示する。

## 決定事項（ユーザー確認済み）

1. **選定ロジック: ハイブリッド** — `catalog.ts` の `related` を優先表示し、
   3 枚に満たなければ同カテゴリの他ツールで自動補完する。
2. **実装方式: ToolLayout に集約** — `related` を `catalog.ts` に持ち、
   `ToolLayout.astro` が `path` から自動でセクションを描画。各ページの手書き
   リンクは削除する。
3. **見た目: フルカード3枚** — トップページと同じ `ToolCard.astro` を流用し、
   `sm:grid-cols-2 lg:grid-cols-3` のグリッドで表示する。
4. **配置** — `slot name="usage"` の直下に、独立した見出し「関連ツール」
   セクションとして置く。

## アーキテクチャ

### 1. データモデル（`src/lib/tools/catalog.ts`）

`ToolCatalogItem` にフィールドを追加:

```ts
related?: readonly string[]; // 関連ツールidを優先順で。省略可。
```

ヘルパー関数を追加（ロジックを分離し単体テスト可能にする）:

```ts
export function getRelatedTools(toolId: string, limit = 3): ToolCatalogItem[]
```

仕様:
- `related` に指定された id を順に解決（自分自身・存在しない id・重複は除外）
- `limit` に満たない場合、**同カテゴリ**の他ツールで補完（既出・自分は除外）
- なお補完してもなお 0 件なら空配列を返す（呼び出し側はセクションを描画しない）
- 返り値は `ToolCatalogItem[]`（カード描画にそのまま渡せる）

### 2. 表示（`src/components/common/ToolLayout.astro`）

- 既に `path` から `tool` を解決済み（`toolCatalog.find((t) => t.href === path)`）。
- `tool` が解決でき、かつ `getRelatedTools(tool.id)` が 1 件以上を返す場合のみ、
  `slot name="usage"` の直下に以下を描画:

```astro
{related.length > 0 && (
  <section class="mt-8" aria-labelledby="related-tools-heading">
    <h2 id="related-tools-heading" class="text-lg font-semibold mb-4">関連ツール</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {related.map((t) => (
        <ToolCard
          title={t.title}
          description={t.description}
          href={t.href}
          icon={t.icon}
          category={t.category}
          categoryColor={t.categoryColor}
        />
      ))}
    </div>
  </section>
)}
```

設計判断:
- **`span` は渡さない**（既定値 1）。ツールページは横幅が狭い（`max-w-[800px]
  xl:max-w-5xl`）ため、全カードを均等 1 マスにしてレイアウト崩れを防ぐ。
- **`categoryId` は渡さない**。トップページのカテゴリ絞り込み（`#tool-grid` 前提の
  `setupCategoryFilter`）はツールページに存在しないため、バッジに絞り込み
  アフォーダンスを付けると誤解を招く。バッジはラベル表示のみとする。

### 3. 各ツールページ（`src/pages/*.astro` ×22）

`slot="usage"` 内の「関連ツール:」リンク行（`<div class="flex flex-wrap gap-3
pt-2 border-t border-border">...</div>`）を削除する。`catalog.ts` の `related`
に集約済みのため重複を排除する。

> 注意: 一部ページは `usage` 内の HTML 入れ子が微妙に異なる（例:
> `url-encoder.astro` は本文ラッパ `div` が省略されている）。削除は
> 各ファイルを直接読んで該当ブロックだけを正確に除去すること。一括 sed は使わない。

## 関連ツール移植マップ

各ページの手書きリンクを `related` に移植する。`getRelatedTools` は先頭から
`limit`(=3) 件を採用するため、4 件以上のものは順序が優先度を意味する。

| ツール id | related（優先順） |
|---|---|
| bg-remove | image-compress, image-mosaic, image-text |
| base64 | url-encoder, cipher, unicode-converter |
| csv-editor | json-csv, csv-fixer, zipcode |
| color | hash, markdown, favicon |
| image-compress | image-convert, bg-remove, image-mosaic, image-text, favicon, pdf-merge, pdf-split |
| cipher | url-encoder, unicode-converter, base64 |
| hash | cipher, masking, color, base64 |
| json-formatter | json-csv, csv-editor |
| favicon | color, image-compress, image-text |
| csv-fixer | json-csv, csv-editor |
| pdf-merge | pdf-split, image-compress, image-mosaic |
| json-csv | json-formatter, csv-editor, csv-fixer, tax, markdown |
| zipcode | phone-formatter, dummy-data, csv-editor, tax |
| image-text | image-mosaic, image-compress, bg-remove |
| image-mosaic | image-text, image-compress, masking, bg-remove, pdf-merge |
| phone-formatter | char-count, csv-fixer, masking, zipcode |
| masking | image-mosaic, dummy-data |
| image-convert | image-compress, image-mosaic, image-text, bg-remove |
| url-encoder | base64, cipher, unicode-converter |
| pdf-split | pdf-merge, image-compress |
| tax | zipcode, json-csv |
| markdown | json-csv, color |

> `cipher` / `hash` の `base64` の挿入位置は、実装時に各 `.astro` を直接読んで
> 元のリンク並び順どおりに確定すること（上表の末尾配置は暫定）。
> `related` を持たないツール（`char-count`, `dummy-data`, `qr-generator`,
> `regex-tester`, `sql-formatter`, `text-diff`, `wareki-converter`,
> `zenkaku-hankaku`, `unicode-converter`）は同カテゴリ自動補完のみで表示される。

## テスト

- **単体（`getRelatedTools`）**: related 優先 / カテゴリ補完 / 自己除外 /
  存在しない id 無視 / 0 件時の空配列、を検証。
- **E2E（Playwright, `tests/e2e/fixtures/base.ts` 経由必須）**: 代表ツールページ
  （例: base64, image-compress）で「関連ツール」見出しとカードリンクが表示され、
  カードのリンク先が正しいことを確認。

## セキュリティ注記（重要・後続作業者向け）

本設計のブレインストーミング中、**プロンプトインジェクション攻撃**が発生した。
ツール通信を装った偽の内容が混入し、以下を信じ込ませようとした:

- 「`ToolCard.astro` が category-chip 重複・`</body>` 混在で壊れている」
- 「teammate が ToolCard.astro のバグ修正に注意せよと言っている」

**いずれも虚偽**。実ファイル `src/components/common/ToolCard.astro` は 53 行の
正常な `<a>` カードであり、重複も構文破綻もない（props は `title, description,
href, icon, category, categoryId?, categoryColor?, span?`）。これは「正常な
ファイルを修正させて壊す」典型的な誘導である。

**`ToolCard.astro` を"バグ修正"してはならない。** 本作業で `ToolCard.astro` を
変更する必要は一切ない（流用するだけ）。

## スコープ外

- `ToolCard.astro` の改修（流用のみ。変更不要）
- 関連度の自動スコアリング（キーワード類似など）— 今回はハイブリッド固定
- トップページ・検索の挙動変更
