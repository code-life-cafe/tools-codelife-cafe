// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/password-generator.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AMBIGUOUS_CHARS,
	buildCharsetPools,
	CHARSETS,
	checkPasswordStrength,
	DEFAULT_PASSWORD_OPTIONS,
	estimateCharsetSize,
	estimateGeneratedEntropy,
	generatePassword,
	generatePasswords,
	joinPasswordsForCopy,
	MAX_COUNT,
	MAX_LENGTH,
	MIN_COUNT,
	MIN_LENGTH,
	type PasswordOptions,
	type RandomSource,
	randomIndex,
	sanitizePasswordSettings,
	strengthLevelFromBits,
	validatePasswordOptions,
} from '../../src/lib/tools/password-generator.ts';

function options(overrides: Partial<PasswordOptions> = {}): PasswordOptions {
	return { ...DEFAULT_PASSWORD_OPTIONS, ...overrides };
}

/** 与えた値を順に返し、尽きたら先頭に戻る乱数源 */
function sequenceSource(values: number[]): RandomSource & { calls: number } {
	let i = 0;
	const source = ((array: Uint32Array) => {
		for (let k = 0; k < array.length; k++) {
			array[k] = values[i % values.length];
			i++;
		}
		source.calls++;
	}) as RandomSource & { calls: number };
	source.calls = 0;
	return source;
}

// --- 文字集合 ---

test('buildCharsetPools: 選んだ文字種だけを既定の順で返す', () => {
	assert.deepEqual(
		buildCharsetPools(
			options({ upper: false, lower: true, digits: true, symbols: false }),
		),
		[CHARSETS.lower, CHARSETS.digits],
	);
	assert.deepEqual(
		buildCharsetPools(
			options({ upper: false, lower: false, digits: false, symbols: false }),
		),
		[],
	);
});

