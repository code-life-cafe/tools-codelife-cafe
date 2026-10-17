import { isAnalyticsDisabledPath } from '../src/lib/analytics-policy.ts';
import { legacyToolDestination } from '../src/lib/seo/legacy-tools.ts';
import { classifyTrafficType } from './lib/traffic-type.ts';

type Env = {
	EVENTS?: {
		writeDataPoint(data: {
			blobs?: string[];
			doubles?: number[];
			indexes?: string[];
		}): void;
	};
};

type PagesMiddlewareContext = {
	request: Request;
	next: () => Promise<Response>;
	env?: Env;
	waitUntil?: (promise: Promise<unknown>) => void;
};

// page_view計測の対象外とするパスプレフィックス（API・モデル配信）
const EXCLUDED_PATH_PREFIXES = ['/api/', '/models/'];

// リクエストのAcceptヘッダはAIエージェント・クローラーが `*/*` や省略で送ることがあり、
// それだけを基準にすると非ブラウザ流入を取りこぼす。実際に配信されたレスポンスの
// Content-Type で判定する。
function shouldRecordPageView(request: Request, response: Response): boolean {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('text/html')) return false;

	const path = new URL(request.url).pathname;
	if (isAnalyticsDisabledPath(path)) return false;
	return !EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// JSを実行しない非ブラウザクライアントはsrc/lib/analytics.tsのビーコンに到達しないため、
// HTMLレスポンス時にmiddlewareでpage_viewを補完記録する。計測失敗はページ配信に影響させない。
function recordPageView(
	context: PagesMiddlewareContext,
	response: Response,
): void {
	const events = context.env?.EVENTS;
	if (
		!events?.writeDataPoint ||
		context.request.headers.get('X-CLC-Synthetic') === '1' ||
		!shouldRecordPageView(context.request, response)
	)
		return;

	const write = () => {
		try {
			const path = new URL(context.request.url).pathname;
			const trafficType = classifyTrafficType(
				context.request.headers.get('user-agent'),
				undefined,
			);
			events.writeDataPoint({
				blobs: ['page_view', path, '', '', '', trafficType],
				indexes: ['page_view'],
			});
		} catch {
			// AE書き込み失敗はページ配信に影響させない
		}
	};

	if (typeof context.waitUntil === 'function') {
		context.waitUntil(Promise.resolve().then(write));
	} else {
		write();
	}
}

export const onRequest = async (
	context: PagesMiddlewareContext,
): Promise<Response> => {
	const url = new URL(context.request.url);
	const destination = legacyToolDestination(url.pathname);
	if (
		destination &&
		(context.request.method === 'GET' || context.request.method === 'HEAD')
	) {
		url.pathname = destination;
		const headers = new Headers({ Location: url.toString() });
		if (url.searchParams.has('settings')) {
			headers.set('X-Robots-Tag', 'noindex, follow');
		}
		return new Response(null, { status: 301, headers });
	}
	const response = await context.next();
	recordPageView(context, response);

	if (!url.searchParams.has('settings')) {
		return response;
	}

	const headers = new Headers(response.headers);
	headers.set('X-Robots-Tag', 'noindex, follow');

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
};
