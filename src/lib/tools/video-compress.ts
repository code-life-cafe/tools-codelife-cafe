export const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
export const AUDIO_BITRATE = 128_000;
export const VIDEO_CSP =
	"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'";

export type VideoSettings = {
	mode: 'quality' | 'size';
	quality: 'high' | 'medium' | 'low';
	targetMB: number;
	maxEdge: number;
	removeAudio: boolean;
};
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
	mode: 'quality',
	quality: 'medium',
	targetMB: 20,
	maxEdge: 1920,
	removeAudio: false,
};
export type VideoInfo = {
	width: number;
	height: number;
	duration: number;
	startTimestamp?: number;
	audioTracks: number;
	audioBitrate?: number;
	frameRate: number;
};
export type VideoJob = { settings: VideoSettings; start: number; end: number };
export type VideoReply =
	| { type: 'ready'; info: VideoInfo }
	| { type: 'progress'; progress: number }
	| { type: 'done'; buffer: ArrayBuffer }
	| { type: 'error'; message: string };

export function validateVideoSettings(
	value: unknown,
	defaults = DEFAULT_VIDEO_SETTINGS,
): VideoSettings {
	if (!value || typeof value !== 'object') return { ...defaults };
	const raw = value as Record<string, unknown>;
	return {
		mode:
			raw.mode === 'quality' || raw.mode === 'size' ? raw.mode : defaults.mode,
		quality:
			raw.quality === 'high' ||
			raw.quality === 'medium' ||
			raw.quality === 'low'
				? raw.quality
				: defaults.quality,
		targetMB:
			typeof raw.targetMB === 'number' &&
			Number.isFinite(raw.targetMB) &&
			raw.targetMB >= 0.1 &&
			raw.targetMB <= 128
				? raw.targetMB
				: defaults.targetMB,
		maxEdge:
			typeof raw.maxEdge === 'number' &&
			[0, 1920, 1280, 854].includes(raw.maxEdge)
				? raw.maxEdge
				: defaults.maxEdge,
		removeAudio:
			typeof raw.removeAudio === 'boolean'
				? raw.removeAudio
				: defaults.removeAudio,
	};
}
export function outputDimensions(
	width: number,
	height: number,
	maxEdge: number,
) {
	if (![width, height].every((v) => Number.isFinite(v) && v >= 2))
		throw new Error('動画の解像度を読み取れません。');
	const scale =
		maxEdge > 0 ? Math.min(1, maxEdge / Math.max(width, height)) : 1;
	return {
		width: Math.max(2, Math.floor((width * scale) / 2) * 2),
		height: Math.max(2, Math.floor((height * scale) / 2) * 2),
	};
}
export function sourceTimeline(firstTimestamp: number, endTimestamp: number) {
	if (![firstTimestamp, endTimestamp].every(Number.isFinite))
		throw new Error('動画の長さを読み取れません。');
	const startTimestamp = Math.max(0, firstTimestamp);
	const duration = endTimestamp - startTimestamp;
	if (duration <= 0) throw new Error('動画の長さを読み取れません。');
	return { startTimestamp, duration };
}
export function compressionPlan(info: VideoInfo, job: VideoJob) {
	const { start, end, settings } = job;
	if (
		!['quality', 'size'].includes(settings.mode) ||
		!['high', 'medium', 'low'].includes(settings.quality) ||
		![0, 1920, 1280, 854].includes(settings.maxEdge) ||
		typeof settings.removeAudio !== 'boolean' ||
		!Number.isFinite(settings.targetMB) ||
		settings.targetMB < 0.1 ||
		settings.targetMB > 128
	)
		throw new Error(
			'圧縮設定が不正です。目標容量は0.1〜128MBで指定してください。',
		);
	if (
		![start, end, info.duration].every(Number.isFinite) ||
		start < 0 ||
		end > info.duration ||
		end <= start
	)
		throw new Error('開始・終了秒を動画の範囲内で指定してください。');
	const dimensions = outputDimensions(
		info.width,
		info.height,
		settings.maxEdge,
	);
	const duration = end - start;
	const audioBitrate = settings.removeAudio
		? 0
		: (info.audioBitrate ?? info.audioTracks * AUDIO_BITRATE);
	const frameRate = Math.min(30, Math.max(1, info.frameRate));
	const factor = { high: 0.12, medium: 0.075, low: 0.04 }[settings.quality];
	const videoBitrate =
		settings.mode === 'size'
			? Math.floor(
					(settings.targetMB * 1_000_000 * 8 * 0.95) / duration - audioBitrate,
				)
			: Math.max(
					100_000,
					Math.round(dimensions.width * dimensions.height * frameRate * factor),
				);
	if (!Number.isFinite(videoBitrate) || videoBitrate < 50_000)
		throw new Error(
			'目標容量が小さすぎます。容量を増やすか、範囲を短くするか、音声を削除してください。',
		);
	const estimatedBytes = Math.ceil(
		((videoBitrate + audioBitrate) * duration) / 8 / 0.95,
	);
	if (estimatedBytes > MAX_OUTPUT_BYTES)
		throw new Error(
			'推定出力が128MiBを超えます。品質・解像度を下げるか範囲を短くしてください。',
		);
	return {
		...dimensions,
		sourceStart: (info.startTimestamp ?? 0) + start,
		sourceEnd: (info.startTimestamp ?? 0) + end,
		duration,
		frameRate,
		videoBitrate,
		audioBitrate,
		estimatedBytes,
	};
}
export function formatVideoBytes(bytes: number) {
	return `${(bytes / 1_000_000).toFixed(2)} MB`;
}
export function reductionPercent(before: number, after: number) {
	return Math.round((1 - after / before) * 100);
}
export function assertTracksPreserved(
	required: readonly number[],
	utilized: readonly number[],
) {
	if (required.some((id) => !utilized.includes(id)))
		throw new Error(
			'必要な映像または音声を変換できません。音声を削除するか、対応ブラウザー・動画を変更してください。',
		);
}

export function thumbnailTimes(duration: number): number[] {
	if (!Number.isFinite(duration) || duration <= 0) return [];
	return Array.from(
		{ length: 8 },
		(_, index) => (duration * (index + 0.5)) / 8,
	);
}

export function qualityEstimate(
	info: VideoInfo,
	job: VideoJob,
	originalBytes: number,
	quality: VideoSettings['quality'],
): string {
	try {
		const plan = compressionPlan(info, {
			...job,
			settings: { ...job.settings, mode: 'quality', quality },
		});
		const percent = reductionPercent(originalBytes, plan.estimatedBytes);
		return `約${Math.abs(percent)}%${percent < 0 ? '増加' : '削減'}`;
	} catch {
		return '推定不可';
	}
}
