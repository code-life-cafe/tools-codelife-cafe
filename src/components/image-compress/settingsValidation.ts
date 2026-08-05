// ImageCompressPage の共有URL/localStorage復元値を検証する純粋ロジック。
// 不正値はデフォルト設定へフォールバックする。

import type { CompressFormat } from '@/lib/tools/image-compress';
import type { CompressUiOptions, ResizeKind } from './CompressOptionsPanel';

const VALID_FORMATS: readonly CompressFormat[] = [
	'jpeg',
	'webp',
	'png',
	'keep',
];
const VALID_RESIZE_KINDS: readonly ResizeKind[] = [
	'none',
	'max-width',
	'max-height',
	'long-edge',
	'percent',
];
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_RESIZE_VALUE = 20000; // px（percent指定時も含めた上限。厳密な業務上限ではなく異常値の排除が目的）
const MAX_TARGET_KB = 1_000_000;

export function sanitizeCompressSettings(
	value: unknown,
	defaults: CompressUiOptions,
): CompressUiOptions {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return defaults;
	}
	const v = value as Record<string, unknown>;
	const format =
		typeof v.format === 'string' &&
		(VALID_FORMATS as readonly string[]).includes(v.format)
			? (v.format as CompressFormat)
			: defaults.format;
	const quality =
		typeof v.quality === 'number' &&
		Number.isFinite(v.quality) &&
		v.quality >= 0 &&
		v.quality <= 1
			? v.quality
			: defaults.quality;
	const resizeKind =
		typeof v.resizeKind === 'string' &&
		(VALID_RESIZE_KINDS as readonly string[]).includes(v.resizeKind)
			? (v.resizeKind as ResizeKind)
			: defaults.resizeKind;
	const resizeValue =
		typeof v.resizeValue === 'number' &&
		Number.isFinite(v.resizeValue) &&
		v.resizeValue > 0 &&
		v.resizeValue <= MAX_RESIZE_VALUE
			? v.resizeValue
			: defaults.resizeValue;
	const useTargetSize =
		typeof v.useTargetSize === 'boolean'
			? v.useTargetSize
			: defaults.useTargetSize;
	const targetKB =
		typeof v.targetKB === 'number' &&
		Number.isFinite(v.targetKB) &&
		v.targetKB > 0 &&
		v.targetKB <= MAX_TARGET_KB
			? v.targetKB
			: defaults.targetKB;
	const background =
		typeof v.background === 'string' && HEX_COLOR_PATTERN.test(v.background)
			? v.background
			: defaults.background;
	return {
		format,
		quality,
		resizeKind,
		resizeValue,
		useTargetSize,
		targetKB,
		background,
	};
}