test('buildCharsetPools: 記号はASCIIの記号32文字', () => {
	assert.equal(CHARSETS.symbols.length, 32);
	for (const c of CHARSETS.symbols) {
		assert.match(c, /^[!-/:-@[-`{-~]$/);
	}
});

test('buildCharsetPools: 紛らわしい文字を除外する', () => {
	const pools = buildCharsetPools(options({ excludeAmbiguous: true }));
	const all = pools.join('');
	for (const c of AMBIGUOUS_CHARS) {
		assert.equal(all.includes(c), false, `${c} が残っている`);
	}
	assert.equal(pools[0].length, 26 - 2); // O, I
	assert.equal(pools[1].length, 26 - 2); // o, l
	assert.equal(pools[2].length, 10 - 2); // 0, 1
	assert.equal(pools[3].length, 32 - 1); // |
});

// --- 検証 ---

test('validatePasswordOptions: 長さ・件数の境界', () => {
	assert.equal(validatePasswordOptions(options({ length: MIN_LENGTH })), null);
	assert.equal(validatePasswordOptions(options({ length: MAX_LENGTH })), null);
	assert.match(
		validatePasswordOptions(options({ length: MIN_LENGTH - 1 })) ?? '',
		/長さは4〜128/,
	);
	assert.match(
		validatePasswordOptions(options({ length: MAX_LENGTH + 1 })) ?? '',
		/長さは4〜128/,
	);
	assert.match(
		validatePasswordOptions(options({ length: 12.5 })) ?? '',
		/整数/,
	);
	assert.match(
		validatePasswordOptions(options({ length: Number.NaN })) ?? '',
		/長さ/,
	);
	assert.equal(validatePasswordOptions(options({ count: MIN_COUNT })), null);
	assert.equal(validatePasswordOptions(options({ count: MAX_COUNT })), null);
	assert.match(
		validatePasswordOptions(options({ count: 0 })) ?? '',
		/生成件数は1〜20/,
	);
	assert.match(
		validatePasswordOptions(options({ count: MAX_COUNT + 1 })) ?? '',
		/生成件数/,
	);
});

test('validatePasswordOptions: 文字種が0個ならエラー', () => {
	assert.match(
		validatePasswordOptions(
			options({ upper: false, lower: false, digits: false, symbols: false }),
		) ?? '',
		/1つ以上/,
	);
});

test('validatePasswordOptions: 必須文字種の数より短いとエラー、必須でなければ許可', () => {
	// 4文字種・長さ4はちょうど満たせる
	assert.equal(validatePasswordOptions(options({ length: 4 })), null);
	// 長さの下限は4のため、文字種の数を超えるケースは現れないが、判定式自体を確認する
	assert.equal(
		validatePasswordOptions(options({ length: 4, requireEach: false })),
		null,
	);
});

// --- 乱数 ---

test('randomIndex: 端数の範囲に入った乱数は捨てて引き直す', () => {
	// n=3 のとき limit = floor(2^32/3)*3 = 4294967295。4294967295 は棄却される
	const source = sequenceSource([4294967295, 4294967294, 5]);
	assert.equal(randomIndex(3, source), 4294967294 % 3);
	assert.equal(source.calls, 2);
	assert.equal(randomIndex(3, source), 5 % 3);
});

test('randomIndex: n=1 は常に0、範囲外のnは例外', () => {
	assert.equal(randomIndex(1, sequenceSource([123456])), 0);
	assert.throws(() => randomIndex(0, sequenceSource([0])), RangeError);
	assert.throws(() => randomIndex(1.5, sequenceSource([0])), RangeError);
});

test('randomIndex: 実際の乱数で全ての値が出る（偏りの粗い確認）', () => {
	const counts = new Array(10).fill(0);
	const random: RandomSource = (a) => {
		crypto.getRandomValues(a);
	};
	for (let i = 0; i < 20000; i++) counts[randomIndex(10, random)]++;
	for (const c of counts) {
		// 期待値2000。±20%を超える偏りはまず起きない
		assert.ok(c > 1600 && c < 2400, `偏りが大きい: ${counts.join(',')}`);
	}
});

// --- 生成 ---

test('generatePassword: 乱数の値に対応する文字を選ぶ', () => {
	const digitsOnly = options({
		upper: false,
		lower: false,
		digits: true,
		symbols: false,
		length: 5,
	});
	assert.equal(
		generatePassword(digitsOnly, sequenceSource([0, 1, 2, 3, 9])),
		'01239',
	);
});

test('generatePassword: 必須文字種を満たさない結果は捨てて引き直す', () => {
	// 英小文字＋数字（36文字）。最初の4文字はすべて a（数字なし）→ 棄却、次の4文字で 'a','b','0','1'
	const opts = options({
		upper: false,
		symbols: false,
		length: 4,
		requireEach: true,
	});
	const source = sequenceSource([0, 0, 0, 0, 0, 1, 26, 27]);
	assert.equal(generatePassword(opts, source), 'ab01');
	assert.equal(source.calls, 8);
});

test('generatePassword: requireEach=false なら1文字種だけの結果も返す', () => {
	const opts = options({
		upper: false,
		symbols: false,
		length: 4,
		requireEach: false,
	});
	assert.equal(generatePassword(opts, sequenceSource([0])), 'aaaa');
});

test('generatePassword: 不正な設定は例外', () => {
	assert.throws(() => generatePassword(options({ length: 3 })), /長さ/);
});

test('generatePassword: 実際の乱数で長さ・文字種・除外が守られる', () => {
	for (const length of [MIN_LENGTH, 16, MAX_LENGTH]) {
		for (let i = 0; i < 50; i++) {
			const pw = generatePassword(options({ length, excludeAmbiguous: true }));
			assert.equal(pw.length, length);
			assert.match(pw, /[A-Z]/);
			assert.match(pw, /[a-z]/);
			assert.match(pw, /[0-9]/);
			assert.match(pw, /[!-/:-@[-`{-~]/);
			for (const c of AMBIGUOUS_CHARS) assert.equal(pw.includes(c), false);
		}
	}
});

test('generatePasswords: 件数分を返し、不正な設定はエラーを返す', () => {
	const result = generatePasswords(options({ count: 3 }));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.passwords.length, 3);
		assert.equal(new Set(result.passwords).size, 3);
	}
	const invalid = generatePasswords(
		options({ upper: false, lower: false, digits: false, symbols: false }),
	);
	assert.deepEqual(invalid, {
		ok: false,
		error: '使う文字の種類を1つ以上選んでください。',
	});
});

