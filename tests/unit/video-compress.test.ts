import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AUDIO_BITRATE,
	assertTracksPreserved,
	compressionPlan,
	DEFAULT_VIDEO_SETTINGS,
	outputDimensions,
	qualityEstimate,
	reductionPercent,
	thumbnailTimes,
	trimFieldBounds,
	trimGap,
	trimStep,
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

test('正の開始タイムスタンプを実長に正規化し切り出しを元時刻へ戻す', async () => {
	const { sourceTimeline } = await import(
		'../../src/lib/tools/video-compress.ts'
	);
	const timeline = sourceTimeline(3600, 3660);
	assert.deepEqual(timeline, { startTimestamp: 3600, duration: 60 });
	const plan = compressionPlan(
		{ ...info, ...timeline },
		{ settings: DEFAULT_VIDEO_SETTINGS, start: 10, end: 30 },
	);
	assert.equal(plan.duration, 20);
	assert.equal(plan.sourceStart, 3610);
	assert.equal(plan.sourceEnd, 3630);
	assert.deepEqual(sourceTimeline(-0.02, 60), {
		startTimestamp: 0,
		duration: 60,
	});
	assert.throws(() => sourceTimeline(NaN, 60));
	assert.throws(() => sourceTimeline(60, 60));
});

test('品質の推定は範囲・音声・元容量を反映し増加も明示する', () => {
	const job = { settings: DEFAULT_VIDEO_SETTINGS, start: 0, end: 60 };
	const full = qualityEstimate(info, job, 100_000_000, 'medium');
	assert.match(full, /^約[0-9.]+%削減$/);
	assert.notEqual(
		qualityEstimate(info, { ...job, end: 10 }, 100_000_000, 'medium'),
		full,
	);
	assert.match(qualityEstimate(info, job, 1000, 'high'), /増加$/);
	assert.equal(
		qualityEstimate(info, { ...job, end: 0 }, 1000, 'high'),
		'推定不可',
	);
});
test('短い動画も8フレームを実長内で等間隔に抽出する', () => {
	for (const duration of [0.001, 6.89, 3600]) {
		const times = thumbnailTimes(duration);
		assert.equal(times.length, 8);
		assert.ok(
			times.every(
				(time, index) =>
					time > 0 &&
					time < duration &&
					(index === 0 || time > times[index - 1]),
			),
		);
	}
	assert.deepEqual(thumbnailTimes(0), []);
	assert.deepEqual(thumbnailTimes(Infinity), []);
});

test('スライダー刻みは尺で粗くなるが数値入力の最小間隔は常に細かい', () => {
	assert.equal(trimStep(30), 0.01);
	assert.equal(trimStep(600), 0.1);
	assert.equal(trimStep(600.5), 1);
	assert.equal(trimGap(3600), 0.01);
	assert.equal(trimGap(0.5), 0.005);
});

test('600秒超でも数値入力は1秒未満の範囲を許し、境界で交差しない', () => {
	for (const duration of [600.5, 3600]) {
		assert.notEqual(trimStep(duration), trimGap(duration));
		const bounds = trimFieldBounds(duration, 100, 100.5);
		assert.equal(bounds.start.max, 100.49);
		assert.equal(bounds.end.min, 100.01);
		assert.equal(bounds.end.max, duration);
		assert.ok(bounds.end.min - 100 < 1);
	}
	const full = trimFieldBounds(3600, 0, 3600);
	assert.equal(full.start.max, 3599.99);
	assert.equal(full.end.min, 0.01);
});
