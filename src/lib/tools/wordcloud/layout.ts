import cloud from 'd3-cloud';
import { scaleLinear, scaleLog, scaleSqrt } from 'd3-scale';
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

	let scaleFn: ReturnType<typeof scaleLinear>;
	if (scaleType === 'log') {
		scaleFn = scaleLog().domain([Math.max(1, minCount), Math.max(1, maxCount)]);
	} else if (scaleType === 'sqrt') {
		scaleFn = scaleSqrt().domain([minCount, maxCount]);
	} else {
		scaleFn = scaleLinear().domain([minCount, maxCount]);
	}
	scaleFn.range([minSize, maxSize]);

	return (count: number) => Math.round(scaleFn(count));
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

export function computeLayout(
	words: WordFrequency[],
	opts: WordCloudLayoutOptions,
): Promise<PlacedWord[]> {
	return new Promise((resolve) => {
		if (words.length === 0) {
			resolve([]);
			return;
		}

		const counts = words.map((w) => w.count);
		const minCount = Math.min(...counts);
		const maxCount = Math.max(...counts);
		const fontScaler = getScaleFunction(opts.scale, minCount, maxCount);
		const palette = getColorPalette(opts.palette);

		const cloudWords = words.map((w, idx) => ({
			text: w.word,
			size: fontScaler(w.count),
			color: palette[idx % palette.length],
		}));

		const layout = cloud({
			size: [opts.width, opts.height],
			words: cloudWords,
			padding: 4,
			font: opts.fontFamily || 'Noto Sans JP',
			fontSize: (d: { size?: number }) => d.size || 14,
			rotate: () => getRotationAngle(opts.rotation),
			random: () => 0.5, // 確定的な配置シード（必要に応じて）
		});

		layout.on(
			'end',
			(
				outputWords: Array<{
					text?: string;
					size?: number;
					x?: number;
					y?: number;
					rotate?: number;
					color?: string;
				}>,
			) => {
				const placed: PlacedWord[] = outputWords.map((w) => ({
					text: w.text || '',
					size: w.size || 14,
					x: w.x || 0,
					y: w.y || 0,
					rotate: w.rotate || 0,
					color: w.color || '#333333',
				}));
				resolve(placed);
			},
		);

		layout.start();
	});
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
