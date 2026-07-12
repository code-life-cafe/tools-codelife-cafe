import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildConversionTable,
	buildConversionTableFromWareki,
	calculateAge,
	convertWarekiToResult,
	convertWesternYearToResult,
	ERA_DEFINITIONS,
	formatAgeColumnText,
	formatEraColumnText,
	formatResultForCopy,
	formatTableForCopy,
	getEraCandidates,
	getZodiac,
	isValidDate,
	normalizeWarekiInput,
} from '../../src/lib/tools/wareki-converter.ts';

const REF_DATE = '2026-07-12';

function labelsOf(westernYear: number): string[] {
	return getEraCandidates(westernYear).map((c) => c.label);
}

test('isValidDate: 正常系・うるう年および存在しない日付の判定', () => {
	assert.strictEqual(
		isValidDate(2024, 2, 29),
		true,
		'2024年はうるう年のため2/29は有効',
	);
	assert.strictEqual(
		isValidDate(2023, 2, 29),
		false,
		'2023年は平年のため2/29は無効',
	);
	assert.strictEqual(isValidDate(2023, 2, 31), false, '2/31は無効');
	assert.strictEqual(isValidDate(2023, 13, 1), false, '13月は無効');
});

test('元号開始年・終了年・中間年の換算', () => {
	assert.deepStrictEqual(labelsOf(1927), ['昭和2年']);
	assert.deepStrictEqual(labelsOf(1970), ['昭和45年']);
	assert.deepStrictEqual(labelsOf(2000), ['平成12年']);
});

test('弘化〜慶応: 各元号の元年・最終年・最大元号年超過', () => {
	const cases: Array<{
		eraId: string;
		era: string;
		firstYearWestern: number;
		lastEraYear: number;
		lastYearWestern: number;
	}> = [
		{
			eraId: 'kouka',
			era: '弘化',
			firstYearWestern: 1844,
			lastEraYear: 5,
			lastYearWestern: 1848,
		},
		{
			eraId: 'kaei',
			era: '嘉永',
			firstYearWestern: 1848,
			lastEraYear: 7,
			lastYearWestern: 1854,
		},
		{
			eraId: 'ansei',
			era: '安政',
			firstYearWestern: 1854,
			lastEraYear: 7,
			lastYearWestern: 1860,
		},
		{
			eraId: 'manen',
			era: '万延',
			firstYearWestern: 1860,
			lastEraYear: 2,
			lastYearWestern: 1861,
		},
		{
			eraId: 'bunkyu',
			era: '文久',
			firstYearWestern: 1861,
			lastEraYear: 4,
			lastYearWestern: 1864,
		},
		{
			eraId: 'genji',
			era: '元治',
			firstYearWestern: 1864,
			lastEraYear: 2,
			lastYearWestern: 1865,
		},
		{
			eraId: 'keio',
			era: '慶応',
			firstYearWestern: 1865,
			lastEraYear: 4,
			lastYearWestern: 1868,
		},
	];

	for (const c of cases) {
		const firstResult = convertWarekiToResult(c.eraId, 1, REF_DATE);
		assert.strictEqual(
			firstResult.westernYear,
			c.firstYearWestern,
			`${c.era}元年は${c.firstYearWestern}年`,
		);

		const lastResult = convertWarekiToResult(c.eraId, c.lastEraYear, REF_DATE);
		assert.strictEqual(
			lastResult.westernYear,
			c.lastYearWestern,
			`${c.era}${c.lastEraYear}年は${c.lastYearWestern}年`,
		);

		const overResult = convertWarekiToResult(
			c.eraId,
			c.lastEraYear + 1,
			REF_DATE,
		);
		assert.ok(
			overResult.error,
			`${c.era}${c.lastEraYear + 1}年は範囲外エラーになること`,
		);
	}
});

test('1854年は嘉永7年/安政元年、1855年は安政2年のみ', () => {
	assert.deepStrictEqual(labelsOf(1854), ['嘉永7年', '安政元年']);
	assert.deepStrictEqual(labelsOf(1855), ['安政2年']);
});

