import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { describe } from 'node:test';
import {
	autoCloseBlocks,
	extractMermaidCode,
	MAX_REPAIR_INPUT_LENGTH,
	normalizeSmartQuotes,
	protectDashedEdgeLabels,
	protectNodeLabelBodies,
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

test('replaceSyntaxZenkaku: sender/receiver/両側のcentral connectionとUnicode actorを保持する', () => {
	for (const arrow of ['->>', '-->>', '-|/', '/|-']) {
		for (const [sender, receiver] of [
			['Alice()', 'John'],
			['Alice', '()John'],
			['Alice()', '()John'],
			['送信者()', '()受信者'],
		]) {
			const input = `${sender}${arrow}${receiver}: 東京→大阪`;
			assert.equal(replaceSyntaxZenkaku(input), input);
		}
	}
});

test('repairMermaidCode: flowchartのclass指定後の接続子をsequence本文として保護しない', () => {
	assert.equal(
		repairMermaidCode('flowchart LR\nA --> B:::accent → C').repairedCode,
		'flowchart LR\nA --> B:::accent --> C',
	);
	assert.equal(
		repairMermaidCode('sequenceDiagram\nAlice->>Bob::: 東京→大阪').repairedCode,
		'sequenceDiagram\nAlice->>Bob::: 東京→大阪',
	);
});

test('replaceSyntaxZenkaku: asymmetricを含む従来のflowchart全ノード形状を保持する', () => {
	for (const [open, close] of [
		['[', ']'],
		['(', ')'],
		['([', '])'],
		['[[', ']]'],
		['[(', ')]'],
		['((', '))'],
		['>', ']'],
		['{', '}'],
		['{{', '}}'],
		['[/', '/]'],
		['[\\', '\\]'],
		['[/', '\\]'],
		['[\\', '/]'],
		['(((', ')))'],
	]) {
		for (const suffix of [' --> B', ':::accent e1@--> B', '']) {
			const input = `A${open}東京→大阪${close}${suffix}`;
			assert.equal(replaceSyntaxZenkaku(input), input);
		}
	}
});

test('sequence: actor IDの空白・Unicode記号で本文保護を迂回しない', () => {
	assert.equal(
		replaceSyntaxZenkaku('Alice Smith->>Bob Jones: 東京→大阪'),
		'Alice Smith->>Bob Jones: 東京→大阪',
	);
	for (const message of [
		'Alice Smith->>Bob Jones: 東京→大阪',
		'Alice 🦊->>Bob 🐱: 東京→大阪',
		'Alice Smith->>Bob Jones: 東京→大阪; Bob 🐱 → Alice 🦊: 大阪→東京',
	]) {
		const input = `sequenceDiagram\n${message}`;
		assert.equal(
			repairMermaidCode(input).repairedCode,
			input.replace('Bob 🐱 → Alice 🦊:', 'Bob 🐱 --> Alice 🦊:'),
		);
	}
});

// ============================================================
// 回帰: 長いアンダースコア列でのマーカー再走査・巨大RegExp生成
// ============================================================

test('replaceSyntaxZenkaku: 4万個のアンダースコア+文字列リテラルでも例外なく本文を保持する', () => {
	const line = `A${'_'.repeat(40_000)}MERMAID_STR_ --> B["a：b"]`;
	const result = replaceSyntaxZenkaku(line);
	assert.equal(result, line);
	const quoted = `${'_'.repeat(40_000)}MERMAID_STR_ "x：y" → B`;
	assert.equal(replaceSyntaxZenkaku(quoted), quoted.replace('→', '-->'));
});

test('replaceSyntaxZenkaku: 4万アンダースコア+1万個の引用リテラルでも例外なく完了し出力が膨張しない', () => {
	const literals = Array.from({ length: 10_000 }, (_, i) => `"a：${i}"`).join(
		' ',
	);
	const line = `${'_'.repeat(40_000)}MERMAID_STR_ ${literals} → B`;
	const result = replaceSyntaxZenkaku(line);
	assert.equal(result, line.replace('→', '-->'));
	assert.ok(result.length < line.length + 10);
});

test('replaceSyntaxZenkaku: マーカー風テキストと実リテラルが衝突しても復元を取り違えない', () => {
	const nonceFakes = '__MERMAID_STR_0_0__ __MERMAID_STR_1_0__ __MERMAID_STR_2_';
	assert.equal(
		replaceSyntaxZenkaku(`A["本文：1"] --> ${nonceFakes} → "x：y"`),
		`A["本文：1"] --> ${nonceFakes} --> "x：y"`,
	);
	for (const n of [1, 2, 3, 10]) {
		const fake = `${'_'.repeat(n)}MERMAID_STR_0__`;
		const line = `A["本文：1"] --> ${fake} → "x：y"`;
		assert.equal(
			replaceSyntaxZenkaku(line),
			`A["本文：1"] --> ${fake} --> "x：y"`,
		);
	}
});

// ============================================================
// 回帰: エッジラベル保護の単一パス化（未対応の開始 `--` ごとの後続再走査を廃止）
// ============================================================

// 置換前の実装(正規表現)。単一パス版と同じ結果を返すことの基準にする
function referenceProtect(s: string, protect: (l: string) => string): string {
	return s.replace(
		/(?<![-=.>])((?:--|==|-\.)\s+)([^\n]*?)(\s+)(?=(?:-{2,}[>xo]?|={2,}[>xo]?|-?\.+->[xo]?|\.-|→|ー+[>＞]))/g,
		(_m, open, text, space) => `${open}${protect(text)}${space}`,
	);
}

function runProtect(
	fn: typeof referenceProtect,
	s: string,
): { out: string; labels: string[] } {
	const labels: string[] = [];
	const out = fn(s, (l) => {
		labels.push(l);
		return `<${labels.length - 1}>`;
	});
	return { out, labels };
}

test('protectDashedEdgeLabels: 従来の正規表現と同一の結果を返す(決定的ランダム入力)', () => {
	const tokens = [
		'--',
		'==',
		'-.',
		'-->',
		'==>',
		'-.->',
		'.-',
		'→',
		'ーー>',
		'ー＞',
		'---',
		'--x',
		' ',
		'  ',
		'\t',
		'\n',
		'A',
		'x',
		'日本語',
		'.',
		'-',
		'=',
		'>',
		'|',
	];
	let seed = 12345;
	const rand = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed;
	};
	for (let n = 0; n < 4000; n++) {
		let s = '';
		const len = 1 + (rand() % 14);
		for (let k = 0; k < len; k++) s += tokens[rand() % tokens.length];
		assert.deepEqual(
			runProtect(protectDashedEdgeLabels, s),
			runProtect(referenceProtect, s),
			JSON.stringify(s),
		);
	}
});

