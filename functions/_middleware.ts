type PagesMiddlewareContext = {
	request: Request;
	next: () => Promise<Response>;
};

export const onRequest = async (
	context: PagesMiddlewareContext,
): Promise<Response> => {
	const response = await context.next();
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
