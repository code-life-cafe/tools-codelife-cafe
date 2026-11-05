import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import CloudLayout, { type CloudSprite, type SpriteOptions } from 'd3-cloud';
import {
	buildFrequencies,
	computeLayout,
	toCsv,
	tokenize,
	validateText,
} from '../../src/lib/tools/wordcloud/index.ts';
import type {
	AnalyzeOptions,
	WordCloudLayoutOptions,
	WordFrequency,
} from '../../src/lib/tools/wordcloud/types.ts';

const layoutOptions: WordCloudLayoutOptions = {
	width: 800,
	height: 450,
	fontFamily: 'Noto Sans JP',
	scale: 'linear',
	rotation: 'none',
	palette: 'tableau10',
};

function frequency(word: string, count: number): WordFrequency {
	return { word, count, pos: 'other' };
}

// NodeにはCanvasがないため、ラスタライズと配置だけを置換する。
// 実際の文字マスク・枠内配置はブラウザのE2Eで検証する。
function mockLayout(t: TestContext) {
	const layouts: CloudLayout[] = [];
	const getSprite = t.mock.method(
		CloudLayout.prototype,
		'getSprite',
		function (this: CloudLayout, text: string, options: SpriteOptions) {
			layouts.push(this);
			return { text, ...options } as CloudSprite;
		},
	);
	const place = t.mock.method(
		CloudLayout.prototype,
		'place',
		(sprite: CloudSprite) => ({ ...sprite, x: -12, y: 0 }),
	);
	return { getSprite, place, layouts };
}

describe('computeLayout', () => {
	it('空入力はCanvasや配置を使わず空配列を返す', async (t) => {
		const { getSprite, place } = mockLayout(t);
		assert.deepEqual(await computeLayout([], layoutOptions), []);
		assert.equal(getSprite.mock.callCount(), 0);
		assert.equal(place.mock.callCount(), 0);
	});

	for (const scale of ['linear', 'sqrt', 'log'] as const) {
		it(`${scale}: 1語でも同頻度でも有限サイズと入力順を保つ`, async (t) => {
			mockLayout(t);
			const opts = { ...layoutOptions, scale };
			assert.deepEqual(await computeLayout([frequency('猫', 2)], opts), [
				{ text: '猫', size: 43, x: -12, y: 0, rotate: 0, color: '#4e79a7' },
			]);
			const placed = await computeLayout(
				[frequency('猫', 2), frequency('犬', 2), frequency('鳥', 2)],
				opts,
			);
			assert.deepEqual(
				placed.map((word) => word.text),
				['猫', '犬', '鳥'],
			);
			assert.deepEqual(
				placed.map((word) => word.size),
				[43, 43, 43],
			);
		});
	}

	it('大きい順で配置し、色と回転はソート前の入力に対応する', async (t) => {
		const { layouts } = mockLayout(t);
		const random = t.mock.method(Math, 'random');
		random.mock.mockImplementationOnce(() => 0.1, 0);
		random.mock.mockImplementationOnce(() => 0.9, 1);
		random.mock.mockImplementationOnce(() => 0.2, 2);
		const placed = await computeLayout(
			[frequency('猫', 1), frequency('犬', 5), frequency('鳥', 3)],
			{ ...layoutOptions, rotation: 'orthogonal' },
		);
		assert.deepEqual(placed, [
			{ text: '犬', size: 72, x: -12, y: 0, rotate: 90, color: '#f28e2c' },
			{ text: '鳥', size: 43, x: -12, y: 0, rotate: 0, color: '#e15759' },
			{ text: '猫', size: 14, x: -12, y: 0, rotate: 0, color: '#4e79a7' },
		]);
		assert.equal(random.mock.callCount(), 3);
		assert.equal(new Set(layouts).size, 1);
	});

	it('ランダム回転でもソート前に角度を決める', async (t) => {
		mockLayout(t);
		const random = t.mock.method(Math, 'random');
		for (const [index, value] of [0, 0.2, 0.4, 0.6, 0.8].entries()) {
			random.mock.mockImplementationOnce(() => value, index);
		}
		const placed = await computeLayout(
			['猫', '犬', '鳥', '魚', '馬'].map((word, i) => frequency(word, i + 1)),
			{ ...layoutOptions, rotation: 'random' },
		);
		assert.deepEqual(
			placed.map((word) => word.rotate),
			[60, 30, 0, -30, -60],
		);
	});

	it('指定サイズ・枠内配置・固定乱数・描画フォントを引き継ぐ', async (t) => {
		const { getSprite, layouts } = mockLayout(t);
		await computeLayout([frequency('猫', 2)], {
			...layoutOptions,
			width: 640,
			height: 360,
			fontFamily: 'sans-serif',
		});
		assert.deepEqual(layouts[0].size(), [640, 360]);
		assert.equal(layouts[0].overflow(), false);
		assert.equal(layouts[0].random()(), 0.5);
		assert.equal(layouts[0].random()(), 0.5);
		const options = getSprite.mock.calls[0].arguments[1];
		assert.equal(options?.font, 'sans-serif');
		assert.equal(options?.weight, 'bold');
		assert.equal(options?.padding, 4);
	});

	it('入力とオプションを破壊せず、呼び出しごとに配置を作り直す', async (t) => {
		const { getSprite, layouts } = mockLayout(t);
		const words = [frequency('猫', 1), frequency('犬', 3)];
		const original = structuredClone(words);
		for (const word of words) Object.freeze(word);
		Object.freeze(words);
		const opts = Object.freeze({ ...layoutOptions, fontFamily: '' });
		const first = await computeLayout(words, opts);
		assert.deepEqual(await computeLayout(words, opts), first);
		assert.deepEqual(words, original);
		assert.equal(new Set(layouts).size, 2);
		assert.equal(getSprite.mock.calls[0].arguments[1]?.font, 'Noto Sans JP');
	});

	for (const method of ['getSprite', 'place'] as const) {
		it(`${method}が失敗した単語だけを省き、前後の成功語と色を残す`, async (t) => {
			const mocks = mockLayout(t);
			mocks[method].mock.mockImplementationOnce(() => null, 1);
			const placed = await computeLayout(
				[frequency('猫', 3), frequency('犬', 2), frequency('鳥', 1)],
				layoutOptions,
			);
			assert.deepEqual(
				placed.map(({ text, color }) => ({ text, color })),
				[
					{ text: '猫', color: '#4e79a7' },
					{ text: '鳥', color: '#e15759' },
				],
			);
			assert.equal(mocks.getSprite.mock.callCount(), 3);
			assert.equal(
				mocks.place.mock.callCount(),
				method === 'getSprite' ? 2 : 3,
			);
		});

		it(`${method}が全語で失敗したら空配列を返す`, async (t) => {
			const mocks = mockLayout(t);
			mocks[method].mock.mockImplementation(() => null);
			assert.deepEqual(
				await computeLayout(
					[frequency('猫', 2), frequency('犬', 1)],
					layoutOptions,
				),
				[],
			);
		});

		it(`${method}の例外はPromiseのrejectとして伝わる`, async (t) => {
			const mocks = mockLayout(t);
			const error = new Error('描画処理に失敗');
			mocks[method].mock.mockImplementation(() => {
				throw error;
			});
			const result = computeLayout([frequency('猫', 2)], layoutOptions);
			assert.ok(result instanceof Promise);
			await assert.rejects(result, (actual) => actual === error);
		});
	}

	it('不正サイズの例外もPromiseのrejectとして伝わる', async () => {
		await assert.rejects(
			computeLayout([frequency('猫', 2)], {
				...layoutOptions,
				width: Number.NaN,
			}),
			/size/,
		);
	});
});

