interface Env {
	EVENTS: {
		writeDataPoint(data: {
			blobs?: string[];
			doubles?: number[];
			indexes?: string[];
		}): void;
	};
}

interface EventPayload {
	event: string;
	props: Record<string, unknown>;
	timestamp?: number;
}

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

		let toolSlug = '';
		let extra1 = '';
		let extra2 = '';

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
			if (typeof props.from !== 'string' || typeof props.to !== 'string') {
				return new Response(null, { status: 204, headers });
			}
			toolSlug = props.from;
			extra1 = props.to;
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

		// Analytics Engine への書き込み
		if (context.env?.EVENTS?.writeDataPoint) {
			context.env.EVENTS.writeDataPoint({
				blobs: [eventName, toolSlug, extra1, extra2],
				indexes: [eventName],
			});
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
