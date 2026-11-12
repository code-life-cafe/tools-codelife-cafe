// math.ts — 数値の小さな共通ヘルパー。

/** value を [min, max] の範囲に収める */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