describe('Word Cloud Core Logic', () => {
	it('validateText should detect empty text and length limits', () => {
		const emptyRes = validateText('');
		assert.strictEqual(emptyRes.ok, false);
		if (!emptyRes.ok) {
			assert.strictEqual(emptyRes.reason, 'empty');
		}

		const validRes = validateText('吾輩は猫である。');
		assert.strictEqual(validRes.ok, true);

		const longText = 'あ'.repeat(500_001);
		const largeRes = validateText(longText);
		assert.strictEqual(largeRes.ok, false);
		if (!largeRes.ok) {
			assert.strictEqual(largeRes.reason, 'too-large');
		}
	});

	it('tokenize and buildFrequencies should process Japanese text', async () => {
		const text =
			'吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。';
		const tokens = await tokenize(text, 'tiny-segmenter');
		assert.ok(tokens.length > 0);

		const defaultOpts: AnalyzeOptions = {
			analyzer: 'tiny-segmenter',
			posFilter: ['noun', 'proper-noun', 'adjective'],
			useBaseForm: true,
			useStopwords: true,
			customStopwords: [],
			minCount: 1,
			maxWords: 10,
		};

		const freqs = buildFrequencies(tokens, defaultOpts);
		assert.ok(freqs.length > 0);
		assert.ok(freqs.some((f) => f.word === '猫'));
	});

	it('toCsv should format frequencies to UTF-8 BOM CSV', () => {
		const freqs = [
			{ word: '猫', pos: 'other' as const, count: 5 },
			{ word: '吾輩,"テスト"', pos: 'other' as const, count: 3 },
		];
		const csv = toCsv(freqs);
		assert.ok(csv.startsWith('\uFEFF'));
		assert.ok(csv.includes('順位,単語,品詞,出現回数'));
		assert.ok(csv.includes('1,猫,その他,5'));
		assert.ok(csv.includes('2,"吾輩,""テスト""",その他,3'));
	});

	it('toSvg should generate valid SVG text', async () => {
		const { toSvg } = await import('../../src/lib/tools/wordcloud/index.ts');
		const placed = [
			{ text: '猫', size: 40, x: 0, y: 0, rotate: 0, color: '#ff0000' },
			{ text: '吾輩', size: 20, x: 10, y: 20, rotate: 90, color: '#00ff00' },
		];
		const opts = {
			width: 500,
			height: 300,
			fontFamily: 'Noto Sans JP',
			scale: 'linear' as const,
			rotation: 'none' as const,
			palette: 'tableau10',
		};
		const svg = toSvg(placed, opts);
		assert.ok(svg.includes('<svg'));
		assert.ok(svg.includes('width="500"'));
		assert.ok(svg.includes('猫'));
		assert.ok(svg.includes('#ff0000'));
	});
});
