import CloudLayout from 'd3-cloud';
import {
	type ScaleContinuousNumeric,
	scaleLinear,
	scaleLog,
	scaleSqrt,
} from 'd3-scale';
import * as chromatic from 'd3-scale-chromatic';
import type {
	PlacedWord,
	WordCloudLayoutOptions,
	WordFrequency,
} from './types.ts';

function getScaleFunction(
	scaleType: WordCloudLayoutOptions['scale'],
	minCount: number,
	maxCount: number,
) {
	const minSize = 14;
	const maxSize = 72;

	let scaleFn: ScaleContinuousNumeric<number, number>;
	if (scaleType === 'log') {
		scaleFn = scaleLog().domain([Math.max(1, minCount), Math.max(1, maxCount)]);
	} else if (scaleType === 'sqrt') {
		scaleFn = scaleSqrt().domain([minCount, maxCount]);
	} else {
		scaleFn = scaleLinear().domain([minCount, maxCount]);
	}
	scaleFn.range([minSize, maxSize]);

	return (count: number) => Math.round(Number(scaleFn(count)));
}

function getColorPalette(paletteName: string): readonly string[] {
	const p = paletteName.toLowerCase();
	if (p === 'category10') return chromatic.schemeCategory10;
	if (p === 'dark2') return chromatic.schemeDark2;
	if (p === 'set1') return chromatic.schemeSet1;
	if (p === 'set2') return chromatic.schemeSet2;
	if (p === 'accent') return chromatic.schemeAccent;
	if (p === 'paired') return chromatic.schemePaired;
	return chromatic.schemeTableau10;
}

function getRotationAngle(
	rotationType: WordCloudLayoutOptions['rotation'],
): number {
	if (rotationType === 'none') return 0;
	if (rotationType === 'orthogonal') {
		return Math.random() < 0.5 ? 0 : 90;
	}
	// random
	const angles = [-60, -30, 0, 30, 60];
	return angles[Math.floor(Math.random() * angles.length)];
}

export async function computeLayout(
	words: WordFrequency[],
	opts: WordCloudLayoutOptions,
): Promise<PlacedWord[]> {
	if (words.length === 0) return [];

	const counts = words.map((word) => word.count);
	const fontScaler = getScaleFunction(
		opts.scale,
		Math.min(...counts),
		Math.max(...counts),
	);
	const palette = getColorPalette(opts.palette);
	// 色と回転は元の入力順に決め、配置だけを大きい順にする。
	const prepared = words
		.map((word, index) => ({
			index,
			text: word.word,
			size: fontScaler(word.count),
			rotate: getRotationAngle(opts.rotation),
			color: palette[index % palette.length],
		}))
		.sort((a, b) => b.size - a.size || a.index - b.index);

	const layout = new CloudLayout()
		.size([opts.width, opts.height])
		.overflow(false)
		.random(() => 0.5);

	const placed: PlacedWord[] = [];
	for (const word of prepared) {
		const sprite = layout.getSprite(word.text, {
			datum: word,
			font: opts.fontFamily || 'Noto Sans JP',
			// toSvgの描画と同じ太さで衝突判定する。
			weight: 'bold',
			size: word.size,
			rotate: word.rotate,
			padding: 4,
		});
		if (!sprite) continue;
		const result = layout.place(sprite);
		if (!result) continue;
		placed.push({
			text: result.text,
			size: result.size,
			x: result.x,
			y: result.y,
			rotate: result.rotate,
			color: result.datum.color,
		});
	}
	return placed;
}

export function toSvg(
	placed: PlacedWord[],
	opts: WordCloudLayoutOptions,
): string {
	const halfWidth = opts.width / 2;
	const halfHeight = opts.height / 2;
	const fontFamily = opts.fontFamily || 'Noto Sans JP, sans-serif';

	const textElements = placed
		.map((w) => {
			const transform = `translate(${w.x}, ${w.y}) rotate(${w.rotate})`;
			const escapedText = w.text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');

			return `<text text-anchor="middle" transform="${transform}" font-size="${w.size}px" font-family="${fontFamily}" fill="${w.color}" font-weight="bold">${escapedText}</text>`;
		})
		.join('\n    ');

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">
  <rect width="100%" height="100%" fill="transparent" />
  <g transform="translate(${halfWidth}, ${halfHeight})">
    ${textElements}
  </g>
</svg>`;
}
