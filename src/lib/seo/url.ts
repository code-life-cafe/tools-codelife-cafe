const SITE_URL = 'https://tools.codelife.cafe';

function removeTrailingSlash(pathname: string): string {
	if (pathname === '/') return pathname;
	return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function normalizeCanonicalPath(path: string): string {
	const rawPath = path.trim() || '/';
	const url =
		rawPath.startsWith('http://') || rawPath.startsWith('https://')
			? new URL(rawPath)
			: new URL(rawPath.startsWith('/') ? rawPath : `/${rawPath}`, SITE_URL);

	const pathname = removeTrailingSlash(url.pathname || '/');
	return pathname === '' ? '/' : pathname;
}

export function toCanonicalUrl(path: string): string {
	return `${SITE_URL}${normalizeCanonicalPath(path)}`;
}

export { SITE_URL };
