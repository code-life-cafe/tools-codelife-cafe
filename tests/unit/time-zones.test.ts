import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
	FALLBACK_TIME_ZONES,
	getSupportedTimeZones,
} from '../../src/lib/time-zones.ts';

type MutableIntl = { supportedValuesOf?: unknown };
const intl = Intl as unknown as MutableIntl;
const original = Object.getOwnPropertyDescriptor(Intl, 'supportedValuesOf');

afterEach(() => {
	if (original) Object.defineProperty(Intl, 'supportedValuesOf', original);
});

describe('getSupportedTimeZones', () => {
	it('Intl.supportedValuesOf の結果をそのまま返す', () => {
		const zones = getSupportedTimeZones();
		assert.deepEqual(zones, Intl.supportedValuesOf('timeZone'));
		assert.ok(zones.includes('Asia/Tokyo'));
	});

	it('supportedValuesOf が無い環境では既定の4件を返す', () => {
		delete intl.supportedValuesOf;
		assert.equal('supportedValuesOf' in Intl, false);
		assert.deepEqual(getSupportedTimeZones(), [
			'UTC',
			'Asia/Tokyo',
			'America/New_York',
			'Europe/London',
		]);
	});

	it('フォールバックの戻り値を変更しても定数は変わらない', () => {
		delete intl.supportedValuesOf;
		getSupportedTimeZones().push('X/Y');
		assert.equal(FALLBACK_TIME_ZONES.length, 4);
	});
});