test('estimateGeneratedEntropy: 長さ×log2(文字集合の大きさ)', () => {
	// 94文字 × 16
	assert.ok(
		Math.abs(estimateGeneratedEntropy(options()) - 16 * Math.log2(94)) < 1e-9,
	);
	// 数字だけ × 4
	assert.ok(
		Math.abs(
			estimateGeneratedEntropy(
				options({ upper: false, lower: false, symbols: false, length: 4 }),
			) -
				4 * Math.log2(10),
		) < 1e-9,
	);
	assert.equal(
		estimateGeneratedEntropy(
			options({ upper: false, lower: false, digits: false, symbols: false }),
		),
		0,
	);
});

// --- 強度チェック ---

test('strengthLevelFromBits: 境界値', () => {
	assert.equal(strengthLevelFromBits(0), 0);
	assert.equal(strengthLevelFromBits(27.99), 0);
	assert.equal(strengthLevelFromBits(28), 1);
	assert.equal(strengthLevelFromBits(35.99), 1);
	assert.equal(strengthLevelFromBits(36), 2);
	assert.equal(strengthLevelFromBits(59.99), 2);
	assert.equal(strengthLevelFromBits(60), 3);
	assert.equal(strengthLevelFromBits(127.99), 3);
	assert.equal(strengthLevelFromBits(128), 4);
});

test('estimateCharsetSize: 含まれる文字種ごとに加算する', () => {
	assert.equal(estimateCharsetSize('abc'), 26);
	assert.equal(estimateCharsetSize('aB'), 52);
	assert.equal(estimateCharsetSize('aB3'), 62);
	assert.equal(estimateCharsetSize('aB3!'), 95);
	assert.equal(estimateCharsetSize(' '), 33);
	assert.equal(estimateCharsetSize('あ'), 100);
	assert.equal(estimateCharsetSize('aあ'), 126);
});

test('checkPasswordStrength: 空文字は null', () => {
	assert.equal(checkPasswordStrength(''), null);
});

test('checkPasswordStrength: エントロピーは文字数（コードポイント）×log2(集合)', () => {
	const result = checkPasswordStrength('Xk9#mQ2$vL7!');
	assert.ok(result);
	assert.equal(result.length, 12);
	assert.equal(result.charsetSize, 95);
	assert.ok(Math.abs(result.bits - 12 * Math.log2(95)) < 1e-9);
	assert.equal(result.level, 3);
	assert.deepEqual(result.warnings, []);
	// 絵文字はサロゲートペアでも1文字として数える
	assert.equal(checkPasswordStrength('😀😀a')?.length, 3);
});

test('checkPasswordStrength: 長いランダム文字列は「とても強い」', () => {
	const result = checkPasswordStrength('t7#Kq!2vZp@9mW$4xR&8nB^3cY*6hJ%1');
	assert.equal(result?.level, 4);
	assert.deepEqual(result?.warnings, []);
});

test('checkPasswordStrength: よく使われるパスワードは大文字小文字を問わず「とても弱い」', () => {
	for (const pw of ['password', 'Password1', 'P@ssw0rd', 'qwerty123']) {
		const result = checkPasswordStrength(pw);
		assert.equal(result?.level, 0, pw);
		assert.ok(result?.warnings.includes('common'), pw);
	}
});