test('1848年は弘化5年/嘉永元年、1849年は嘉永2年のみ', () => {
	assert.deepStrictEqual(labelsOf(1848), ['弘化5年', '嘉永元年']);
	assert.deepStrictEqual(labelsOf(1849), ['嘉永2年']);
});

test('万延2年=1861年、文久4年=1864年、元治2年=1865年として受理される', () => {
	assert.strictEqual(
		convertWarekiToResult('manen', 2, REF_DATE).westernYear,
		1861,
	);
	assert.strictEqual(
		convertWarekiToResult('bunkyu', 4, REF_DATE).westernYear,
		1864,
	);
	assert.strictEqual(
		convertWarekiToResult('genji', 2, REF_DATE).westernYear,
		1865,
	);
});

test('1844年で下限境界の注記が生成され、1843年以前は対応元号なしになる', () => {
	const result1844 = convertWesternYearToResult(1844, REF_DATE);
	assert.deepStrictEqual(labelsOf(1844), ['弘化元年']);
	assert.ok(
		result1844.notices.some((n) => n.includes('天保')),
		'1844年には天保併存の注記が含まれること',
	);

	assert.deepStrictEqual(getEraCandidates(1843), [], '1843年は対応元号なし');
	assert.deepStrictEqual(getEraCandidates(1700), [], '1700年は対応元号なし');
});

test('嘉永8年・安政8年・慶応5年は範囲外エラー', () => {
	assert.ok(convertWarekiToResult('kaei', 8, REF_DATE).error);
	assert.ok(convertWarekiToResult('ansei', 8, REF_DATE).error);
	assert.ok(convertWarekiToResult('keio', 5, REF_DATE).error);
});

test('改元年の複数候補がsequence昇順で表示される', () => {
	assert.deepStrictEqual(labelsOf(1860), ['安政7年', '万延元年']);
	assert.deepStrictEqual(labelsOf(1861), ['万延2年', '文久元年']);
	assert.deepStrictEqual(labelsOf(1864), ['文久4年', '元治元年']);
	assert.deepStrictEqual(labelsOf(1865), ['元治2年', '慶応元年']);
	assert.deepStrictEqual(labelsOf(1868), ['慶応4年', '明治元年']);
	assert.deepStrictEqual(labelsOf(1912), ['明治45年', '大正元年']);
	assert.deepStrictEqual(labelsOf(1926), ['大正15年', '昭和元年']);
	assert.deepStrictEqual(labelsOf(1989), ['昭和64年', '平成元年']);
	assert.deepStrictEqual(labelsOf(2019), ['平成31年', '令和元年']);
});

test('入力正規化: 元年、全角数字、漢数字、略記(M/T/S/H/R)、昭45形式', () => {
	assert.deepStrictEqual(normalizeWarekiInput('令和元年'), {
		ok: true,
		eraId: 'reiwa',
		eraYear: 1,
	});
	assert.deepStrictEqual(normalizeWarekiInput('昭和４５年'), {
		ok: true,
		eraId: 'showa',
		eraYear: 45,
	});
	assert.deepStrictEqual(normalizeWarekiInput('昭和四十五年'), {
		ok: true,
		eraId: 'showa',
		eraYear: 45,
	});
	assert.deepStrictEqual(normalizeWarekiInput('昭和四五年'), {
		ok: true,
		eraId: 'showa',
		eraYear: 45,
	});
	assert.deepStrictEqual(normalizeWarekiInput('S45'), {
		ok: true,
		eraId: 'showa',
		eraYear: 45,
	});
	assert.deepStrictEqual(normalizeWarekiInput('昭45'), {
		ok: true,
		eraId: 'showa',
		eraYear: 45,
	});
	assert.deepStrictEqual(normalizeWarekiInput('M45'), {
		ok: true,
		eraId: 'meiji',
		eraYear: 45,
	});
	assert.deepStrictEqual(normalizeWarekiInput('T15'), {
		ok: true,
		eraId: 'taisho',
		eraYear: 15,
	});
	assert.deepStrictEqual(normalizeWarekiInput('H31'), {
		ok: true,
		eraId: 'heisei',
		eraYear: 31,
	});
	assert.deepStrictEqual(normalizeWarekiInput('R6'), {
		ok: true,
		eraId: 'reiwa',
		eraYear: 6,
	});
});

