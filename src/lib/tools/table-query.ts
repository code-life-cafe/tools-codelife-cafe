export type ColumnType = 'text' | 'number' | 'date' | 'boolean';

export type FilterOperator =
	| 'contains'
	| 'notContains'
	| 'eq'
	| 'neq'
	| 'startsWith'
	| 'endsWith'
	| 'empty'
	| 'notEmpty'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'between'
	| 'before'
	| 'after'
	| 'dateRange';

export type FilterCondition = {
	columnId: string;
	operator: FilterOperator;
	value?: string | number;
	value2?: string | number;
};

export type FilterGroup = {
	combinator: 'and' | 'or';
	conditions: FilterCondition[];
};

export type SortKey = {
	columnId: string;
	direction: 'asc' | 'desc';
};

export type Column = {
	id: string;
	name: string;
	type?: ColumnType;
};

const jaCollator = new Intl.Collator('ja', {
	numeric: true,
	sensitivity: 'base',
});

/**
 * 全角数字を半角数字に変換し、カンマ・通貨記号を شاه 除去して数値化する
 */
export function parseNumber(val: string | number | undefined): number | null {
	if (val === undefined || val === null) return null;
	if (typeof val === 'number') return Number.isNaN(val) ? null : val;
	let str = String(val).trim();
	if (!str) return null;

	// 全角数字 -> 半角数字
	str = str.replace(/[０-９]/g, (ch) =>
		String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
	);
	// 通貨記号・カンマ除去
	str = str.replace(/[¥￥$,]/g, '').trim();

	const num = Number(str);
	return Number.isNaN(num) ? null : num;
}

/**
 * ISO / YYYY/MM/DD などの日付文字列を Date オブジェクトに変換する
 */
