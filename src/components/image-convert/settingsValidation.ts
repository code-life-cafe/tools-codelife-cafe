// ImageConvertPage の共有URL/localStorage復元値を検証する純粋ロジック。
// 不正値はデフォルト設定へフォールバックする。

import type { ExifMode, TargetFormat } from '@/lib/tools/image-convert';
import type { ConvertUiOptions } from './ConvertOptionsPanel';

const VALID_TARGETS: readonly TargetFormat[] = ['jpeg', 'png', 'webp', 'avif'];
const VALID_EXIF_MODES: readonly ExifMode[] = ['keep', 'strip'];
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function sanitizeConvertSettings(
	value: unknown,
	defaults: ConvertUiOptions,
): ConvertUiOptions {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return defaults;
	}
	const v = value as Record<string, unknown>;
	const target =
		typeof v.target === 'string' &&
		(VALID_TARGETS as readonly string[]).includes(v.target)
			? (v.target as TargetFormat)
			: defaults.target;
	const quality =
		typeof v.quality === 'number' &&
		Number.isFinite(v.quality) &&
		v.quality >= 0 &&
		v.quality <= 100
			? v.quality
			: defaults.quality;
	const exif =
		typeof v.exif === 'string' &&
		(VALID_EXIF_MODES as readonly string[]).includes(v.exif)
			? (v.exif as ExifMode)
			: defaults.exif;
	const background =
		typeof v.background === 'string' && HEX_COLOR_PATTERN.test(v.background)
			? v.background
			: defaults.background;
	return { target, quality, exif, background };
}
