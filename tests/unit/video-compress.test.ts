import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AUDIO_BITRATE,
	assertTracksPreserved,
	compressionPlan,
	DEFAULT_VIDEO_SETTINGS,
	outputDimensions,
	reductionPercent,
	validateVideoSettings,
} from '../../src/lib/tools/video-compress.ts';

const info = {
	width: 1920,
	height: 1080,
	duration: 60,
	audioTracks: 2,
	frameRate: 60,
};
test('横・縦・奇数寸法を偶数に縮小し拡大しない', () => {
	assert.deepEqual(outputDimensions(3840, 2160, 1920), {
		width: 1920,
		height: 1080,
	});
	assert.deepEqual(outputDimensions(1080, 1920, 1280), {
		width: 720,
		height: 1280,
	});
	assert.deepEqual(outputDimensions(321, 241, 1920), {
		width: 320,
		height: 240,
	});
	assert.throws(() => outputDimensions(NaN, 1080, 1920));
});
test('目標容量はトリミング後の長さ・全音声・付加データ余裕を含む', () => {
	const settings = {
		...DEFAULT_VIDEO_SETTINGS,
		mode: 'size' as const,
		targetMB: 3,
	};
	const plan = compressionPlan(info, { settings, start: 10, end: 30 });
	assert.equal(plan.duration, 20);
	assert.equal(plan.audioBitrate, 2 * AUDIO_BITRATE);
	assert.equal(plan.videoBitrate, 884_000);
	assert.equal(plan.estimatedBytes, 3_000_000);
	assert.equal(plan.frameRate, 30);
	assert.equal(
		compressionPlan(info, {
			settings: { ...settings, removeAudio: true },
			start: 10,
			end: 30,
		}).videoBitrate,
		1_140_000,
	);
});
test('不正範囲・不正設定・音声だけで容量不足・出力上限を拒否', () => {
	for (const [start, end] of [
		[-1, 30],
		[30, 30],
		[0, 61],
		[NaN, 30],
	])
		assert.throws(() =>
			compressionPlan(info, { settings: DEFAULT_VIDEO_SETTINGS, start, end }),
		);
	for (const targetMB of [0, -1, NaN, Infinity, 129])
		assert.throws(() =>
			compressionPlan(info, {
				settings: { ...DEFAULT_VIDEO_SETTINGS, mode: 'size', targetMB },
				start: 0,
				end: 60,
			}),
		);
	assert.throws(() =>
		compressionPlan(info, {
			settings: { ...DEFAULT_VIDEO_SETTINGS, mode: 'size', targetMB: 0.1 },
			start: 0,
			end: 60,
		}),
	);
	assert.throws(() =>
		compressionPlan(
			{ ...info, duration: 3600 },
			{ settings: DEFAULT_VIDEO_SETTINGS, start: 0, end: 3600 },
		),
	);
});
test('復元は設定値だけを検証しファイル情報を採用しない', () => {
	assert.deepEqual(
		validateVideoSettings({
			targetMB: NaN,
			quality: 'invalid',
			maxEdge: 500,
			file: 'secret.mov',
			removeAudio: 'yes',
		}),
		DEFAULT_VIDEO_SETTINGS,
	);
	assert.deepEqual(
		Object.keys(validateVideoSettings({ file: 'secret.mov' })).sort(),
		Object.keys(DEFAULT_VIDEO_SETTINGS).sort(),
	);
});
test('有効な変換でも必要な音声が欠落すれば拒否', () => {
	assert.throws(() => assertTracksPreserved([1, 2], [1]));
	assert.doesNotThrow(() => assertTracksPreserved([1, 2], [1, 2]));
	assert.equal(reductionPercent(100, 120), -20);
});

test('コピーAACの実測ビットレートを合算して容量を計算', () => {
	const plan = compressionPlan(
		{ ...info, audioBitrate: 320_000 },
		{
			settings: { ...DEFAULT_VIDEO_SETTINGS, mode: 'size', targetMB: 3 },
			start: 10,
			end: 30,
		},
	);
	assert.equal(plan.audioBitrate, 320_000);
	assert.equal(plan.videoBitrate, 820_000);
	assert.equal(plan.estimatedBytes, 3_000_000);
});

test('本番は動画圧縮ページだけ共通CSPを解除しmetaで制限', async () => {
	const { readFile } = await import('node:fs/promises');
	const page = await readFile('src/pages/video-compress.astro', 'utf8');
	assert.match(
		page,
		/http-equiv="Content-Security-Policy" content=\{VIDEO_CSP\}/,
	);
	const headers = await readFile('public/_headers', 'utf8');
	const detachedPaths = [
		...headers.matchAll(/^([^#\s][^\n]*)\n[ \t]+! Content-Security-Policy$/gm),
	].map((match) => match[1]);
	assert.deepEqual(detachedPaths, ['/video-compress', '/video-compress/']);
	for (const path of ['/video-compress', '/video-compress/']) {
		const lines = headers.split('\n');
		const index = lines.indexOf(path);
		assert.notEqual(index, -1);
		assert.equal(lines[index + 1].trim(), '! Content-Security-Policy');
	}
});