test('旧字体正規化: 慶應3年は1867年、萬延元年は1860年になる', () => {
	const keio = normalizeWarekiInput('慶應3年');
	assert.ok(keio.ok);
	if (keio.ok) {
		assert.strictEqual(
			convertWarekiToResult(keio.eraId, keio.eraYear, REF_DATE).westernYear,
			1867,
		);
	}

	const manen = normalizeWarekiInput('萬延元年');
	assert.ok(manen.ok);
	if (manen.ok) {
		assert.strictEqual(
			convertWarekiToResult(manen.eraId, manen.eraYear, REF_DATE).westernYear,
			1860,
		);
	}
});

test('壱・弐・参・廿は未対応形式として扱われる', () => {
	for (const input of ['昭和壱年', '昭和弐年', '昭和参年', '昭和廿年']) {
		const result = normalizeWarekiInput(input);
		assert.strictEqual(result.ok, false, `${input}は未対応形式`);
	}
});

test('範囲外の元号年、未知の元号、空入力はエラーになる', () => {
	assert.strictEqual(normalizeWarekiInput('').ok, false, '空入力はエラー');
	assert.strictEqual(normalizeWarekiInput('   ').ok, false, '空白のみはエラー');
	assert.strictEqual(
		normalizeWarekiInput('存在しない元号5年').ok,
		false,
		'未知の元号はエラー',
	);
	assert.ok(
		convertWarekiToResult('showa', 100, REF_DATE).error,
		'範囲外の元号年はエラー',
	);
	assert.ok(
		convertWarekiToResult('unknown-era', 1, REF_DATE).error,
		'未知のeraIdはエラー',
	);
});

test('年齢計算: 基準日を固定した場合の年のみ入力の範囲', () => {
	const age = calculateAge(1970, REF_DATE);
	assert.deepStrictEqual(age, {
		kind: 'range',
		min: 55,
		max: 56,
		referenceDate: '2026-07-12',
	});
});

test('年齢計算: 基準日を固定した場合の満年齢（誕生日前後）', () => {
	const beforeBirthday = calculateAge(1970, '2026-07-11', 7, 12);
	assert.strictEqual(beforeBirthday.kind, 'exact');
	if (beforeBirthday.kind === 'exact') {
		assert.strictEqual(beforeBirthday.value, 55, '誕生日前日はまだ55歳');
	}

	const onBirthday = calculateAge(1970, '2026-07-12', 7, 12);
	assert.strictEqual(onBirthday.kind, 'exact');
	if (onBirthday.kind === 'exact') {
		assert.strictEqual(onBirthday.value, 56, '誕生日当日から56歳');
	}
});

test('年齢計算: 実行日ではなく渡された基準日にのみ依存する', () => {
	const resultA = calculateAge(2000, '2020-01-01');
	const resultB = calculateAge(2000, '2020-01-01');
	assert.deepStrictEqual(
		resultA,
		resultB,
		'同一の基準日なら常に同じ結果になること',
	);
});

test('年齢計算: 未来の年はunavailableになる', () => {
	const result = calculateAge(2999, REF_DATE);
	assert.strictEqual(result.kind, 'unavailable');
});

test('1868年（慶応4年/明治元年）の一覧・年齢・注意表示', () => {
	const result = convertWesternYearToResult(1868, REF_DATE);
	assert.deepStrictEqual(
		result.eraCandidates.map((c) => c.label),
		['慶応4年', '明治元年'],
	);
	assert.strictEqual(result.zodiac, '辰');
	assert.deepStrictEqual(result.age, {
		kind: 'range',
		min: 157,
		max: 158,
		referenceDate: '2026-07-12',
	});
	assert.ok(
		result.notices.some((n) =>
			n.includes('旧暦月日を新暦月日に変換した結果ではありません'),
		),
	);
});

