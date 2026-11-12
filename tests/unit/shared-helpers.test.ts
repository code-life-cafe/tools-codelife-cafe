import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { yieldToEventLoop } from '../../src/lib/async.ts';
import { formatBytes } from '../../src/lib/format-bytes.ts';
import { toHex } from '../../src/lib/hex.ts';
import { clamp } from '../../src/lib/math.ts';
import {
	buildTxtBlob,
	countCharacters,
	normalizeNewlines,
} from '../../src/lib/text-output.ts';

describe('formatBytes', () => {
	it('1024未満はB、1MiB未満は小数1桁のKB、それ以上は小数2桁のMB', () => {
		assert.equal(formatBytes(0), '0 B');
		assert.equal(formatBytes(1023), '1023 B');
		assert.equal(formatBytes(1024), '1.0 KB');
		assert.equal(formatBytes(1536), '1.5 KB');
		assert.equal(formatBytes(1024 * 1024 - 1), '1024.0 KB');
		assert.equal(formatBytes(1024 * 1024), '1.00 MB');
		assert.equal(formatBytes(2621440), '2.50 MB');
		assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3072.00 MB');
	});
});

describe('clamp', () => {
	it('範囲内はそのまま、範囲外は端に丸める', () => {
		assert.equal(clamp(5, 0, 10), 5);
		assert.equal(clamp(-1, 0, 10), 0);
		assert.equal(clamp(11, 0, 10), 10);
		assert.equal(clamp(0, 0, 10), 0);
		assert.equal(clamp(10, 0, 10), 10);
	});

	it('NaNはNaNのまま返す', () => {
		assert.ok(Number.isNaN(clamp(Number.NaN, 0, 10)));
	});

	it('min > max のときは max を返す（集約前の各実装と同じ）', () => {
		assert.equal(clamp(5, 10, 0), 0);
		assert.equal(clamp(-5, 10, 0), 0);
		assert.equal(clamp(50, 10, 0), 0);
	});
});

describe('toHex', () => {
	it('小文字・ゼロ埋め2桁で連結する', () => {
		assert.equal(toHex(new Uint8Array([])), '');
		assert.equal(toHex(new Uint8Array([0, 1, 15, 16, 255])), '00010f10ff');
	});
});

describe('yieldToEventLoop', () => {
	it('先に予約済みのタイマーが実行されてから解決する', async () => {
		const order: string[] = [];
		setTimeout(() => order.push('timer'), 0);
		await yieldToEventLoop();
		order.push('resumed');
		assert.deepEqual(order, ['timer', 'resumed']);
	});
});

describe('text-output', () => {
	it('normalizeNewlines: CRLF・CRをLFに統一し、他の文字は変えない', () => {
		assert.equal(normalizeNewlines('a\r\nb\rc\nd'), 'a\nb\nc\nd');
		assert.equal(normalizeNewlines('\r\r\n\n'), '\n\n\n');
		assert.equal(normalizeNewlines(' 空白 　全角\t'), ' 空白 　全角\t');
		assert.equal(normalizeNewlines(''), '');
	});

	it('countCharacters: サロゲートペアを1文字として数える', () => {
		assert.equal(countCharacters(''), 0);
		assert.equal(countCharacters('あ😀a'), 3);
		assert.equal(countCharacters('a𠮷b'), 3);
	});

	it('buildTxtBlob: UTF-8（BOMなし）・改行LFのtext/plain', async () => {
		const blob = buildTxtBlob('日本語\r\nabc\r');
		assert.equal(blob.type, 'text/plain;charset=utf-8');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		assert.notDeepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
		assert.equal(new TextDecoder().decode(bytes), '日本語\nabc\n');
	});
});
