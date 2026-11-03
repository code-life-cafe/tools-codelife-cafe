import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskText } from '../../src/lib/tools/masking.ts';

test('maskText: 全角数字の電話番号およびマイナンバー(12桁)の検出とマスキング', () => {
	const text =
		'電話：０９０-１２３４-５６７８、マイナンバー：１２３４５６７８９０１２';
	const options = {
		targets: new Set(['phone', 'mynumber'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);

	assert.strictEqual(result.counts.phone, 1, '全角電話番号が1件検出されること');
	assert.strictEqual(
		result.counts.mynumber,
		1,
		'全角マイナンバーが1件検出されること',
	);
	assert.ok(
		result.maskedText.includes('０９０-****-５６７８'),
		'電話番号が部分マスクされること',
	);
	assert.ok(
		result.maskedText.includes('************'),
		'マイナンバーがマスクされること',
	);
});

test('maskText: 半角/全角混在および境界値テスト', () => {
	const text = 'マイナンバーは123456789012です。';
	const options = {
		targets: new Set(['mynumber'] as const),
		maskChar: '●' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.mynumber, 1);
	assert.ok(result.maskedText.includes('●●●●●●●●●●●●'));
});

test('maskText: 行頭の氏名ラベル「氏名: 田中太郎」がマスクされる（partial）', () => {
	const text = '氏名: 田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, '氏名ラベルが1件検出されること');
	assert.strictEqual(result.maskedText, '氏名: 田***');
	assert.strictEqual(result.ranges[0].type, 'name');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, text.length);
});

test('maskText: 行頭の氏名ラベル「氏名: 田中太郎」がマスクされる（full）', () => {
	const text = '氏名: 田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '氏名: ****');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, text.length);
});

test('maskText: 全角コロンの氏名ラベル「名前：田中太郎です。」で後続の文章がマスクされない', () => {
	const text = '名前：田中太郎です。よろしくお願いします。';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(
		result.maskedText,
		'名前：田***です。よろしくお願いします。',
	);
});

test('maskText: 日本語文中の姓名「担当は佐藤一郎です」がマスクされる（partial）', () => {
	const text = '担当は佐藤一郎です';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, '文中の姓名が1件検出されること');
	assert.strictEqual(result.maskedText, '担当は佐***です');
	assert.strictEqual(result.ranges[0].start, 3);
	assert.strictEqual(result.ranges[0].end, 7);
});

test('maskText: 文末の姓名「田中太郎」がマスクされる（full）', () => {
	const text = '田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, '文末の姓名が1件検出されること');
	assert.strictEqual(result.maskedText, '****');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, 4);
});

test('maskText: 文末の姓名「田中太郎」がマスクされる（partial）', () => {
	const text = '田中太郎';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '田***');
});

test('maskText: ひらがなの姓名「佐藤さくら」がマスクされる（partial）', () => {
	const text = '佐藤さくら';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, 'ひらがなの名が検出されること');
	assert.strictEqual(result.maskedText, '佐****');
	assert.strictEqual(result.ranges[0].start, 0);
	assert.strictEqual(result.ranges[0].end, text.length);
});

test('maskText: ひらがなの姓名「佐藤さくら」がマスクされる（full）', () => {
	const text = '佐藤さくら';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '*****');
});

test('maskText: カタカナの姓名「田中サクラ」がマスクされる（partial）', () => {
	const text = '田中サクラ';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1, 'カタカナの名が検出されること');
	assert.strictEqual(result.maskedText, '田****');
});

test('maskText: カタカナの姓名「田中サクラ」がマスクされる（full）', () => {
	const text = '田中サクラ';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '*****');
});

test('maskText: 日本語文中のひらがな姓名「担当は佐藤さくらです」で「です」が維持される（partial）', () => {
	const text = '担当は佐藤さくらです';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '担当は佐****です');
	assert.strictEqual(result.ranges[0].start, 3);
	assert.strictEqual(result.ranges[0].end, 8);
});

