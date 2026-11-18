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

// tool_run の dedupeKey の許容最大長（crypto.randomUUID は 36 文字。異常値・肥大化を防ぐ上限）
const MAX_DEDUPE_KEY_LENGTH = 64;

// tool_run の発火起点。src/lib/analytics.ts の ToolRunSource と一致させる。
const ALLOWED_TOOL_RUN_SOURCES = new Set([
	'button',
	'drop',
	'file-input',
	'debounced-input',
	'paste',
	'shortcut',
	'api',
	'unknown',
]);

// リクエスト本文の許容最大長（UTF-16コード単位）。正規のペイロードは数百文字に収まる。
// 上限超過は読み捨て、JSONとして解釈しない。
const MAX_BODY_LENGTH = 4096;

// ツール・ブロック・セットの識別子（kebab-case のslug）。src/lib/tools/catalog.ts の id と同じ形だけを通す。
// 自由文をAnalytics Engineへ書き込ませない（入力本文・個人情報の混入と、計測データの汚染を防ぐ）。
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function isIdentifier(value: unknown): value is string {
	return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

// 匿名セッションID・dedupeKey（crypto.randomUUID 由来）に使える文字。
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// search_empty の文字数区分。src/lib/analytics.ts の sanitizeSearchQuery と一致させる。
const ALLOWED_LENGTH_BUCKETS = new Set(['0', '1-3', '4-10', '11-30', '31+']);

// 表示位置（0始まりの並び順）の許容範囲。
const MAX_POSITION = 999;

function isPosition(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= MAX_POSITION
	);
}

const ALLOWED_EVENTS = new Set([
	'tool_run',
	'tool_engage',
	'search_empty',
	'related_click',
	'top_block_click',
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
	if (context.request.headers.get('X-CLC-Synthetic') === '1') {
		return new Response(null, { status: 204 });
	}
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
		const declaredLength = Number(
			context.request.headers.get('content-length') ?? 0,
		);
		if (declaredLength > MAX_BODY_LENGTH) {
			return new Response(null, { status: 204, headers });
		}
		const text = await context.request.text();
		if (text.length > MAX_BODY_LENGTH) {
			return new Response(null, { status: 204, headers });
		}
		const body = JSON.parse(text) as Partial<EventPayload>;

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
			body.sessionId.length <= MAX_SESSION_ID_LENGTH &&
			OPAQUE_ID_PATTERN.test(body.sessionId)
				? body.sessionId
				: '';

		let toolSlug = '';
		let extra1 = '';
		let extra2 = '';
		let double1: number | undefined;
		// tool_run 専用の追加プロパティ（末尾blobに格納。他イベントでは常に空文字）
		let toolRunSource = '';
		let toolRunDedupeKey = '';

		// allowlist 方式で props を抽出
		if (eventName === 'tool_run') {
			if (!isIdentifier(props.tool))
				return new Response(null, { status: 204, headers });
			toolSlug = props.tool;
			toolRunSource =
				typeof props.source === 'string' &&
				ALLOWED_TOOL_RUN_SOURCES.has(props.source)
					? props.source
					: 'unknown';
			toolRunDedupeKey =
				typeof props.dedupeKey === 'string' &&
				props.dedupeKey.length <= MAX_DEDUPE_KEY_LENGTH &&
				OPAQUE_ID_PATTERN.test(props.dedupeKey)
					? props.dedupeKey
					: '';
		} else if (eventName === 'tool_engage' || eventName === 'shared_url_open') {
			if (!isIdentifier(props.tool))
				return new Response(null, { status: 204, headers });
			toolSlug = props.tool;
		} else if (eventName === 'settings_restore') {
			if (
				!isIdentifier(props.tool) ||
				(props.source !== 'url' && props.source !== 'localStorage')
			) {
				return new Response(null, { status: 204, headers });
			}
			toolSlug = props.tool;
			extra1 = props.source;
		} else if (eventName === 'related_click') {
			if (
				!isIdentifier(props.from) ||
				!isIdentifier(props.to) ||
				!isPosition(props.position)
			) {
				return new Response(null, { status: 204, headers });
			}
			toolSlug = props.from;
			extra1 = props.to;
			extra2 = isIdentifier(props.setId) ? props.setId : '';
			double1 = props.position;
		} else if (eventName === 'top_block_click') {
			if (
				!isIdentifier(props.block) ||
				!isIdentifier(props.tool) ||
				!isPosition(props.position)
			) {
				return new Response(null, { status: 204, headers });
			}
			toolSlug = props.tool;
			extra1 = props.block;
			double1 = props.position;
		} else if (eventName === 'search_empty') {
			if (
				typeof props.lengthBucket !== 'string' ||
				!ALLOWED_LENGTH_BUCKETS.has(props.lengthBucket) ||
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
			const blobs = [
				eventName,
				toolSlug,
				extra1,
				extra2,
				sessionId,
				trafficType,
			];
			// blob7/blob8 は tool_run 専用に既存blobの意味・順序を変えず末尾追加した
			// source / dedupeKey（後方互換維持。他イベントには付与しない）。
			if (eventName === 'tool_run') {
				blobs.push(toolRunSource, toolRunDedupeKey);
			}

			const dataPoint: {
				blobs?: string[];
				doubles?: number[];
				indexes?: string[];
			} = {
				// Analytics Engine のインデックスは 1 データポイントにつき 1 つのみ許容されるため、
				// セッションIDはインデックスではなく blob5 に格納する。
				// blob6 は既存blobの意味・順序を変えず末尾追加した traffic_type（後方互換維持）。
				blobs,
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
