# 開発ガイドライン & ツール作成手順

本ドキュメントは、**CODE:LIFE Tools** におけるツールの開発プロセス、命名規約、およびコーディング標準を定義する開発者向けのガイドラインです。

---

## 1. 開発の基本原則

新規ツールを開発、あるいは既存ツールを改修する際は、以下の原則を厳守してください。

1. **完全クライアントサイド処理の維持**
   - サーバーに対するAPIコール、データ送信、外部通信は原則として行ってはなりません（静的アセットのフェッチ、および `docs/analytics.md` で定義した匿名イベント計測を除く）。
   - 匿名イベント計測では、イベント名と許可済み props 以外を送信してはいけません。処理対象データ、ファイル名、変換結果、個人識別子は送信禁止です。
   - サードパーティ製ライブラリを導入する場合は、内部で外部通信を発生させないこと、または明示的に許可された通信だけであることを必ず確認してください。
2. **日本語ファースト**
   - UI上の文言、ボタン、プレースホルダー、プレビューテキスト、およびエラーメッセージはすべて日本語で記述します。
3. **ロジックとUIの完全分離**
   - ビジネスロジック（データのパース、計算、変換等）は React コンポーネントから切り離し、TypeScriptの純粋関数として実装します。これにより、単体テストを容易にします。

---

## 2. 新規ツールのファイル構成

各ツールは、基本的に以下の **3ファイル**（重量処理がある場合は Web Worker を加えた **4ファイル**）で完結するように設計します。画像・PDFなどUIが大きいツールは、`src/components/[feature]/` のように機能別ディレクトリへ分割できます。

```
src/
├── lib/tools/[name].ts          # 1. 純粋関数のロジック (TypeScript)
├── components/tools/[Name].tsx  # 2. React Island (UI & 状態管理)
└── pages/[name].astro           # 3. Astro ページシェル (レイアウト・メタデータ)
(オプション)
└── workers/[name].worker.ts     # 4. 重量級処理用の Web Worker
```

### 2.1 命名規約
- **ファイル名 (ページ・ロジック):** `kebab-case` （例: `json-formatter.ts`, `json-formatter.astro`）
- **ファイル名 (Reactコンポーネント):** `PascalCase` （例: `JsonFormatter.tsx`）
- **コンポーネント関数名:** `PascalCase` （例: `export function JsonFormatter()`）
- **関数名・変数名:** `camelCase` （例: `formatJson()`, `inputText`）
- **定数名:** `UPPER_SNAKE_CASE` （例: `MAX_INPUT_LENGTH`）

---

## 3. 各レイヤーの実装方法

### 3.1 ロジック層 (`src/lib/tools/[name].ts`)
ビジネスロジックは、DOMやReactに依存しない純粋関数（Pure Function）として実装します。

```typescript
// 例: src/lib/tools/char-count.ts
export interface CharCountResult {
	characters: number;
	lines: number;
	bytes: number;
}

export function countCharacters(text: string): CharCountResult {
	return {
		characters: text.length,
		lines: text.split('\n').length,
		bytes: new TextEncoder().encode(text).length,
	};
}
```

### 3.2 UIコンポーネント層 (`src/components/tools/[Name].tsx`)
Reactを用いてUIとインタラクション（状態管理）を構築します。UIコンポーネントは `@/lib/tools/...` から純粋関数をインポートして呼び出します。
shadcn/ui コンポーネント（`@/components/ui/...`）や Lucide アイコンを利用してください。

```tsx
// 例: src/components/tools/CharCount.tsx
import { useState } from 'react';
import { countCharacters } from '@/lib/tools/char-count';
import { Textarea } from '@/components/ui/textarea';

export function CharCount() {
	const [text, setText] = useState('');
	const result = countCharacters(text);

	return (
		<div className="space-y-4">
			<Textarea 
				value={text} 
				onChange={(e) => setText(e.target.value)} 
				placeholder="ここにテキストを入力してください..." 
			/>
			<div className="grid grid-cols-3 gap-4">
				<div className="p-4 border rounded">文字数: {result.characters}</div>
				<div className="p-4 border rounded">行数: {result.lines}</div>
				<div className="p-4 border rounded">バイト数: {result.bytes}</div>
			</div>
		</div>
	);
}
```

### 3.3 ページシェル層 (`src/pages/[name].astro`)
Astroを用いて静的なWebページを宣言します。SEO用のJSON-LDやメタデータ、SafetyBadge（安全表示）、使い方（使い方スロット）などは、`ToolLayout` を使うことで統一的にレイアウトされます。

Reactコンポーネントを配置する際は、ハイドレーションを行うために **`client:load`** ディレクティブを付与します。関連ツールは `src/lib/tools/catalog.ts` の `related` と `getRelatedTools()`、および `ToolLayout.astro` で自動表示するため、各ページの `usage` スロット内に手書きの「関連ツール」リンクを追加しないでください。

```astro
---
// 例: src/pages/char-count.astro
import BaseLayout from '@/layouts/BaseLayout.astro';
import ToolLayout from '@/components/common/ToolLayout.astro';
import { CharCount } from '@/components/tools/CharCount';
---

<BaseLayout title="文字数カウント" description="リアルタイムで文字数・行数・バイト数をカウントします。">
  <ToolLayout title="文字数カウント" description="テキストの文字数やバイト数をローカル環境で瞬時に計算します。">
    <CharCount client:load />

    <div slot="usage">
      <h3>使い方</h3>
      <p>入力欄にテキストをペーストまたは入力すると、リアルタイムで解析結果が表示されます。</p>
    </div>
  </ToolLayout>
</BaseLayout>
```

---

### 3.4 新規ツール追加チェックリスト