test('回帰: 既存の明治・大正・昭和・平成・令和の変換', () => {
	assert.strictEqual(
		convertWarekiToResult('meiji', 1, REF_DATE).westernYear,
		1868,
	);
	assert.strictEqual(
		convertWarekiToResult('taisho', 1, REF_DATE).westernYear,
		1912,
	);
	assert.strictEqual(
		convertWarekiToResult('showa', 1, REF_DATE).westernYear,
		1926,
	);
	assert.strictEqual(
		convertWarekiToResult('heisei', 1, REF_DATE).westernYear,
		1989,
	);
	assert.strictEqual(
		convertWarekiToResult('reiwa', 1, REF_DATE).westernYear,
		2019,
	);
	assert.deepStrictEqual(labelsOf(2000), ['平成12年']);
});

test('回帰: 干支計算', () => {
	assert.strictEqual(getZodiac(2024), '辰');
	assert.strictEqual(getZodiac(2000), '辰');
	assert.strictEqual(getZodiac(1868), '辰');
});

test('コピー結果は一覧表示（同一の結果モデル）と一致する', () => {
	const result = convertWesternYearToResult(1868, REF_DATE);
	assert.strictEqual(formatEraColumnText(result), '慶応4年 / 明治元年');
	const copyText = formatResultForCopy(result);
	assert.strictEqual(
		copyText,
		[
			'和暦: 慶応4年 / 明治元年',
			'西暦: 1868年',
			'干支: 辰年',
			'年齢: 157〜158歳',
			'注意: 年単位の対応候補です。旧暦月日を新暦月日に変換した結果ではありません。',
		].join('\n'),
	);
});

test('対応元号なし（1843年以前）の和暦欄表示', () => {
	const result = convertWesternYearToResult(1700, REF_DATE);
	assert.strictEqual(formatEraColumnText(result), '対応元号なし');
});

test('元号マスタはsequence昇順で12件定義されている', () => {
	assert.strictEqual(ERA_DEFINITIONS.length, 12);
	const sequences = ERA_DEFINITIONS.map((e) => e.sequence);
	assert.deepStrictEqual(
		sequences,
		[...sequences].sort((a, b) => a - b),
	);
});

// --- 回帰: 不存在日付のエラー処理 -----------------------------------------

test('不存在日付: 西暦→和暦で2023年2月31日はエラーになり、結果を返さない', () => {
	const result = convertWesternYearToResult(2023, REF_DATE, 2, 31);
	assert.strictEqual(
		result.error,
		'存在しない日付です。月・日の入力内容を確認してください。',
	);
	assert.deepStrictEqual(result.eraCandidates, []);
});

test('不存在日付: 和暦→西暦で令和5年2月31日はエラーになる', () => {
	const result = convertWarekiToResult('reiwa', 5, REF_DATE, 2, 31);
	assert.strictEqual(
		result.error,
		'存在しない日付です。月・日の入力内容を確認してください。',
	);
});

test('不存在日付: 2024年2月29日は成功、2023年2月29日と4月31日はエラー', () => {
	assert.strictEqual(
		convertWesternYearToResult(2024, REF_DATE, 2, 29).error,
		undefined,
	);
	assert.ok(convertWesternYearToResult(2023, REF_DATE, 2, 29).error);
	assert.ok(convertWesternYearToResult(2023, REF_DATE, 4, 31).error);
});

// --- 回帰: 明治以降の改元日判定 -------------------------------------------

test('改元日判定: 月日付き入力は実際の改元日で元号を1件に確定する', () => {
	const cases: Array<[number, number, number, string]> = [
		[1912, 7, 29, '明治45年'],
		[1912, 7, 30, '大正元年'],
		[1926, 12, 24, '大正15年'],
		[1926, 12, 25, '昭和元年'],
		[1989, 1, 7, '昭和64年'],
		[1989, 1, 8, '平成元年'],
		[2019, 4, 30, '平成31年'],
		[2019, 5, 1, '令和元年'],
	];
	for (const [year, month, day, expectedLabel] of cases) {
		const result = convertWesternYearToResult(year, REF_DATE, month, day);
		assert.deepStrictEqual(
			result.eraCandidates.map((c) => c.label),
			[expectedLabel],
			`${year}-${month}-${day} は ${expectedLabel} に確定すること`,
		);
	}
});