test('protectDashedEdgeLabels: 対応する終端で本文を保護し、前後の空白を保持する', () => {
	const cases: [string, string, string[]][] = [
		['A --  日本語→文字  --> B', 'A --  <0>  --> B', ['日本語→文字']],
		['A == yes ==> B', 'A == <0> ==> B', ['yes']],
		['A -. maybe -.-> B', 'A -. <0> -.-> B', ['maybe']],
		['A -- x --> B -- y --> C', 'A -- <0> --> B -- <1> --> C', ['x', 'y']],
		['A -- x ==> B', 'A -- <0> ==> B', ['x']],
	];
	for (const [input, expected, labels] of cases) {
		assert.deepEqual(runProtect(protectDashedEdgeLabels, input), {
			out: expected,
			labels,
		});
		assert.deepEqual(runProtect(referenceProtect, input), {
			out: expected,
			labels,
		});
	}
});

test('replaceSyntaxZenkaku/repairMermaidCode: 対応する終端が無い `A -- x` の大量繰り返しでも本文不変', () => {
	for (const count of [40_000, 80_000]) {
		// `-.` は開始にはなるが終端コネクタではないため、どの開始も対応する終端を持たない
		const body = 'A -. x '.repeat(count).trimEnd();
		assert.ok(body.length <= MAX_REPAIR_INPUT_LENGTH * 6);
		const result = runProtect(protectDashedEdgeLabels, body);
		assert.equal(result.out, body);
		assert.deepEqual(result.labels, []);
	}
	const input = `flowchart TD\n${'A -. x '.repeat(14_000).trimEnd()}`;
	assert.ok(input.length <= MAX_REPAIR_INPUT_LENGTH);
	const repaired = repairMermaidCode(input);
	assert.equal(repaired.repairedCode, input);
	assert.equal(repaired.error, undefined);
});