新規ツールを追加する際は、実装完了前に以下を確認してください。

- [ ] `src/lib/tools/[name].ts` に、DOM や React に依存しない純粋関数としてロジックを実装する。
- [ ] `src/components/tools/[Name].tsx`、または UI の規模に応じた機能別ディレクトリに React UI を実装する。
- [ ] `src/pages/[name].astro` を作成し、共通レイアウトとして `ToolLayout` を利用し、React コンポーネントには `client:load` を付与する。
- [ ] `src/lib/tools/catalog.ts` に `id`、`title`、`description`、`href`、`category`、`icon`、`related` を登録する。
- [ ] UI文言、エラーメッセージ、プレースホルダーが日本語であることを確認する。
- [ ] 外部API、許可外トラッキング、ユーザーデータ送信がないことを確認する。匿名イベント計測を追加・変更する場合は `docs/analytics.md` とプライバシーポリシーの整合も確認する。
- [ ] 関連ツールは各ページに手書きせず、`catalog.ts` の `related` と `ToolLayout.astro` に集約する。
- [ ] `npm run lint` を実行し、必要に応じて `npm run build` と `npm test` も実行する。

## 4. デザインシステム & スタイリング

### 4.1 Tailwind CSS v4 の採用
本プロジェクトは **Tailwind CSS v4** を採用しています。スタイリングは `src/styles/global.css` に集約された CSS トークンを利用して構築します。

- **カラー変数:** `var(--primary)`, `var(--accent)`, `var(--safety)`, `var(--background)` などの CSS 変数を使用します。
- **ダークモード:** `.dark` クラスが `html` 要素に付与されることで切り替わります（状態は `localStorage` に保存）。
- **フォントファミリー:**
  - UI文字: `Inter`, `Noto Sans JP`
  - コード/等幅: `JetBrains Mono`

### 4.2 UIコンポーネントの追加
新しいUIコンポーネントが必要な場合は、以下のコマンドを用いて `shadcn/ui` からインストールします。
```bash
npx shadcn@latest add [component-name]
```
インストールされた `src/components/ui/` 配下のファイルは Biome により自動フォーマットされます。**これらの自動生成ファイルを直接手動編集することは避けてください。**

---

## 5. アクセシビリティ方針

ツールのUIは、キーボード操作、スクリーンリーダー、色覚特性の違いに配慮し、主要な操作と結果を誰でも理解できるように実装します。

1. **入力欄のラベル**
   - テキスト入力、テキストエリア、セレクト、ファイル選択などの入力欄には、視覚的なラベルを配置するか、画面上に表示しない場合でも `aria-label` や `aria-labelledby` によるスクリーンリーダー向けのラベルを用意します。
2. **状態メッセージの伝達**
   - エラー、警告、処理完了メッセージは色だけに依存せず、内容が分かるテキストでも伝えます。アイコンや背景色は補助的な表現として扱います。
3. **キーボード操作の保証**
   - ボタン、リンク、ファイル選択、コピー操作などの主要な操作は、Tabキーでフォーカスでき、EnterキーまたはSpaceキーで実行できるようにします。
4. **ARIA属性の適切な利用**
   - 動的に変化する結果表示、処理中・完了・失敗などの状態表示、入力エラーの説明には、必要に応じて `aria-live`、`aria-describedby`、`aria-invalid` を使用します。
5. **アイコンのみのボタン**
   - アイコンのみで意味を表すボタンには、操作内容が分かる `aria-label` を必ず設定します。
6. **コントラストの維持**
   - Tailwind CSS やカスタムCSSで色を指定する場合は、コントラストを損なわないよう `src/styles/global.css` のデザイントークンを優先して利用します。
7. **E2Eでの導線検証**
   - Playwright E2Eでは、主要な入力、実行、コピーの導線がキーボードおよび通常操作で利用できることを検証対象に含めます。

---

## 6. 静的解析とコーディング標準

プロジェクトのコード品質を保つため、**Biome** を採用しています。
- **インデント:** タブ（Tab）を使用。
- **型チェック:** TypeScript `strict` モードを有効化。インポート時はエイリアス `@/` を使用（例: `import { cn } from '@/lib/utils'`）。
- **Linter & Formatter コマンド:**
  ```bash
  npm run lint       # チェックのみ
  npm run lint:fix   # 自動フォーマットと自動修正の適用
  ```

---

## 7. テスト方針 (Playwright E2E)

すべてのツールは、変更適用後に E2E テストを通じて動作検証を行う必要があります。

### 7.1 カスタムフィクスチャの利用
テストは必ず `tests/e2e/fixtures/base.ts` で定義されている `test` フィクスチャを利用して記述します。これにより、不要なアセットのロードや許可外の広告・トラッキングスクリプトを自動的にブロックした状態でテストが実行されます。匿名イベント計測の E2E では、外部送信を発生させずに `window.cloudflare.track()` などをテストダブルへ差し替えて検証してください。

```typescript
// 例: tests/e2e/char-count.spec.ts
import { expect, test } from './fixtures/base';

test('文字数カウントツールが正しく動作すること', async ({ page, createToolPage }) => {
	const toolPage = createToolPage('char-count');
	await toolPage.goto();

	// 共通ヘルパーを用いた検証
	await toolPage.expectSafetyBadge();
	await toolPage.expectTitle('文字数カウント');

	// インタラクションテスト
	await page.fill('textarea', 'Hello World');
	await expect(page.locator('text=文字数: 11')).toBeVisible();
});
```
E2Eテストを実行する前に、必ず本番ビルドを行い、プレビューサーバーを起動してください：
```bash
npm run build
npm run preview
npm test
```
