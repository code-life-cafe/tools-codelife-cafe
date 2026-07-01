export type AnalyticsEvents = {
	tool_run: { tool: string };
	tool_engage: { tool: string };
	search_empty: {
		lengthBucket: string;
		hasJapanese: boolean;
		tokenCount: number;
		q_redacted?: boolean;
	};
	related_click: { from: string; to: string; setId?: string; position: number };
	shared_url_open: { tool: string };
	settings_restore: { tool: string; source: 'localStorage' | 'url' };
};

export type EventName = keyof AnalyticsEvents;

// モジュールスコープで一度発火したエンゲージメントツールを記憶（タブ単位で保持）
const engagedTools = new Set<string>();

/**
 * 検索語句からメタ情報を抽出する（生テキストは送信しない）
 */
export function getSearchQueryMetadata(
	query: string,
): AnalyticsEvents['search_empty'] {
	const trimmed = query.trim();
	const length = trimmed.length;

	let lengthBucket = '0';
	if (length === 0) lengthBucket = '0';
	else if (length <= 3) lengthBucket = '1-3';
	else if (length <= 10) lengthBucket = '4-10';
	else if (length <= 30) lengthBucket = '11-30';
	else lengthBucket = '31+';

	const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u.test(
		trimmed,
	);
	const tokenCount = trimmed ? trimmed.split(/\s+/).length : 0;

	// メールアドレス、URL、電話番号、極端に長い文字列等の個人情報らしきパターンを検出
	const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(
		trimmed,
	);
	const hasUrl = /https?:\/\/[^\s]+/.test(trimmed);
	const hasPhone = /\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}/.test(trimmed);
	const isTooLong = length > 100;

	const q_redacted =
		hasEmail || hasUrl || hasPhone || isTooLong ? true : undefined;

	return {
		lengthBucket,
		hasJapanese,
		tokenCount,
		...(q_redacted ? { q_redacted: true } : {}),
	};
}

/**
 * 完全匿名のカスタムイベントを送信する
 */
export function track<K extends EventName>(
	eventName: K,
	props: AnalyticsEvents[K],
): void {
	if (typeof window === 'undefined') return;

	try {
		// tool_engage の重複発火防止制御（セッション/タブ単位）
		if (eventName === 'tool_engage') {
			const tool = (props as AnalyticsEvents['tool_engage']).tool;
			if (engagedTools.has(tool)) return;
			engagedTools.add(tool);
		}

		// 開発環境では送信をスキップしコンソールに出力
		if (import.meta.env.DEV) {
			console.debug('[analytics]', eventName, props);
			return;
		}

		const payload = {
			event: eventName,
			props,
			timestamp: Date.now(),
		};

		const blob = new Blob([JSON.stringify(payload)], {
			type: 'application/json',
		});

		let sent = false;
		if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
			sent = navigator.sendBeacon('/api/event', blob);
		}

		if (!sent && typeof fetch !== 'undefined') {
			fetch('/api/event', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				keepalive: true,
			}).catch(() => {
				// エラーは握りつぶす
			});
		}
	} catch (_err) {
		// 計測失敗でツールを絶対に止めないため握りつぶす
	}
}
