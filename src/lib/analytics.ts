export type AnalyticsEventName =
	| 'tool_run'
	| 'tool_engage'
	| 'search_empty'
	| 'related_click'
	| 'shared_url_open';

export type AnalyticsProps = {
	tool?: string;
	from?: string;
	to?: string;
	q?: string;
	shared?: boolean;
};

type CloudflareAnalytics = {
	track?: (eventName: string, props?: AnalyticsProps) => void;
};

type ZarazAnalytics = {
	track?: (eventName: string, props?: AnalyticsProps) => void;
};

declare global {
	interface Window {
		cloudflare?: CloudflareAnalytics;
		zaraz?: ZarazAnalytics;
		__codelifeTrack?: (
			eventName: AnalyticsEventName,
			props?: AnalyticsProps,
		) => void;
		__codelifeTrackQueue?: Array<{
			eventName: AnalyticsEventName;
			props?: AnalyticsProps;
		}>;
	}
}

const allowedPropKeys = new Set(['tool', 'from', 'to', 'q', 'shared']);

function sanitizeProps(props: AnalyticsProps = {}): AnalyticsProps {
	const sanitized: AnalyticsProps = {};

	for (const [key, value] of Object.entries(props)) {
		if (!allowedPropKeys.has(key)) continue;
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed) {
				sanitized[key as keyof AnalyticsProps] = trimmed.slice(0, 100) as never;
			}
		} else if (typeof value === 'boolean') {
			sanitized[key as keyof AnalyticsProps] = value as never;
		}
	}

	return sanitized;
}

export function track(
	eventName: AnalyticsEventName,
	props: AnalyticsProps = {},
): void {
	if (typeof window === 'undefined') return;

	const sanitized = sanitizeProps(props);

	try {
		window.dispatchEvent(
			new CustomEvent('codelife:analytics', {
				detail: { eventName, props: sanitized },
			}),
		);
		window.cloudflare?.track?.(eventName, sanitized);
		window.zaraz?.track?.(eventName, sanitized);
	} catch {
		// 計測失敗でツール本体の処理を妨げない。
	}
}