test('和暦→西暦の境界検証: 元号の在位期間外の月日はエラーになる', () => {
	assert.ok(
		convertWarekiToResult('heisei', 1, REF_DATE, 1, 1).error,
		'平成元年1月1日はエラー（実際は昭和64年）',
	);
	assert.strictEqual(
		convertWarekiToResult('heisei', 1, REF_DATE, 1, 8).error,
		undefined,
		'平成元年1月8日は成功',
	);
	assert.ok(
		convertWarekiToResult('reiwa', 1, REF_DATE, 4, 30).error,
		'令和元年4月30日はエラー（実際は平成31年）',
	);
	assert.strictEqual(
		convertWarekiToResult('reiwa', 1, REF_DATE, 5, 1).error,
		undefined,
		'令和元年5月1日は成功',
	);
	assert.strictEqual(
		convertWarekiToResult('showa', 64, REF_DATE, 1, 7).error,
		undefined,
		'昭和64年1月7日は成功',
	);
	assert.ok(
		convertWarekiToResult('showa', 64, REF_DATE, 1, 8).error,
		'昭和64年1月8日はエラー（実際は平成元年）',
	);
});

// --- 回帰: 1872年以前の月日をグレゴリオ暦として扱わない ---------------------

test('1869年・1872年は年単位候補を表示し旧暦注意を含む', () => {
	const r1869 = convertWesternYearToResult(1869, REF_DATE);
	assert.deepStrictEqual(
		r1869.eraCandidates.map((c) => c.label),
		['明治2年'],
	);
	assert.ok(r1869.notices.some((n) => n.includes('旧暦月日を新暦月日')));

	const r1872 = convertWesternYearToResult(1872, REF_DATE);
	assert.deepStrictEqual(
		r1872.eraCandidates.map((c) => c.label),
		['明治5年'],
	);
	assert.ok(r1872.notices.some((n) => n.includes('旧暦月日を新暦月日')));

	const r1868 = convertWesternYearToResult(1868, REF_DATE);
	assert.deepStrictEqual(
		r1868.eraCandidates.map((c) => c.label),
		['慶応4年', '明治元年'],
	);
	assert.ok(r1868.notices.some((n) => n.includes('旧暦月日を新暦月日')));
});

test('1872年以前の月日付き入力は専用エラーになり、1873年は通常処理される', () => {
	const result1872 = convertWesternYearToResult(1872, REF_DATE, 12, 1);
	assert.strictEqual(
		result1872.error,
		'1872年以前の月日は旧暦のため、厳密な日付換算には対応していません。年のみで入力してください。',
	);

	const result1873 = convertWesternYearToResult(1873, REF_DATE, 1, 1);
	assert.strictEqual(result1873.error, undefined);
	assert.deepStrictEqual(
		result1873.eraCandidates.map((c) => c.label),
		['明治6年'],
	);
});

// --- 回帰: 未来の生年月日で負の年齢を返さない -------------------------------

test('年齢計算: 未来の生年月日はunavailableになり、負の年齢を返さない', () => {
	assert.deepStrictEqual(calculateAge(2026, REF_DATE, 7, 11), {
		kind: 'exact',
		value: 0,
		referenceDate: '2026-07-12',
	});
	assert.deepStrictEqual(calculateAge(2026, REF_DATE, 7, 12), {
		kind: 'exact',
		value: 0,
		referenceDate: '2026-07-12',
	});
	assert.strictEqual(calculateAge(2026, REF_DATE, 7, 13).kind, 'unavailable');
	assert.strictEqual(calculateAge(2026, REF_DATE, 12, 31).kind, 'unavailable');
	assert.strictEqual(calculateAge(2027, REF_DATE).kind, 'unavailable');
});

