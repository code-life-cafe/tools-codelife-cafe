interface Env {
	EVENTS: {
		writeDataPoint(data: {
			blobs?: string[];
			doubles?: number[];
			indexes?: string[];
		}): void;
	};
}

import { classifyTrafficType } from '../lib/traffic-type.ts';

interface EventPayload {
	event: string;
	props: Record<string, unknown>;
	timestamp?: number;
	// タブ生存中のみ有効な匿名セッションID（sessionStorage 由来・個人追跡なし）
	sessionId?: string;
	// クライアントの navigator.webdriver ヒント（traffic_type 判定にのみ使用、個人識別には使わない）
	webdriver?: boolean;
}

// 匿名セッションIDの許容最大長（crypto.randomUUID は 36 文字。異常値・肥大化を防ぐ上限）
const MAX_SESSION_ID_LENGTH = 64;

const ALLOWED_EVENTS = new Set([
	'tool_run',
	'tool_engage',
	'search_empty',
	'related_click',
	'shared_url_open',
	'settings_restore',
]);

const ALLOWED_ORIGINS = new Set([
	'https://tools.codelife.cafe',
	'http://localhost:4321',
	'http://127.0.0.1:4321',
]);

export const onRequestPost = async (context: {
	request: Request;
	env: Env;
}): Promise<Response> => {
	const origin = context.request.headers.get('origin');

	// CORS / Origin チェック
	// Originヘッダーが存在し、かつ許可リストに含まれていない場合は204で破棄
	if (origin && !ALLOWED_ORIGINS.has(origin)) {
		return new Response(null, { status: 204 });
	}

	const headers: Record<string, string> = {
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		headers['Access-Control-Allow-Origin'] = origin;
	}

	try {
		const body = (await context.request.json()) as Partial<EventPayload>;

		if (
			!body ||
			typeof body.event !== 'string' ||
			!ALLOWED_EVENTS.has(body.event)
		) {
			return new Response(null, { status: 204, headers });
		}

		const eventName = body.event;
		const props =
			body.props && typeof body.props === 'object' ? body.props : {};

		// 匿名セッションID（sessionStorage 由来）を検証。異常値は空文字として無視する。
		const sessionId =
			typeof body.sessionId === 'string' &&
			body.sessionId.length <= MAX_SESSION_ID_LENGTH
				? body.sessionId
				: '';

		let toolSlug = '';
		let extra1 = '';
		let extra2 = '';
		let double1: number | undefined;

		// allowlist 方式で props を抽出
		if (
			eventName === 'tool_run' ||
			eventName === 'tool_engage' ||
			eventName === 'shared_url_open'
		) {
			if (typeof props.tool !== 'string')
				return new Response(null, { status: 204, headers });
			toolSlug = props.tool;
		} else if (eventName === 'settings_restore') {
			if (
				typeof props.tool !== 'string' ||
				(props.source !== 'url' && props.source !== 'localStorage')
			) {
				return new Response(null, { status: 204, headers });
			}
			toolSlug = props.tool;
			extra1 = props.source;
		} else if (eventName === 'related_click') {
			if (
				typeof props.from !== 'string' ||
				typeof props.to !== 'string' ||
				typeof props.position !== 'number'
			) {
				return new Response(null, { status: 204, headers });
			}
			toolSlug = props.from;
			extra1 = props.to;
			extra2 = typeof props.setId === 'string' ? props.setId : '';
			double1 = props.position;
		} else if (eventName === 'search_empty') {
			if (
				typeof props.lengthBucket !== 'string' ||
				typeof props.hasJapanese !== 'boolean'
			) {
				return new Response(null, { status: 204, headers });
			}
			extra1 = props.lengthBucket;
			extra2 = props.hasJapanese ? 'ja' : 'other';
		}

		// traffic_type判定（human / ai_agent / crawler / unknown）。遮断・レート制限は行わず計測分類のみに使用する。
		const trafficType = classifyTrafficType(
			context.request.headers.get('user-agent'),
			body.webdriver === true,
		);

		// Analytics Engine への書き込み
		if (context.env?.EVENTS?.writeDataPoint) {
			const dataPoint: {
				blobs?: string[];
				doubles?: number[];
				indexes?: string[];
			} = {
				// Analytics Engine のインデックスは 1 データポイントにつき 1 つのみ許容されるため、
				// セッションIDはインデックスではなく blob5 に格納する。
				// blob6 は既存blobの意味・順序を変えず末尾追加した traffic_type（後方互換維持）。
				blobs: [eventName, toolSlug, extra1, extra2, sessionId, trafficType],
				indexes: [eventName],
			};
			if (double1 !== undefined) {
				dataPoint.doubles = [double1];
			}
			context.env.EVENTS.writeDataPoint(dataPoint);
		}

		return new Response(null, { status: 204, headers });
	} catch (_err) {
		return new Response(null, { status: 204, headers });
	}
};

export const onRequestOptions = async (context: {
	request: Request;
}): Promise<Response> => {
	const origin = context.request.headers.get('origin');
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': origin,
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			},
		});
	}
	return new Response(null, { status: 204 });
};
