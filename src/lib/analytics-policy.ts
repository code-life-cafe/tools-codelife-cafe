const DISABLED_TOOLS = new Set(['transcribe', 'video-compress']);

export function isAnalyticsDisabledTool(slug: string): boolean {
	return DISABLED_TOOLS.has(slug);
}

// 解析停止の約束は正規URLと旧URLの両方に適用する。
export function isAnalyticsDisabledPath(pathname: string): boolean {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return false;
	}
	const match = /^\/(?:tools\/)?([^/]+)(?:\/|$)/.exec(decoded);
	return match ? isAnalyticsDisabledTool(match[1]) : false;
}