// --- 回帰: 基準日のタイムゾーン非依存 --------------------------------------

test('年齢計算: 基準日はタイムゾーンに関わらず暦日として一貫する', () => {
	// 文字列は正規表現で直接パースするため UTC 解釈に依存しない
	const fromString = calculateAge(1970, '2026-01-01', 1, 1);
	assert.deepStrictEqual(fromString, {
		kind: 'exact',
		value: 56,
		referenceDate: '2026-01-01',
	});

	// Date オブジェクトはローカルの年月日ゲッターで読み取る
	const localDate = new Date(2026, 0, 1); // ローカルタイムで2026-01-01
	const fromDate = calculateAge(1970, localDate, 1, 1);
	assert.deepStrictEqual(fromDate, fromString);
});

// --- 回帰: 月・日の片側指定を禁止 ------------------------------------------

test('月または日だけの指定はエラーになる', () => {
	assert.strictEqual(
		convertWesternYearToResult(2000, REF_DATE, 5, undefined).error,
		'月と日は両方指定してください。',
	);
	assert.strictEqual(
		convertWesternYearToResult(2000, REF_DATE, undefined, 15).error,
		'月と日は両方指定してください。',
	);
	assert.strictEqual(
		convertWarekiToResult('reiwa', 6, REF_DATE, 5, undefined).error,
		'月と日は両方指定してください。',
	);
	assert.strictEqual(
		convertWarekiToResult('reiwa', 6, REF_DATE, undefined, 15).error,
		'月と日は両方指定してください。',
	);
});

// --- 回帰: 西暦入力の整数検証 -----------------------------------------------

