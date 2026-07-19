import {
	AI_AGENT_USER_AGENTS,
	CRAWLER_USER_AGENTS,
	GENERIC_BOT_KEYWORDS,
} from './known-bots.ts';

export type TrafficType = 'human' | 'ai_agent' | 'crawler' | 'unknown';

/**
 * User-Agent と navigator.webdriver ヒントのみから traffic_type を判定する。
 * bot・AIアクセスの遮断は行わず、計測の分類にのみ用いる。
 */
export function classifyTrafficType(
	userAgent: string | null | undefined,
	webdriver: boolean | undefined,
): TrafficType {
	const ua = (userAgent ?? '').toLowerCase();

	if (ua === '') return 'unknown';

	if (AI_AGENT_USER_AGENTS.some((needle) => ua.includes(needle))) {
		return 'ai_agent';
	}

	if (CRAWLER_USER_AGENTS.some((needle) => ua.includes(needle))) {
		return 'crawler';
	}

	if (GENERIC_BOT_KEYWORDS.some((needle) => ua.includes(needle))) {
		return 'crawler';
	}

	if (webdriver === true) return 'unknown';

	return 'human';
}
