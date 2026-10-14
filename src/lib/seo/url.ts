const SITE_URL = 'https://tools.codelife.cafe';

export function normalizeCanonicalPath(path: string): string {
	const rawPath = path.trim() || '/';
	const url =
		rawPath.startsWith('http://') || rawPath.startsWith('https://')
			? new URL(rawPath)
			: new URL(rawPath.startsWith('/') ? rawPath : `/${rawPath}`, SITE_URL);

	// Pages serves directory index routes directly at the slash-form URL.
	const pathname = url.pathname || '/';
	return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export function toCanonicalUrl(path: string): string {
	return `${SITE_URL}${normalizeCanonicalPath(path)}`;
}

export { SITE_URL };
