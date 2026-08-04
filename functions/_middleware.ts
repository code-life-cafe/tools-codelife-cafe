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
	return !EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// JSを実行しない非ブラウザクライアントはsrc/lib/analytics.tsのビーコンに到達しないため、
// HTMLレスポンス時にmiddlewareでpage_viewを補完記録する。計測失敗はページ配信に影響させない。
function recordPageView(
	context: PagesMiddlewareContext,
	response: Response,
): void {
	const writeDataPoint = context.env?.EVENTS?.writeDataPoint;
	if (!writeDataPoint || !shouldRecordPageView(context.request, response))
		return;

	const write = () => {
		try {
			const path = new URL(context.request.url).pathname;
			const trafficType = classifyTrafficType(
				context.request.headers.get('user-agent'),
				undefined,
			);
			writeDataPoint({
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
	const response = await context.next();
	recordPageView(context, response);

	const url = new URL(context.request.url);

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
