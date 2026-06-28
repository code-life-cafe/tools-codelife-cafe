import { parseNumber } from './table-query.ts';

export type ChartType = 'bar' | 'hbar' | 'line' | 'pie' | 'scatter';
export type Aggregation = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max';

export type ChartSpec = {
	type: ChartType;
	categoryColumn?: string;
	valueColumns: string[];
	aggregation: Aggregation;
	xColumn?: string;
	yColumn?: string;
};

export type Column = {
	id: string;
	name: string;
	type?: 'text' | 'number' | 'date' | 'boolean';
};

const PALETTE_LIGHT = [
	'#2563eb', // blue
	'#059669', // emerald
	'#d97706', // amber
	'#dc2626', // red
	'#7c3aed', // violet
	'#db2777', // pink
	'#0891b2', // cyan
];

const PALETTE_DARK = [
	'#60a5fa', // blue
	'#34d399', // emerald
	'#fbbf24', // amber
	'#f87171', // red
	'#a78bfa', // violet
	'#f472b6', // pink
	'#22d3ee', // cyan
];

export function escapeXml(str: string | number | undefined): string {
	if (str === undefined || str === null) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export function validateChartSpec(spec: ChartSpec): string | null {
	if (spec.type === 'scatter') {
		if (!spec.xColumn || !spec.yColumn) {
			return '散布図にはX軸列とY軸列の両方の指定が必要です。';
		}
		return null;
	}

	if (!spec.categoryColumn) {
		return '棒グラフ・折れ線グラフ・円グラフにはカテゴリ列の指定が必要です。';
	}

	if (spec.type === 'pie') {
		if (spec.valueColumns.length !== 1) {
			return '円グラフで指定できる値列は1つのみです。';
		}
	} else if (spec.valueColumns.length === 0) {
		return '値軸の列を1つ以上指定してください。';
	}

	return null;
}

type AggregatedItem = {
	category: string;
	values: number[];
};

export function buildChartSvg(
	rows: string[][],
	columns: Column[],
	spec: ChartSpec,
	opts: { dark: boolean; width: number; height: number },
): string {
	const validationErr = validateChartSpec(spec);
	if (validationErr) {
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"><text x="20" y="40" fill="red">${escapeXml(validationErr)}</text></svg>`;
	}

	const palette = opts.dark ? PALETTE_DARK : PALETTE_LIGHT;
	const textColor = opts.dark ? '#f8fafc' : '#0f172a';
	const subTextColor = opts.dark ? '#94a3b8' : '#64748b';
	const gridColor = opts.dark ? '#334155' : '#e2e8f0';

	const colMap = new Map<string, { idx: number; name: string }>();
	columns.forEach((col, idx) => {
		colMap.set(col.id, { idx, name: col.name });
	});

	// 散布図の場合
	if (spec.type === 'scatter') {
		if (!spec.xColumn || !spec.yColumn) {
			return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`;
		}
		const xInfo = colMap.get(spec.xColumn);
		const yInfo = colMap.get(spec.yColumn);
		if (!xInfo || !yInfo)
			return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`;

		const points: { x: number; y: number }[] = [];
		for (const r of rows) {
			const xVal = parseNumber(r[xInfo.idx]);
			const yVal = parseNumber(r[yInfo.idx]);
			if (xVal !== null && yVal !== null) {
				points.push({ x: xVal, y: yVal });
			}
		}

		let warningMsg = '';
		let activePoints = points;
		if (points.length > 500) {
			activePoints = points.slice(0, 500);
			warningMsg = 'データ点数が多いため、先頭500点のみ表示しています。';
		}

		const margin = { top: 40, right: 30, bottom: 50, left: 60 };
		const w = opts.width - margin.left - margin.right;
		const h = opts.height - margin.top - margin.bottom;

		const xMin = Math.min(0, ...activePoints.map((p) => p.x));
		const xMax = Math.max(1, ...activePoints.map((p) => p.x));
		const yMin = Math.min(0, ...activePoints.map((p) => p.y));
		const yMax = Math.max(1, ...activePoints.map((p) => p.y));

		const getX = (v: number) =>
			margin.left + ((v - xMin) / (xMax - xMin || 1)) * w;
		const getY = (v: number) =>
			margin.top + h - ((v - yMin) / (yMax - yMin || 1)) * h;

		const circles = activePoints
			.map(
				(p) =>
					`<circle cx="${getX(p.x)}" cy="${getY(p.y)}" r="4" fill="${palette[0]}" opacity="0.7"/>`,
			)
			.join('');

		return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.width} ${opts.height}" width="${opts.width}" height="${opts.height}">
  <style>text { font-family: sans-serif; font-size: 12px; }</style>
  ${warningMsg ? `<text x="${margin.left}" y="20" fill="${subTextColor}" font-size="11">${escapeXml(warningMsg)}</text>` : ''}
  <!-- Grids -->
  <line x1="${margin.left}" y1="${margin.top + h}" x2="${margin.left + w}" y2="${margin.top + h}" stroke="${gridColor}" stroke-width="1"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + h}" stroke="${gridColor}" stroke-width="1"/>
  <!-- Axis Labels -->
  <text x="${margin.left + w / 2}" y="${opts.height - 10}" fill="${textColor}" text-anchor="middle">${escapeXml(xInfo.name)}</text>
  <text x="15" y="${margin.top + h / 2}" fill="${textColor}" text-anchor="middle" transform="rotate(-90 15 ${margin.top + h / 2})">${escapeXml(yInfo.name)}</text>
  <!-- Points -->
  ${circles}
</svg>`.trim();
	}

	// カテゴリ + 値軸の場合
	if (!spec.categoryColumn) {
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`;
	}
	const catInfo = colMap.get(spec.categoryColumn);
	const valInfos = spec.valueColumns
		.map((id) => colMap.get(id))
		.filter((v): v is { idx: number; name: string } => v !== undefined);
	if (!catInfo || valInfos.length === 0) {
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`;
	}

	// 集計処理
	let items: AggregatedItem[] = [];
	if (spec.aggregation === 'none') {
		items = rows.map((r) => ({
			category: r[catInfo.idx] ?? '',
			values: valInfos.map((v) => parseNumber(r[v.idx]) ?? 0),
		}));
	} else {
		const groups = new Map<
			string,
			{ numbers: number[][]; rawCells: string[][] }
		>();
		for (const r of rows) {
			const cat = r[catInfo.idx] ?? '';
			let g = groups.get(cat);
			if (!g) {
				g = {
					numbers: valInfos.map(() => []),
					rawCells: valInfos.map(() => []),
				};
				groups.set(cat, g);
			}
			valInfos.forEach((v, i) => {
				const cellVal = r[v.idx] ?? '';
				if (cellVal.trim() !== '') g.rawCells[i].push(cellVal);
				const num = parseNumber(cellVal);
				if (num !== null) g.numbers[i].push(num);
			});
		}

		for (const [cat, g] of groups.entries()) {
			const aggValues = valInfos.map((_, i) => {
				const nums = g.numbers[i];
				const raw = g.rawCells[i];
				if (spec.aggregation === 'count') return raw.length;
				if (nums.length === 0) return 0;
				if (spec.aggregation === 'sum') return nums.reduce((a, b) => a + b, 0);
				if (spec.aggregation === 'avg')
					return nums.reduce((a, b) => a + b, 0) / nums.length;
				if (spec.aggregation === 'min') return Math.min(...nums);
				if (spec.aggregation === 'max') return Math.max(...nums);
				return 0;
			});
			items.push({ category: cat, values: aggValues });
		}
	}

	let warningMsg = '';
	if (items.length > 20 && spec.type !== 'line') {
		const top20 = items.slice(0, 20);
		const rest = items.slice(20);
		const otherValues = valInfos.map((_, vIdx) =>
			rest.reduce((sum, item) => sum + (item.values[vIdx] ?? 0), 0),
		);
		top20.push({ category: 'その他', values: otherValues });
		items = top20;
		warningMsg = 'データ点数が多いため、上位20項目のみ表示しています。';
	}

	const margin = { top: 50, right: 30, bottom: 60, left: 60 };
	const w = opts.width - margin.left - margin.right;
	const h = opts.height - margin.top - margin.bottom;

	// 円グラフ (`pie`)
	if (spec.type === 'pie') {
		const radius = Math.min(w, h) / 2 - 10;
		const cx = margin.left + w / 2;
		const cy = margin.top + h / 2;

		const total = items.reduce(
			(sum, item) => sum + Math.max(0, item.values[0] ?? 0),
			0,
		);
		let currentAngle = -Math.PI / 2;

		const slices: string[] = [];
		const legends: string[] = [];

		items.forEach((item, idx) => {
			const val = Math.max(0, item.values[0] ?? 0);
			const sliceAngle = total > 0 ? (val / total) * 2 * Math.PI : 0;
			const endAngle = currentAngle + sliceAngle;

			const x1 = cx + radius * Math.cos(currentAngle);
			const y1 = cy + radius * Math.sin(currentAngle);
			const x2 = cx + radius * Math.cos(endAngle);
			const y2 = cy + radius * Math.sin(endAngle);

			const largeArc = sliceAngle > Math.PI ? 1 : 0;
			const color = palette[idx % palette.length];

			if (total > 0 && val > 0) {
				slices.push(
					`<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="${opts.dark ? '#0f172a' : '#ffffff'}" stroke-width="1.5"/>`,
				);
			}
			legends.push(
				`<g transform="translate(10, ${30 + idx * 18})"><rect width="12" height="12" fill="${color}" rx="2"/><text x="18" y="10" fill="${textColor}" font-size="11">${escapeXml(item.category)}: ${val}</text></g>`,
			);
			currentAngle = endAngle;
		});

		return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.width} ${opts.height}" width="${opts.width}" height="${opts.height}">
  <style>text { font-family: sans-serif; font-size: 12px; }</style>
  ${warningMsg ? `<text x="${margin.left}" y="20" fill="${subTextColor}" font-size="11">${escapeXml(warningMsg)}</text>` : ''}
  ${slices.join('\n')}
  ${legends.join('\n')}
</svg>`.trim();
	}

	// 棒グラフ (`bar`) と 折れ線 (`line`)
	const allValues = items.flatMap((it) => it.values);
	const maxVal = Math.max(1, ...allValues);
	const minVal = Math.min(0, ...allValues);

	const getY = (v: number) =>
		margin.top + h - ((v - minVal) / (maxVal - minVal || 1)) * h;

	const categoryWidth = w / (items.length || 1);

	let contentGraphics = '';
	if (spec.type === 'bar' || spec.type === 'hbar') {
		const seriesCount = valInfos.length;
		const barWidth = Math.max(2, (categoryWidth * 0.7) / seriesCount);

		contentGraphics = items
			.map((item, cIdx) => {
				const groupX =
					margin.left + cIdx * categoryWidth + categoryWidth * 0.15;
				return item.values
					.map((val, sIdx) => {
						const bx = groupX + sIdx * barWidth;
						const by = getY(Math.max(0, val));
						const bh = Math.abs(getY(val) - getY(0));
						const color = palette[sIdx % palette.length];
						return `<rect x="${bx}" y="${by}" width="${barWidth}" height="${bh}" fill="${color}" rx="2"/>`;
					})
					.join('');
			})
			.join('');
	} else if (spec.type === 'line') {
		contentGraphics = valInfos
			.map((_, sIdx) => {
				const pointsStr = items
					.map((item, cIdx) => {
						const px = margin.left + cIdx * categoryWidth + categoryWidth / 2;
						const py = getY(item.values[sIdx] ?? 0);
						return `${px},${py}`;
					})
					.join(' ');
				const color = palette[sIdx % palette.length];
				const circles = items
					.map((item, cIdx) => {
						const px = margin.left + cIdx * categoryWidth + categoryWidth / 2;
						const py = getY(item.values[sIdx] ?? 0);
						return `<circle cx="${px}" cy="${py}" r="3.5" fill="${color}"/>`;
					})
					.join('');
				return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pointsStr}"/>${circles}`;
			})
			.join('');
	}

	// X軸ラベル
	const xLabels = items
		.map((item, cIdx) => {
			const lx = margin.left + cIdx * categoryWidth + categoryWidth / 2;
			const ly = margin.top + h + 20;
			const label =
				item.category.length > 8
					? `${item.category.slice(0, 7)}…`
					: item.category;
			return `<text x="${lx}" y="${ly}" fill="${textColor}" text-anchor="middle">${escapeXml(label)}</text>`;
		})
		.join('');

	// 凡例 (複数系列の場合)
	const legends =
		valInfos.length > 1
			? valInfos
					.map(
						(info, idx) =>
							`<g transform="translate(${margin.left + idx * 100}, 25)"><rect width="12" height="12" fill="${palette[idx % palette.length]}" rx="2"/><text x="18" y="10" fill="${textColor}" font-size="11">${escapeXml(info.name)}</text></g>`,
					)
					.join('')
			: '';

	return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.width} ${opts.height}" width="${opts.width}" height="${opts.height}">
  <style>text { font-family: sans-serif; font-size: 11px; }</style>
  ${warningMsg ? `<text x="${margin.left}" y="15" fill="${subTextColor}" font-size="11">${escapeXml(warningMsg)}</text>` : ''}
  ${legends}
  <!-- Grids -->
  <line x1="${margin.left}" y1="${margin.top + h}" x2="${margin.left + w}" y2="${margin.top + h}" stroke="${gridColor}" stroke-width="1"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + h}" stroke="${gridColor}" stroke-width="1"/>
  <!-- Content -->
  ${contentGraphics}
  <!-- Labels -->
  ${xLabels}
</svg>`.trim();
}
