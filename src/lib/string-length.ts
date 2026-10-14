/** JSON Schema maxLengthと同じUnicodeコードポイント単位で上限を検査する。 */
export function exceedsMaxCharacters(text: string, limit: number): boolean {
	let count = 0;
	for (const _character of text) {
		if (++count > limit) return true;
	}
	return false;
}