test('repairMermaidCode: flowchartの `A -- x` 40k/80k回の繰り返しでも本文を保持する', () => {
	for (const count of [40_000, 80_000]) {
		const body = 'A -- x '.repeat(count).trimEnd();
		const result = replaceSyntaxZenkaku(body, 'other');
		assert.equal(result, body);
	}
	// repairMermaidCode は100k文字の入力上限内(14,000回)で本文を保持する
	const input = `flowchart TD\n${'A -- x '.repeat(14_000).trimEnd()}`;
	assert.ok(input.length <= MAX_REPAIR_INPUT_LENGTH);
	const repaired = repairMermaidCode(input);
	assert.equal(repaired.error, undefined);
	assert.equal(repaired.repairedCode, input);
	// 上限超過(80k回)は修復せず本文をそのまま返す
	const huge = `flowchart TD\n${'A -- x '.repeat(80_000).trimEnd()}`;
	const rejected = repairMermaidCode(huge);
	assert.equal(rejected.repairedCode, huge);
	assert.match(rejected.error ?? '', /入力が大きすぎる/);
});

test('protectDashedEdgeLabels: `A -- x` の連鎖は隣り合う開始/終端で対にして従来結果と一致する', () => {
	const chain = 'A -- x '.repeat(2_000).trimEnd();
	assert.deepEqual(
		runProtect(protectDashedEdgeLabels, chain),
		runProtect(referenceProtect, chain),
	);
	const mixed = 'A -- x --> B == y ==> C -. z -.-> D .- w → E ';
	assert.deepEqual(
		runProtect(protectDashedEdgeLabels, mixed),
		runProtect(referenceProtect, mixed),
	);
});

// ============================================================
// 回帰: ノード定義ラベル保護の単一パス化（未対応の開き括弧ごとの後続再走査を廃止）
// ============================================================