test('maskText: 日本語文中のひらがな姓名「担当は佐藤さくらです」で「です」が維持される（full）', () => {
	const text = '担当は佐藤さくらです';
	const options = {
		targets: new Set(['name'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.name, 1);
	assert.strictEqual(result.maskedText, '担当は*****です');
});

test('maskText: マイナンバー(12桁)の先頭11桁が電話番号として誤検出されない', () => {
	const text = '012345678901';
	const options = {
		targets: new Set(['phone'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(
		result.counts.phone,
		0,
		'12桁連続数字は電話番号として検出されないこと',
	);
	assert.strictEqual(result.maskedText, text);
});

test('maskText: マイナンバー(12桁)対象ONなら全桁マスクされる', () => {
	const text = '012345678901';
	const options = {
		targets: new Set(['mynumber'] as const),
		maskChar: '*' as const,
		strength: 'full' as const,
	};

	const result = maskText(text, options);
	assert.strictEqual(result.counts.mynumber, 1);
	assert.strictEqual(result.maskedText, '************');
});

test('メールの線形走査: 従来の検出範囲・件数・位置を維持する', () => {
	const samples = [
		'alice@example.com',
		'a+b.c_d-e@sub.example.co.jp',
		'no-at-here',
		'a@b.',
		'@example.com',
		'a@@b.com',
		'a@b.c@d.e',
		'a@b..',
		'日本語alice@example.com、bob@test.jp',
		`${'x'.repeat(300)}@example.com`,
	];
	let seed = 12345;
	const alphabet = 'abcAB12_.+-@ !';
	for (let i = 0; i < 400; i++) {
		let sample = '';
		for (let j = 0; j < 150; j++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			sample += alphabet[seed % alphabet.length];
		}
		samples.push(sample);
	}
	for (const text of samples) {
		const matches = [
			...text.matchAll(/([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g),
		];
		const result = maskText(text, {
			targets: new Set(['email']),
			maskChar: '*',
			strength: 'full',
		});
		assert.equal(
			result.maskedText,
			text.replace(
				/([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g,
				(match) => '*'.repeat(match.length),
			),
		);
		assert.equal(result.counts.email, matches.length);
		assert.deepEqual(
			result.ranges,
			matches.map((match) => ({
				start: match.index,
				end: match.index + match[0].length,
				type: 'email',
			})),
		);
	}
});

const ALL_TARGETS = [
	'email',
	'phone',
	'zipcode',
	'card',
	'mynumber',
	'name',
] as const;

/** 対象集合の全組み合わせ（空集合を除く）。 */
function targetCombinations() {
	const out: Set<(typeof ALL_TARGETS)[number]>[] = [];
	for (let mask = 1; mask < 1 << ALL_TARGETS.length; mask++) {
		out.push(new Set(ALL_TARGETS.filter((_, i) => mask & (1 << i))));
	}
	return out;
}

test('maskText: カード番号を区切りなし・半角/全角ハイフン・空白・全角数字で検出する（partialは末尾4桁のみ残す）', () => {
	const cases: [string, string][] = [
		['4111111111111111', '************1111'],
		['4111-1111-1111-1111', '****-****-****-1111'],
		['4111 1111 1111 1111', '**** **** **** 1111'],
		['４１１１－１１１１－１１１１－１１１１', '****－****－****－１１１１'],
		['４１１１１１１１１１１１１１１１', '************１１１１'],
		['4111　1111　1111　1111', '****　****　****　1111'],
	];
	for (const [input, expected] of cases) {
		const result = maskText(`番号: ${input} です`, {
			targets: new Set(['card'] as const),
			maskChar: '*',
			strength: 'partial',
		});
		assert.strictEqual(result.counts.card, 1, input);
		assert.strictEqual(result.maskedText, `番号: ${expected} です`, input);
	}
});

test('maskText: カード番号のfull伏字では数字が1桁も残らない', () => {
	for (const input of ['4111111111111111', '4111-1111-1111-1111']) {
		const result = maskText(input, {
			targets: new Set(['card'] as const),
			maskChar: '●',
			strength: 'full',
		});
		assert.strictEqual(result.counts.card, 1);
		assert.doesNotMatch(result.maskedText, /[0-9０-９]/);
		assert.strictEqual(result.maskedText.length, input.length);
	}
});

test('maskText: 17桁以上の数字列はカード番号として扱わない', () => {
	const result = maskText('41111111111111111', {
		targets: new Set(['card'] as const),
		maskChar: '*',
		strength: 'partial',
	});
	assert.strictEqual(result.counts.card, 0);
});

test('maskText: どの検出対象の組み合わせでも、マイナンバーとカード番号の保護が単独選択時より弱くならない', () => {
	const text =
		'マイナンバー 101234567890、カード 4111111111111111、電話 090-1234-5678';
	for (const strength of ['partial', 'full'] as const) {
		const alone = {
			mynumber: maskText(text, {
				targets: new Set(['mynumber'] as const),
				maskChar: '*',
				strength,
			}),
			card: maskText(text, {
				targets: new Set(['card'] as const),
				maskChar: '*',
				strength,
			}),
		};
		for (const targets of targetCombinations()) {
			const result = maskText(text, { targets, maskChar: '*', strength });
			const label = `${strength}: ${[...targets].join(',')}`;
			if (targets.has('mynumber')) {
				assert.ok(!result.maskedText.includes('101234567890'), label);
				assert.ok(
					result.maskedText.includes(alone.mynumber.maskedText.slice(7, 19)),
					label,
				);
				assert.strictEqual(result.counts.mynumber, 1, label);
			}
			if (targets.has('card')) {
				assert.ok(!result.maskedText.includes('41111111'), label);
				assert.strictEqual(result.counts.card, 1, label);
			}
			// 件数とハイライト範囲が一致し、範囲は重ならない。
			const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
			assert.strictEqual(result.ranges.length, total, label);
			for (let i = 1; i < result.ranges.length; i++) {
				assert.ok(result.ranges[i - 1].end <= result.ranges[i].start, label);
			}
			// 置換は文字数を保つため、出力長は入力長と一致する。
			assert.strictEqual(result.maskedText.length, text.length, label);
		}
	}
});

test('maskText: 1文字のメールローカル部もpartialで伏せる', () => {
	const options = {
		targets: new Set(['email'] as const),
		maskChar: '*' as const,
		strength: 'partial' as const,
	};
	assert.strictEqual(
		maskText('a@example.com', options).maskedText,
		'*@example.com',
	);
	assert.strictEqual(
		maskText('ab@example.com', options).maskedText,
		'a*@example.com',
	);
	assert.strictEqual(
		maskText('abc@example.com', options).maskedText,
		'a**@example.com',
	);
	assert.strictEqual(
		maskText('a@example.com', { ...options, strength: 'full' }).maskedText,
		'*************',
	);
});
