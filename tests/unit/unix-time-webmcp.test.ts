import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unixTimeTool } from '../../src/lib/webmcp/tools/unix-time.webmcp.ts';

test('unix-time WebMCP: 明示された不正なtimeZoneをUTCに補完しない', async () => {
	for (const timeZone of [9, null, {}, [], true, '', ' ', 'Invalid/Zone']) {
		const result = await unixTimeTool.run({
			value: '0',
			format: 'unix-s',
			timeZone,
		});
		assert.equal(result.ok, false, `timeZone=${JSON.stringify(timeZone)}`);
		if (!result.ok) assert.match(result.error, /timeZone/);
	}
});

test('unix-time WebMCP: timeZone省略時はUTC、指定時はそのタイムゾーンを使う', async () => {
	for (const [options, isoLocal] of [
		[{}, '1970-01-01T00:00:00'],
		[{ timeZone: 'UTC' }, '1970-01-01T00:00:00'],
		[{ timeZone: 'Asia/Tokyo' }, '1970-01-01T09:00:00'],
	] as const) {
		const result = await unixTimeTool.run({
			value: '0',
			format: 'unix-s',
			...options,
		});
		assert.ok(result.ok, result.ok ? undefined : result.error);
		assert.ok(result.value.isoLocal.startsWith(isoLocal));
		assert.equal(result.value.unixSeconds, '0');
	}
});