test('西暦年は安全な整数のみ受け付ける', () => {
	for (const invalidYear of [
		1990.5,
		-5,
		0,
		Number.NaN,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		const result = convertWesternYearToResult(invalidYear, REF_DATE);
		assert.strictEqual(
			result.error,
			'西暦年は1以上の整数で入力してください。',
			`${invalidYear} は拒否されること`,
		);
		assert.notStrictEqual(result.zodiac, undefined);
	}
	assert.strictEqual(
		getZodiac(1990.5),
		'',
		'小数年の干支はundefinedにならない',
	);
});

test('西暦年が整数であれば干支はundefinedにならない', () => {
	assert.strictEqual(convertWesternYearToResult(2000, REF_DATE).zodiac, '辰');
});

// --- 早見表（複数年テーブル） -----------------------------------------------

test('早見表: 2009年を中心に±5年（計11行）が生成され、基準年の行がisInputYearになる', () => {
	const table = buildConversionTable(2009, REF_DATE, 5);
	assert.strictEqual(table.error, undefined);
	assert.strictEqual(table.rows.length, 11);
	assert.deepStrictEqual(
		table.rows.map((r) => r.westernYear),
		[2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014],
	);
	const inputRows = table.rows.filter((r) => r.isInputYear);
	assert.strictEqual(inputRows.length, 1);
	assert.strictEqual(inputRows[0]?.westernYear, 2009);
});

test('早見表: 表示範囲を変更すると行数が変わる（±3年=7行、±10年=21行）', () => {
	assert.strictEqual(buildConversionTable(2020, REF_DATE, 3).rows.length, 7);
	assert.strictEqual(buildConversionTable(2020, REF_DATE, 10).rows.length, 21);
});

test('早見表: 1868年を含む範囲は慶応4年/明治元年の併記行を含む', () => {
	const table = buildConversionTable(1868, REF_DATE, 3);
	const row1868 = table.rows.find((r) => r.westernYear === 1868);
	assert.ok(row1868);
	assert.strictEqual(formatEraColumnText(row1868.result), '慶応4年 / 明治元年');
});

test('早見表: 2019年を含む範囲は平成31年/令和元年の併記行を含む', () => {
	const table = buildConversionTable(2019, REF_DATE, 3);
	const row2019 = table.rows.find((r) => r.westernYear === 2019);
	assert.ok(row2019);
	assert.strictEqual(
		formatEraColumnText(row2019.result),
		'平成31年 / 令和元年',
	);
});

test('早見表: 1843年以前を含む範囲では和暦欄が「対応元号なし」になり、西暦・干支は表示される', () => {
	const table = buildConversionTable(1844, REF_DATE, 3);
	const row1843 = table.rows.find((r) => r.westernYear === 1843);
	assert.ok(row1843);
	assert.strictEqual(formatEraColumnText(row1843.result), '対応元号なし');
	assert.strictEqual(row1843.result.westernYear, 1843);
	assert.strictEqual(row1843.result.zodiac, getZodiac(1843));
});

test('早見表: 中心年から前が1年未満になる範囲は1年未満の行を含まない', () => {
	const table = buildConversionTable(3, REF_DATE, 5);
	assert.ok(table.rows.every((r) => r.westernYear >= 1));
	assert.strictEqual(table.rows[0]?.westernYear, 1);
});

test('早見表: 誕生日を指定すると基準年の行のみ満年齢になり、他の行は範囲のまま', () => {
	const table = buildConversionTable(1970, REF_DATE, 2, 7, 12);
	const inputRow = table.rows.find((r) => r.isInputYear);
	assert.ok(inputRow);
	assert.strictEqual(inputRow.result.age.kind, 'exact');

	const otherRows = table.rows.filter((r) => !r.isInputYear);
	assert.ok(otherRows.length > 0);
	for (const row of otherRows) {
		assert.strictEqual(row.result.age.kind, 'range');
	}
});

test('早見表: 誕生日未指定では全行が範囲年齢になる', () => {
	const table = buildConversionTable(1970, REF_DATE, 2);
	for (const row of table.rows) {
		assert.strictEqual(row.result.age.kind, 'range');
	}
});

test('早見表: 西暦0年など無効な中心年はエラーになりrowsが空になる', () => {
	const table = buildConversionTable(0, REF_DATE, 5);
	assert.ok(table.error);
	assert.deepStrictEqual(table.rows, []);
});

test('早見表: 和暦からのテーブル生成（buildConversionTableFromWareki）', () => {
	const table = buildConversionTableFromWareki('reiwa', 1, REF_DATE, 3);
	assert.strictEqual(table.error, undefined);
	assert.strictEqual(table.centerWesternYear, 2019);
	const inputRow = table.rows.find((r) => r.isInputYear);
	assert.strictEqual(inputRow?.westernYear, 2019);
});

test('早見表: 和暦の範囲外元号年はエラーになりrowsが空になる', () => {
	const table = buildConversionTableFromWareki('showa', 100, REF_DATE, 5);
	assert.ok(table.error);
	assert.deepStrictEqual(table.rows, []);
});

test('早見表のコピー結果はTSVヘッダー・基準年マーカー・注意事項を含み表示内容と一致する', () => {
	const table = buildConversionTable(1868, REF_DATE, 1);
	const copyText = formatTableForCopy(table);
	const lines = copyText.split('\n');

	assert.strictEqual(lines[0], '和暦\t西暦\t干支\t年齢');
	const row1867 = table.rows.find((r) => r.westernYear === 1867);
	assert.ok(row1867);
	assert.strictEqual(
		lines[1],
		`慶応3年\t1867年\t${getZodiac(1867)}年\t${formatAgeColumnText(row1867.result)}`,
	);
	assert.ok(
		lines.includes('慶応4年 / 明治元年\t1868年（基準年）\t辰年\t157〜158歳'),
	);
	assert.ok(
		lines.includes(
			'注意: 年単位の対応候補です。旧暦月日を新暦月日に変換した結果ではありません。',
		),
	);

	for (const row of table.rows) {
		const expectedCols = [
			formatEraColumnText(row.result),
			`${row.westernYear}年${row.isInputYear ? '（基準年）' : ''}`,
			`${row.result.zodiac}年`,
		];
		const matchingLine = lines.find((line) =>
			expectedCols.every((col) => line.includes(col)),
		);
		assert.ok(
			matchingLine,
			`${row.westernYear}年の行がコピー結果に含まれること`,
		);
	}
});
