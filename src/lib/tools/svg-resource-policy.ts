export const SVG_RESOURCE_ATTRIBUTES = [
	'fill',
	'stroke',
	'filter',
	'mask',
	'clip-path',
	'marker',
	'marker-start',
	'marker-mid',
	'marker-end',
	'cursor',
] as const;

/** Check a browser CSSOM-serialized presentation value, not raw CSS input. */
export function isLocalSvgResourceValue(serialized: string): boolean {
	if (!serialized) return false;
	let local = true;
	const remainder = serialized.replace(
		/\burl\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')\s*\)/gi,
		(
			_match,
			doubleQuoted: string | undefined,
			singleQuoted: string | undefined,
		) => {
			// CSSOM has decoded CSS escapes and serializes URL tokens as strings.
			if (!(doubleQuoted ?? singleQuoted ?? '').startsWith('#')) local = false;
			return '';
		},
	);
	// Reject unparsed URLs, string URL alternatives, and deferred substitution.
	// This also fails closed if a browser cannot serialize a URL as expected.
	return local && !/[\\'"]|\b(?:url|var|env|attr)\s*\(/i.test(remainder);
}