// 置換前の実装(正規表現)。単一パス版が同じ結果を返すことの仕様参照にする
function referenceNodeLabels(
	s: string,
	protect: (content: string) => string,
): string {
	return s.replace(
		/(\b[A-Za-z0-9_]+|[^\s\->|;:[({]+)(\[{1,2}|\({1,2}|\{{1,2}|\[\([/\\<]|>)([\s\S]*?)(\]{1,2}|\){1,2}|\}{1,2}|[/\\>]\)\])(?=(?::::[\w-]+)?\s*(?:[\w-]+@\s*)?(?:-{2}|-\.|={2}|~{3}|<[-=]|[ox](?:-{2}|={2})|→|ー+[>＞]|&|;|$))/g,
		(_m, id, open, content, close) => `${id}${open}${protect(content)}${close}`,
	);
}

function runNodeLabels(
	fn: typeof referenceNodeLabels,
	s: string,
): { out: string; labels: string[] } {
	const labels: string[] = [];
	const out = fn(s, (c) => {
		labels.push(c);
		return `<${labels.length - 1}>`;
	});
	return { out, labels };
}

test('protectNodeLabelBodies: 従来の正規表現と同一の結果を返す(決定的ランダム入力)', () => {
	const tokens = [
		'A',
		'node1',
		'日本語',
		'_',
		'[',
		'[[',
		'(',
		'((',
		'{',
		'{{',
		'>',
		'[(',
		'[(/',
		']',
		']]',
		')',
		'))',
		'}',
		'}}',
		'/)]',
		'\\)]',
		'>)]',
		'/',
		' ',
		'  ',
		'\n',
		'-->',
		'--',
		'-.',
		'==',
		'~~~',
		'<-',
		'<=',
		'o--',
		'x==',
		'→',
		'ー>',
		'ーー＞',
		'&',
		';',
		':::cls',
		':::c-1',
		':::',
		'id@',
		'e1@',
		'-',
		':',
		'|',
		'ラベル',
		'#',
	];
	let seed = 424242;
	const rand = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed;
	};
	for (let n = 0; n < 6000; n++) {
		let s = '';
		const len = 1 + (rand() % 12);
		for (let k = 0; k < len; k++) s += tokens[rand() % tokens.length];
		assert.deepEqual(
			runNodeLabels(protectNodeLabelBodies, s),
			runNodeLabels(referenceNodeLabels, s),
			JSON.stringify(s),
		);
	}
});

test('protectNodeLabelBodies: 各ノード形状・日本語ラベル・クラス・エッジIDを従来どおり保護する', () => {
	const cases: [string, string, string[]][] = [
		['A[日本語ラベル] --> B', 'A[<0>] --> B', ['日本語ラベル']],
		[
			'A((円：ラベル)) --> B(丸) --> C{判断}',
			'A((<0>)) --> B(<1>) --> C{<2>}',
			['円：ラベル', '丸', '判断'],
		],
		['A>非対称] --> B', 'A>[<0>] --> B', ['非対称']],
		[
			'A[(DB)] --> B[/平行/] --> C[\\逆\\]',
			'A[(<0>)] --> B[/<1>/] --> C[\\<2>\\]',
			['DB', '平行', '逆'],
		],
		['A[ラベル]:::cls e1@--> B', 'A[<0>]:::cls e1@--> B', ['ラベル']],
		['A{{六角形}}  ==> B', 'A{{<0>}}  ==> B', ['六角形']],
	];
	for (const [input, , labels] of cases) {
		const actual = runNodeLabels(protectNodeLabelBodies, input);
		const expected = runNodeLabels(referenceNodeLabels, input);
		assert.deepEqual(actual, expected, input);
		assert.ok(actual.labels.length > 0, input);
		assert.ok(actual.labels.join('').includes(labels[0]), input);
	}
});

test('replaceSyntaxZenkaku/repairMermaidCode: 閉じ括弧の無い A> / A[ / A( を大量に繰り返しても本文不変', () => {
	for (const unit of ['A>', 'A[', 'A(', 'A{', 'A[(']) {
		for (const count of [40_000, 80_000]) {
			const body = unit.repeat(count);
			const result = runNodeLabels(protectNodeLabelBodies, body);
			assert.equal(result.out, body, unit);
			assert.deepEqual(result.labels, [], unit);
			assert.equal(replaceSyntaxZenkaku(body, 'other'), body, unit);
		}
	}
	// 長いID連続(開き括弧なし)でも二乗にならず本文不変
	const longId = 'A'.repeat(80_000);
	assert.equal(replaceSyntaxZenkaku(longId, 'other'), longId);
	assert.equal(
		replaceSyntaxZenkaku('日'.repeat(80_000), 'other'),
		'日'.repeat(80_000),
	);
	// repairMermaidCode は100k文字の入力上限内(80013文字)で本文を保持する
	const input = `flowchart TD\n${'A>'.repeat(40_000)}`;
	assert.ok(input.length <= MAX_REPAIR_INPUT_LENGTH);
	const repaired = repairMermaidCode(input);
	assert.equal(repaired.error, undefined);
	assert.equal(repaired.repairedCode, input);
});

test('protectNodeLabelBodies: 未対応の開き括弧が大量にあっても後方の対応する閉じ括弧を保護する', () => {
	const prefix = 'A>'.repeat(20_000);
	const input = `${prefix} B[日本語：ラベル] --> C`;
	const actual = runNodeLabels(protectNodeLabelBodies, input);
	// 最初の `>` から対応する閉じ括弧まで(日本語ラベル含む)を1つの本文として保護する
	assert.deepEqual(actual, runNodeLabels(referenceNodeLabels, input));
	assert.equal(actual.labels.length, 1);
	assert.ok(actual.labels[0].endsWith('日本語：ラベル'));
});

// ============================================================
// 回帰: safeQuoteNodeLabels の ID[...] / ID(...) 照合の単一パス化
// ============================================================

// 置換前の実装(正規表現)。単一パス版が同じ結果を返すことの仕様参照にする
function referenceSafeQuoteNodeLabels(line: string): string {
	let res = line;
	res = res.replace(
		/(\b[A-Za-z0-9_]+)\[([\s\S]*?)\](?=\s*(?:-->|---|==>|-\.->|--|==|&|;|$))/g,
		(_match, id, content) => {
			const trimmed = content.trim();
			if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
				return `${id}[${content}]`;
			}
			if (/[();/:,\s[\]]/.test(trimmed)) {
				return `${id}["${trimmed.replace(/"/g, "'")}"]`;
			}
			return `${id}[${content}]`;
		},
	);
	res = res.replace(
		/(\b[A-Za-z0-9_]+)\(([\s\S]*?)\)(?=\s*(?:-->|---|==>|-\.->|--|==|&|;|$))/g,
		(_match, id, content) => {
			const trimmed = content.trim();
			if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
				return `${id}(${content})`;
			}
			if (/[();/:,\s]/.test(trimmed)) {
				return `${id}("${trimmed.replace(/"/g, "'")}")`;
			}
			return `${id}(${content})`;
		},
	);
	// 3〜5 は未変更のため、ID[...] / ID(...) を含まない入力でのみ比較に使う
	return res;
}