export function parseDate(val: string | number | undefined): Date | null {
	if (!val && val !== 0) return null;
	const str = String(val).trim();
	if (!str) return null;

	// YYYY/MM/DD -> YYYY-MM-DD
	const normalized = str.replace(/\//g, '-');
	const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (match) {
		const year = Number(match[1]);
		const month = Number(match[2]) - 1;
		const day = Number(match[3]);
		const d = new Date(year, month, day);
		if (
			d.getFullYear() === year &&
			d.getMonth() === month &&
			d.getDate() === day
		) {
			return d;
		}
	}
	const timestamp = Date.parse(str);
	return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

/**
 * 列の値サンプルから型を推定する
 */
export function inferColumnType(columnValues: string[]): ColumnType {
	const nonEmp = columnValues
		.map((v) => (v ?? '').trim())
		.filter((v) => v !== '');
	if (nonEmp.length === 0) return 'text';

	let numCount = 0;
	let dateCount = 0;
	let boolCount = 0;

	for (const val of nonEmp) {
		if (parseNumber(val) !== null) numCount++;
		if (parseDate(val) !== null) dateCount++;
		const lower = val.toLowerCase();
		if (
			lower === 'true' ||
			lower === 'false' ||
			lower === '1' ||
			lower === '0'
		) {
			boolCount++;
		}
	}

	// 80% 以上が数値
	if (numCount / nonEmp.length >= 0.8) return 'number';
	// 50% 超が日付
	if (dateCount / nonEmp.length > 0.5) return 'date';
	// 50% 超が boolean
	if (boolCount / nonEmp.length > 0.5) return 'boolean';

	return 'text';
}

/**
 * フィルタ条件と値の整合性を検証する（日本語エラーを返す）
 */
export function validateFilterCondition(
	condition: FilterCondition,
): string | null {
	const { operator, value, value2 } = condition;
	if (operator === 'empty' || operator === 'notEmpty') {
		return null;
	}
	if (operator === 'between' || operator === 'dateRange') {
		if (
			value === undefined ||
			value === '' ||
			value2 === undefined ||
			value2 === ''
		) {
			return '範囲指定（between）には開始値と終了値の両方が必要です。';
		}
		return null;
	}
	if (value === undefined || value === '') {
		return '条件の値が必要です。';
	}
	return null;
}

function matchesCondition(
	cellValue: string,
	condition: FilterCondition,
	colType: ColumnType = 'text',
): boolean {
	const { operator, value, value2 } = condition;

	if (operator === 'empty') return cellValue === '' || cellValue === undefined;
	if (operator === 'notEmpty')
		return cellValue !== '' && cellValue !== undefined;

	if (colType === 'number') {
		const cellNum = parseNumber(cellValue);
		const targetNum = parseNumber(value);
		if (cellNum === null || targetNum === null) return false;

		switch (operator) {
			case 'eq':
				return cellNum === targetNum;
			case 'neq':
				return cellNum !== targetNum;
			case 'gt':
				return cellNum > targetNum;
			case 'gte':
				return cellNum >= targetNum;
			case 'lt':
				return cellNum < targetNum;
			case 'lte':
				return cellNum <= targetNum;
			case 'between': {
				const targetNum2 = parseNumber(value2);
				if (targetNum2 === null) return false;
				const min = Math.min(targetNum, targetNum2);
				const max = Math.max(targetNum, targetNum2);
				return cellNum >= min && cellNum <= max;
			}
			default:
				break;
		}
	}

	if (colType === 'date') {
		const cellDate = parseDate(cellValue);
		const targetDate = parseDate(value);
		if (!cellDate || !targetDate) return false;

		const cTime = cellDate.getTime();
		const tTime = targetDate.getTime();

		switch (operator) {
			case 'eq':
				return cTime === tTime;
			case 'neq':
				return cTime !== tTime;
			case 'before':
			case 'lt':
				return cTime < tTime;
			case 'after':
			case 'gt':
				return cTime > tTime;
			case 'gte':
				return cTime >= tTime;
			case 'lte':
				return cTime <= tTime;
			case 'dateRange':
			case 'between': {
				const targetDate2 = parseDate(value2);
				if (!targetDate2) return false;
				const tTime2 = targetDate2.getTime();
				const min = Math.min(tTime, tTime2);
				const max = Math.max(tTime, tTime2);
				return cTime >= min && cTime <= max;
			}
			default:
				break;
		}
	}

	if (colType === 'boolean') {
		const lowerCell = cellValue.trim().toLowerCase();
		const lowerTarget = String(value).trim().toLowerCase();
		const isCellTrue = lowerCell === 'true' || lowerCell === '1';
		const isTargetTrue = lowerTarget === 'true' || lowerTarget === '1';

		if (operator === 'eq') return isCellTrue === isTargetTrue;
		if (operator === 'neq') return isCellTrue !== isTargetTrue;
	}

	// Default: text matching
	const strCell = cellValue ?? '';
	const strTarget = String(value ?? '');

	switch (operator) {
		case 'eq':
			return strCell === strTarget;
		case 'neq':
			return strCell !== strTarget;
		case 'contains':
			return strCell.includes(strTarget);
		case 'notContains':
			return !strCell.includes(strTarget);
		case 'startsWith':
			return strCell.startsWith(strTarget);
		case 'endsWith':
			return strCell.endsWith(strTarget);
		default:
			return true;
	}
}

/**
 * フィルタを適用し、条件を満たす元 row index の配列を返す
 */
export function applyFilter(
	rows: string[][],
	group: FilterGroup,
	columns: Column[],
	inputIndices?: number[],
): number[] {
	const indices = inputIndices ?? rows.map((_, i) => i);
	if (!group.conditions || group.conditions.length === 0) {
		return indices;
	}

	const colMap = new Map<string, { colIdx: number; type: ColumnType }>();
	columns.forEach((col, idx) => {
		colMap.set(col.id, { colIdx: idx, type: col.type ?? 'text' });
	});

	return indices.filter((rIdx) => {
		const row = rows[rIdx];
		if (!row) return false;

		if (group.combinator === 'or') {
			return group.conditions.some((cond) => {
				const target = colMap.get(cond.columnId);
				if (!target) return false;
				const cellValue = row[target.colIdx] ?? '';
				return matchesCondition(cellValue, cond, target.type);
			});
		}

		// 'and' combinator
		return group.conditions.every((cond) => {
			const target = colMap.get(cond.columnId);
			if (!target) return false;
			const cellValue = row[target.colIdx] ?? '';
			return matchesCondition(cellValue, cond, target.type);
		});
	});
}

/**
 * マルチカラム安定ソートを適用し、ソート後の元 row index の配列を返す
 */
export function applySort(
	rows: string[][],
	keys: SortKey[],
	columns: Column[],
	inputIndices?: number[],
): number[] {
	const indices = [...(inputIndices ?? rows.map((_, i) => i))];
	if (!keys || keys.length === 0) {
		return indices;
	}

	const colMap = new Map<string, { colIdx: number; type: ColumnType }>();
	columns.forEach((col, idx) => {
		colMap.set(col.id, { colIdx: idx, type: col.type ?? 'text' });
	});

	indices.sort((idxA, idxB) => {
		const rowA = rows[idxA];
		const rowB = rows[idxB];
		if (!rowA || !rowB) return 0;

		for (const key of keys) {
			const target = colMap.get(key.columnId);
			if (!target) continue;

			const valA = rowA[target.colIdx] ?? '';
			const valB = rowB[target.colIdx] ?? '';

			let cmp = 0;
			if (target.type === 'number') {
				const numA = parseNumber(valA);
				const numB = parseNumber(valB);
				if (numA !== null && numB !== null) {
					cmp = numA - numB;
				} else if (numA !== null) {
					cmp = -1;
				} else if (numB !== null) {
					cmp = 1;
				} else {
					cmp = jaCollator.compare(valA, valB);
				}
			} else if (target.type === 'date') {
				const dateA = parseDate(valA);
				const dateB = parseDate(valB);
				if (dateA && dateB) {
					cmp = dateA.getTime() - dateB.getTime();
				} else if (dateA) {
					cmp = -1;
				} else if (dateB) {
					cmp = 1;
				} else {
					cmp = jaCollator.compare(valA, valB);
				}
			} else {
				cmp = jaCollator.compare(valA, valB);
			}

			if (cmp !== 0) {
				return key.direction === 'asc' ? cmp : -cmp;
			}
		}

		// 全キー同値の場合、元 index 昇順維持
		return idxA - idxB;
	});

	return indices;
}

/**
 * フィルタとソートを統合したクエリパイプライン
 */
export function queryRows(
	rows: string[][],
	columns: Column[],
	options: { filter?: FilterGroup; sortKeys?: SortKey[] },
): number[] {
	let indices = rows.map((_, i) => i);
	if (options.filter) {
		indices = applyFilter(rows, options.filter, columns, indices);
	}
	if (options.sortKeys) {
		indices = applySort(rows, options.sortKeys, columns, indices);
	}
	return indices;
}
