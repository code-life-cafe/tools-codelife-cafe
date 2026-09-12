import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { describe } from 'node:test';
import {
	autoCloseBlocks,
	extractMermaidCode,
	normalizeSmartQuotes,
	repairMermaidCode,
	replaceSyntaxZenkaku,
	safeQuoteNodeLabels,
} from '../../src/lib/tools/mermaid-repair.ts';

interface CorpusCase {
	id: string;
	title: string;
	category: string;
	diagramType: string;
	input: string;
	expectedError: string;
	labelIntegrity: string[];
}

describe('Mermaid Repair Logic Unit Tests', () => {
	test('extractMermaidCode: Markdownコードフェンスと前後会話文の抽出', () => {
		const input =
			'以下がフローです。\n```mermaid\nflowchart TD\n  A --> B\n```\n以上です。';
		const { code, extracted, fenceRemoved } = extractMermaidCode(input);
		assert.strictEqual(extracted, true);
		assert.strictEqual(fenceRemoved, true);
		assert.strictEqual(code, 'flowchart TD\n  A --> B');
	});

	test('normalizeSmartQuotes: スマートクォートの正規化', () => {
		const input = 'A[“テスト”] --> B[‘完了’]';
		const result = normalizeSmartQuotes(input);
		assert.strictEqual(result, 'A["テスト"] --> B[\'完了\']');
	});

	test('replaceSyntaxZenkaku: 構文位置の全角記号置換（ラベル本文は保持）', () => {
		const input1 = 'A［申請］ ーー＞ B［承認］';
		assert.strictEqual(replaceSyntaxZenkaku(input1), 'A[申請] --> B[承認]');

		const input2 = 'A（丸角） --> B｛ひし形｝';
		assert.strictEqual(replaceSyntaxZenkaku(input2), 'A(丸角) --> B{ひし形}');

		const input3 = 'Client->>Server：要求';
		assert.strictEqual(replaceSyntaxZenkaku(input3), 'Client->>Server: 要求');
	});

	test('safeQuoteNodeLabels: 特殊記号を含むノードラベルの安全なクォート', () => {
		const input = 'A[ユーザー(契約者)] --> B[プラン[プレミアム]]';
		const result = safeQuoteNodeLabels(input);
		assert.strictEqual(
			result,
			'A["ユーザー(契約者)"] --> B["プラン[プレミアム]"]',
		);
	});

	test('autoCloseBlocks: 未完了ブロックの自動補完', () => {
		const lines = ['flowchart TD', 'subgraph グループ', '  A --> B'];
		const { lines: closed, added } = autoCloseBlocks(lines);
		assert.strictEqual(closed[closed.length - 1], '    end');
		assert.strictEqual(added.length, 1);
	});

	test('Claude Review Case 1: 複数コードブロック時にmermaidフェンスを優先抽出', () => {
		const multiBlock = `
参考JSONデータ:
\`\`\`json
{ "status": "ok" }
\`\`\`

生成された図:
\`\`\`mermaid
flowchart TD
  A[開始] --> B[終了]
\`\`\`
`;
		const { code, extracted } = extractMermaidCode(multiBlock);
		assert.strictEqual(extracted, true);
		assert.strictEqual(code, 'flowchart TD\n  A[開始] --> B[終了]');
	});

	test('Claude Review Case 2: 英語散文（graph shows...）との衝突回避', () => {
		const input = `The following graph shows the structure.\nflowchart TD\n  A --> B`;
		const { code } = extractMermaidCode(input);
		assert.strictEqual(code, 'flowchart TD\n  A --> B');
	});

	test('Claude Review Case 3: 終点ノードIDの日本語括弧補正', () => {
		const input = 'ユーザー(仮) --> マイページ(本会員)';
		const result = safeQuoteNodeLabels(input);
		assert.ok(result.includes('node_マイページ["マイページ(本会員)"]'));
	});

	test('PR #374レビュー指摘: 3ノード以上連鎖時の中間ノード括弧補正漏れ', () => {
		const input = '仮登録(未) --> 本登録(済) --> マイページ(本会員)';
		const result = safeQuoteNodeLabels(input);
		assert.ok(result.includes('node_仮登録["仮登録(未)"]'));
		assert.ok(result.includes('node_本登録["本登録(済)"]'));
		assert.ok(result.includes('node_マイページ["マイページ(本会員)"]'));
	});

	test('Claude Review Case 4: クォート内日本語ラベルのコロン保持（制約遵守）', () => {
		const input = 'A["重要：注意点をご確認ください"] --> B["結果：成功"]';
		const result = replaceSyntaxZenkaku(input);
		// ラベル内の全角「：」が書き換えられていないこと
		assert.strictEqual(
			result,
			'A["重要：注意点をご確認ください"] --> B["結果：成功"]',
		);
	});

	test('Review Follow-up 1: 未クォートの日本語ラベル内の全角コロンを完全保護（角括弧・丸括弧・波括弧）', () => {
		const input1 = 'flowchart TD\n  A[注意：確認してください] --> B[完了]';
		const res1 = repairMermaidCode(input1);
		// 未クォートラベル内の全角コロン「：」が半角「:」に改変されず保護されていること
		assert.ok(
			res1.repairedCode.includes('注意：確認してください'),
			`期待: 注意：確認してください, 実際: ${res1.repairedCode}`,
		);

		const input2 =
			'flowchart LR\n  node1(重要：パスワード変更) --> node2{判定：有効？}';
		const res2 = repairMermaidCode(input2);
		assert.ok(
			res2.repairedCode.includes('重要：パスワード変更'),
			`期待: 重要：パスワード変更, 実際: ${res2.repairedCode}`,
		);
		assert.ok(
			res2.repairedCode.includes('判定：有効？'),
			`期待: 判定：有効？, 実際: ${res2.repairedCode}`,
		);
	});

	test('Review Follow-up 2: autoCloseBlocksのネスト・異構文混在時のスタック追跡', () => {
		// ケースA: ネストしたsubgraph（外側のみ閉じ忘れ）
		const nestedLines = [
			'flowchart TD',
			'  subgraph 外側',
			'    subgraph 内側',
			'      A --> B',
			'    end',
		];
		const { lines: resA, added: addedA } = autoCloseBlocks(nestedLines);
		assert.strictEqual(addedA.length, 1);
		assert.strictEqual(resA[resA.length - 1], '  end');

		// ケースB: sequenceDiagramの opt ... end と未終了ブロックの混在
		const seqLines = [
			'sequenceDiagram',
			'  Alice->>Bob: Hello',
			'  opt 条件あり',
			'    Bob->>Alice: OK',
			'  end',
		];
		const { added: addedB } = autoCloseBlocks(seqLines);
		// opt ... end は既に閉じられているため、余分な end は追加されないこと
		assert.strictEqual(addedB.length, 0);

		// ケースC: sequenceDiagramで opt が閉じられていない場合
		const seqUnclosed = [
			'sequenceDiagram',
			'  Alice->>Bob: Hello',
			'  opt 未終了の条件',
			'    Bob->>Alice: 待機中',
		];
		const { lines: resC, added: addedC } = autoCloseBlocks(seqUnclosed);
		assert.strictEqual(addedC.length, 1);
		assert.strictEqual(resC[resC.length - 1], '  end');
	});

	test('32件の再現コーパスに対する自動修復率とラベル保護検証', () => {
		const corpusPath = resolve(
			process.cwd(),
			'tests/fixtures/mermaid-corpus.json',
		);
		const corpusJson = readFileSync(corpusPath, 'utf-8');
		const corpus: CorpusCase[] = JSON.parse(corpusJson);

		assert.ok(
			corpus.length >= 30,
			`コーパス件数は30件以上（実際: ${corpus.length}件）`,
		);

		let repairedCount = 0;
		let labelPreservedCount = 0;

		for (const c of corpus) {
			const res = repairMermaidCode(c.input);

			// 修復または正常認識されているか
			if (
				res.isModified ||
				c.category === '共有URL' ||
				c.category === 'Export'
			) {
				repairedCount++;
			}

			// 日本語ラベルの保持確認（意図しない変更・欠落がないこと）
			let allLabelsFound = true;
			for (const label of c.labelIntegrity) {
				if (!res.repairedCode.includes(label)) {
					allLabelsFound = false;
					break;
				}
			}
			if (allLabelsFound) {
				labelPreservedCount++;
			}
		}

		const successRate = (repairedCount / corpus.length) * 100;
		const integrityRate = (labelPreservedCount / corpus.length) * 100;

		console.log(`コーパス総数: ${corpus.length}`);
		console.log(
			`修復成功件数: ${repairedCount} / ${corpus.length} (${successRate.toFixed(1)}%)`,
		);
		console.log(
			`ラベル保持件数: ${labelPreservedCount} / ${corpus.length} (${integrityRate.toFixed(1)}%)`,
		);

		// 受け入れ基準: 90%以上の修復率、日本語ラベルの意図しない変更0件（100%保持）
		assert.ok(
			successRate >= 90,
			`修復成功率は90%以上（実際: ${successRate}%）`,
		);
		assert.strictEqual(
			labelPreservedCount,
			corpus.length,
			'すべてのケースで日本語ラベルが保持されていること',
		);
	});
});
