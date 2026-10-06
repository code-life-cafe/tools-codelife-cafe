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

	test('ラベル内の「→」は保持し、構文位置の「→」だけを「-->」に修復する', () => {
		// 未クォートラベル（角括弧・丸括弧・波括弧）内の「→」は変更しない
		for (const input of [
			'A[東京→大阪] --> B[完了]',
			'A(東京→大阪) --> B{はい→いいえ}',
			'A[東京→大阪]-->B[完了]',
		]) {
			assert.strictEqual(replaceSyntaxZenkaku(input), input, input);
		}
		// クォート付きラベル内の「→」も変更しない
		assert.strictEqual(
			replaceSyntaxZenkaku('A["東京→大阪"] --> B[完了]'),
			'A["東京→大阪"] --> B[完了]',
		);
		// 構文位置の「→」は従来どおり修復する
		assert.strictEqual(
			replaceSyntaxZenkaku('A[東京] → B[大阪]'),
			'A[東京] --> B[大阪]',
		);
		assert.strictEqual(
			replaceSyntaxZenkaku('A[東京→大阪] → B[完了→確認]'),
			'A[東京→大阪] --> B[完了→確認]',
		);
		assert.strictEqual(
			replaceSyntaxZenkaku('A[申請]→B[承認]'),
			'A[申請]-->B[承認]',
		);
		// 全角括弧・全角矢印が混在しても、ラベル内の「→」は保持する
		assert.strictEqual(
			replaceSyntaxZenkaku('A［東京→大阪］ ーー＞ B［完了］'),
			'A[東京→大阪] --> B[完了]',
		);
		// ラベルなしのノード間の「→」は修復する
		assert.strictEqual(replaceSyntaxZenkaku('A → B'), 'A --> B');
	});

	test('インラインクラス（:::）付きノードでもラベル内の「→」を保持する', () => {
		for (const input of [
			'A[東京→大阪]:::accent --> B',
			'A(東京→大阪):::accent --> B',
			'A{東京→大阪}:::a-b_1 --> B[完了]:::x',
			'A[東京→大阪]:::accent',
		]) {
			assert.strictEqual(replaceSyntaxZenkaku(input), input, input);
		}
		// クラス付きノードの後ろの構文位置の「→」は従来どおり修復する
		assert.strictEqual(
			replaceSyntaxZenkaku('A[東京→大阪]:::accent → B[完了]:::done'),
			'A[東京→大阪]:::accent --> B[完了]:::done',
		);
		assert.strictEqual(
			replaceSyntaxZenkaku('A[東京]:::accent → B[大阪→京都]'),
			'A[東京]:::accent --> B[大阪→京都]',
		);
	});

	test('どの接続子の前でもラベル内の「→」を保持する', () => {
		for (const connector of [
			'-->',
			'---',
			'-.->',
			'-.-',
			'==>',
			'===',
			'~~~',
			'<-->',
			'--o',
			'--x',
			'o--o',
			'x--x',
			'-- 経由 -->',
			'---|経由|',
		]) {
			for (const input of [
				`A[東京→大阪] ${connector} B`,
				`A[東京→大阪]${connector}B`,
				`A(東京→大阪) ${connector} B{判定→分岐}`,
			]) {
				assert.strictEqual(replaceSyntaxZenkaku(input), input, input);
			}
		}
		// ラベル内の ] や - を含んでも、後続が接続子でなければ閉じ括弧とみなさない
		assert.strictEqual(
			replaceSyntaxZenkaku('A[配列[0]-1→2] --> B'),
			'A[配列[0]-1→2] --> B',
		);
		// 接続子が全角の矢印でも、ラベル内の「→」は保持する
		assert.strictEqual(
			replaceSyntaxZenkaku('A[東京→大阪] ~~~ B[完了] → C'),
			'A[東京→大阪] ~~~ B[完了] --> C',
		);
	});

	test('エッジラベル |...| 内の「→」も保持し、構文位置の「→」だけ修復する', () => {
		for (const input of [
			'A -->|東京→大阪| B',
			'A[x] -->|東京→大阪| B[y]',
			'A ==>|東京→大阪| B',
			'A -.->|東京→大阪| B',
			'A --o|東京→大阪| B',
		]) {
			assert.strictEqual(replaceSyntaxZenkaku(input), input, input);
		}
		assert.strictEqual(
			replaceSyntaxZenkaku('A[東京→大阪] ーー＞|経由→乗換| B → C'),
			'A[東京→大阪] -->|経由→乗換| B --> C',
		);
	});

	test('A -- text --> B 形式のエッジラベル内の「→」も保持する', () => {
		for (const input of [
			'A -- 東京→大阪 --> B',
			'A -- 東京→大阪 --- B',
			'A -- 東京→大阪 --x B',
			'A -- 東京→大阪 --o B',
			'A == 東京→大阪 ==> B',
			'A == 東京→大阪 === B',
			'A -. 東京→大阪 .-> B',
			'A -. 東京→大阪 .- B',
			'A[x] -- 東京→大阪 --> B[y]',
			'A -- 東京→大阪 --> B -- 大阪→京都 --> C',
		]) {
			assert.strictEqual(replaceSyntaxZenkaku(input), input, input);
		}
		// 構文位置の全角矢印（接続子の閉じ側）は従来どおり修復する
		assert.strictEqual(
			replaceSyntaxZenkaku('A -- 経由 → B'),
			'A -- 経由 --> B',
		);
		assert.strictEqual(
			replaceSyntaxZenkaku('A -- 経由→乗換 ーー＞ B'),
			'A -- 経由→乗換 --> B',
		);
		// 通常の矢印・連鎖は変更しない／全角矢印だけ修復する
		assert.strictEqual(replaceSyntaxZenkaku('A --> B --> C'), 'A --> B --> C');
		assert.strictEqual(replaceSyntaxZenkaku('A → B → C'), 'A --> B --> C');
	});

	test('repairMermaidCode: ラベル内の「→」が修復後のコードにそのまま残る', () => {
		const input = 'flowchart TD\n  A[東京→大阪] --> B[完了]';
		const result = repairMermaidCode(input);
		assert.strictEqual(result.repairedCode, input);
		assert.strictEqual(result.isModified, false);
		assert.strictEqual(result.changes.length, 0);

		const mixed = repairMermaidCode('flowchart TD\n  A[東京→大阪] → B[完了]');
		assert.strictEqual(
			mixed.repairedCode,
			'flowchart TD\n  A[東京→大阪] --> B[完了]',
		);
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

test('replaceSyntaxZenkaku: sequenceメッセージとNoteの本文を保持する', () => {
	for (const input of [
		'Alice->>Bob: 東京→大阪',
		'Alice-->>Bob: 東京→大阪',
		'Note over Alice,Bob: 東京→大阪',
	]) {
		assert.equal(replaceSyntaxZenkaku(input), input);
	}
});

test('replaceSyntaxZenkaku: エッジIDと長い点線リンクのラベルを保持する', () => {
	for (const input of [
		'A[東京→大阪] e1@--> B',
		'A[東京→大阪]:::accent e1@--> B',
		'A -. 東京→大阪 -..-> B',
		'A -. 東京→大阪 -...-> B',
	]) {
		assert.equal(replaceSyntaxZenkaku(input), input);
	}
});

test('replaceSyntaxZenkaku: 内部マーカーに似たユーザーIDを変更しない', () => {
	for (const input of [
		'A -- foo --> __MERMAID_EDGE_0__',
		'A[x] --> __MERMAID_LABEL_0__',
		'A["x"] --> __MERMAID_STR_0__',
		'A -- __MERMAID_EDGE_0__ --> B',
	]) {
		assert.equal(replaceSyntaxZenkaku(input), input);
	}
});

test('replaceSyntaxZenkaku: sequenceのactivation・central・cross・circle矢印も本文を保持する', () => {
	for (const arrow of [
		'->>+',
		'-->>-',
		'<<->>',
		'-<<',
		'--<<',
		'-x',
		'--x',
		'-o',
		'--o',
		'-)',
		'--)',
	]) {
		const input = `Alice${arrow}Bob: 東京→大阪`;
		assert.equal(replaceSyntaxZenkaku(input), input);
	}
});

test('replaceSyntaxZenkaku: sequenceのセミコロン後の構文も修復して各本文を保持する', () => {
	assert.equal(
		replaceSyntaxZenkaku('Alice->>Bob: 東京→大阪; Bob → Alice: 大阪→東京'),
		'Alice->>Bob: 東京→大阪; Bob --> Alice: 大阪→東京',
	);
	assert.equal(
		replaceSyntaxZenkaku(
			'Note over Alice,Bob: 東京#59;大阪→京都; Alice → Bob: 京都→東京',
		),
		'Note over Alice,Bob: 東京#59;大阪→京都; Alice --> Bob: 京都→東京',
	);
	assert.equal(
		replaceSyntaxZenkaku('Alice->>Bob: "東京;大阪→京都"; Bob → Alice: 戻る'),
		'Alice->>Bob: "東京;大阪→京都"; Bob --> Alice: 戻る',
	);
});

test('replaceSyntaxZenkaku: Mermaid 11の全half-arrow形式でも本文を保持する', () => {
	for (const arrow of [
		'-|\\',
		'-|/',
		'-\\\\',
		'-//',
		'/|-',
		'\\|-',
		'//-',
		'\\\\-',
		'--|\\',
		'--|/',
		'--\\\\',
		'--//',
		'/|--',
		'\\|--',
		'//--',
		'\\\\--',
	]) {
		for (const activation of ['', '+', '-']) {
			const input = `Alice${arrow}${activation}Bob: 東京→大阪`;
			assert.equal(replaceSyntaxZenkaku(input), input);
		}
	}
});