test('safeQuoteNodeLabels: ID[...] / ID(...) の引用は従来の正規表現と同一(決定的ランダム入力)', () => {
	const tokens = [
		'A',
		'node1',
		'_x',
		'日本語',
		'[',
		']',
		'(',
		')',
		'"',
		"'",
		' ',
		'  ',
		'\n',
		'\t',
		';',
		'/',
		':',
		',',
		'&',
		'-->',
		'---',
		'==>',
		'-.->',
		'--',
		'==',
		'->',
		'ラベル',
		'#',
	];
	let seed = 20260101;
	const rand = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed;
	};
	for (let n = 0; n < 8000; n++) {
		let s = '';
		const len = 1 + (rand() % 12);
		for (let k = 0; k < len; k++) s += tokens[rand() % tokens.length];
		// ルール3〜5の対象外(日本語曜日・ER記号・日本語括弧ID)に当たらない入力のみを比較する
		const expected = referenceSafeQuoteNodeLabels(s);
		const actual = safeQuoteNodeLabels(s);
		if (/[|}{]|\d{4}-\d{2}-\d{2}/.test(s)) continue;
		// ルール5は ASCII/underscore 以外のID + (...) を補正するため、その形を含む入力は除外する
		if (/[^\s\->[({;]*[^\sA-Za-z0-9_\->[({;]\(/.test(s)) continue;
		assert.equal(actual, expected, JSON.stringify(s));
	}
});

test('safeQuoteNodeLabels: 未対応の ID[ / ID( を大量に繰り返しても本文不変で、後方の対応する括弧は引用する', () => {
	for (const unit of ['A[', 'A(', 'A[(']) {
		for (const count of [40_000, 80_000]) {
			const body = unit.repeat(count);
			assert.equal(safeQuoteNodeLabels(body), body, unit);
		}
	}
	const longId = 'A'.repeat(80_000);
	assert.equal(safeQuoteNodeLabels(longId), longId);
	const manyOpeners = `${'A['.repeat(2_000)} B[日本語 ラベル] --> C`;
	assert.equal(
		safeQuoteNodeLabels(manyOpeners),
		referenceSafeQuoteNodeLabels(manyOpeners),
	);
	// 先頭の `A[` が最初の対応する `]` まで1つの本文になる(従来と同じ最左・最短の照合)
	const input = `${'A['.repeat(5)} B[a b] --> C`;
	assert.equal(safeQuoteNodeLabels(input), referenceSafeQuoteNodeLabels(input));
	assert.equal(
		safeQuoteNodeLabels('X[日本語 ラベル] --> Y(a b) --> Z'),
		'X["日本語 ラベル"] --> Y("a b") --> Z',
	);
	// repairMermaidCode は100k文字の入力上限内で本文を保持する
	for (const unit of ['A[', 'A(', 'A[(']) {
		const input = `flowchart TD\n${unit.repeat(Math.floor(80_000 / unit.length))}`;
		assert.ok(input.length <= MAX_REPAIR_INPUT_LENGTH);
		const repaired = repairMermaidCode(input);
		assert.equal(repaired.error, undefined);
		assert.equal(repaired.repairedCode, input, unit);
	}
});

test('repairMermaidCode: 上限超過の入力は修復せずerrorを返す', () => {
	const input = `flowchart TD\n${'A --> B\n'.repeat(15_000)}`;
	assert.ok(input.length > MAX_REPAIR_INPUT_LENGTH);
	const result = repairMermaidCode(input);
	assert.equal(result.isModified, false);
	assert.equal(result.repairedCode, input);
	assert.deepEqual(result.changes, []);
	assert.match(result.error ?? '', /入力が大きすぎる/);
	assert.equal(repairMermaidCode('flowchart TD\nA --> B').error, undefined);
});