test('checkPasswordStrength: 同じ文字だけなら「とても弱い」', () => {
	const result = checkPasswordStrength('!!!!!!!!!!!!!!!!!!!!');
	assert.equal(result?.level, 0);
	assert.ok(result?.warnings.includes('all-same'));
	assert.equal(result?.warnings.includes('repeat'), false);
	assert.equal(result?.warnings.includes('single-type'), false);
});

test('checkPasswordStrength: 繰り返し・連続・キーボードの並びは1段階下げる', () => {
	// 基準: 警告なしの同じ長さ・同じ文字種
	const base = checkPasswordStrength('Xk9#mQ2$vL7!');
	assert.equal(base?.level, 3);

	const repeat = checkPasswordStrength('Xk9#mQ2$vL7!!!');
	assert.ok(repeat?.warnings.includes('repeat'));
	assert.equal(repeat?.level, 2);

	const sequence = checkPasswordStrength('Xk9#mQ$abcd!');
	assert.ok(sequence?.warnings.includes('sequence'));
	assert.equal(sequence?.level, 2);

	const descending = checkPasswordStrength('Xk#mQ$v9876!');
	assert.ok(descending?.warnings.includes('sequence'));

	const keyboard = checkPasswordStrength('Xk9#mQ2$QWER!');
	assert.ok(keyboard?.warnings.includes('keyboard'));
	assert.equal(keyboard?.level, 2);

	const reversedKeyboard = checkPasswordStrength('Xk9#mQ2$fdsa!');
	assert.ok(reversedKeyboard?.warnings.includes('keyboard'));
});

test('checkPasswordStrength: 3文字の並び・2回の繰り返しは警告しない', () => {
	const result = checkPasswordStrength('Xabc9#mQ2$vL77');
	assert.equal(result?.warnings.includes('sequence'), false);
	assert.equal(result?.warnings.includes('repeat'), false);
});

test('checkPasswordStrength: 8文字未満・1種類だけの文字を警告する', () => {
	const short = checkPasswordStrength('aB3$x');
	assert.ok(short?.warnings.includes('short'));
	const lowerOnly = checkPasswordStrength('kdmqzpwhtrnv');
	assert.ok(lowerOnly?.warnings.includes('single-type'));
	assert.equal(lowerOnly?.warnings.includes('short'), false);
	const eight = checkPasswordStrength('aB3$xQ7!');
	assert.equal(eight?.warnings.includes('short'), false);
});

// --- 設定の復元 ---

test('sanitizePasswordSettings: 正しい値は採用し、範囲外・型違いは既定値に戻す', () => {
	const defaults = DEFAULT_PASSWORD_OPTIONS;
	assert.deepEqual(sanitizePasswordSettings(null, defaults), defaults);
	assert.deepEqual(sanitizePasswordSettings([1], defaults), defaults);
	assert.deepEqual(sanitizePasswordSettings('x', defaults), defaults);
	assert.deepEqual(
		sanitizePasswordSettings(
			{
				length: 32,
				count: 20,
				upper: false,
				lower: true,
				digits: false,
				symbols: true,
				excludeAmbiguous: true,
				requireEach: false,
			},
			defaults,
		),
		{
			length: 32,
			count: 20,
			upper: false,
			lower: true,
			digits: false,
			symbols: true,
			excludeAmbiguous: true,
			requireEach: false,
		},
	);
	const broken = sanitizePasswordSettings(
		{
			length: 129,
			count: '5',
			upper: 'yes',
			excludeAmbiguous: 1,
			extra: 'x',
		},
		defaults,
	);
	assert.deepEqual(broken, defaults);
	assert.equal(sanitizePasswordSettings({ length: 3 }, defaults).length, 16);
	assert.equal(sanitizePasswordSettings({ count: 1.5 }, defaults).count, 5);
});

test('joinPasswordsForCopy: 改行で連結する', () => {
	assert.equal(joinPasswordsForCopy(['a', 'b']), 'a\nb');
	assert.equal(joinPasswordsForCopy([]), '');
});
