import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	buildFrequencies,
	toCsv,
	tokenize,
	validateText,
} from '../../src/lib/tools/wordcloud/index.ts';
import type { AnalyzeOptions } from '../../src/lib/tools/wordcloud/types.ts';

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
