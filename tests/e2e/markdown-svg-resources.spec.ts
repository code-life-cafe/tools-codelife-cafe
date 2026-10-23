import http from 'node:http';
import { expect, test } from './fixtures/base';

const PROBE_PATH = '/svg-resource-probe/';
const IMAGE_DATA =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const RESOURCE =
	'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient><filter id="filter"><feFlood flood-color="red"/></filter><mask id="mask"><rect width="100" height="100" fill="white"/></mask><clipPath id="clip"><rect width="100" height="100"/></clipPath><marker id="marker" markerWidth="10" markerHeight="10"><path d="M0 0L10 5L0 10Z"/></marker></defs></svg>';

async function listen(server: http.Server) {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string')
		throw Error('受け口を開始できません');
	return `http://127.0.0.1:${address.port}`;
}

function close(server: http.Server) {
	return new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

function attribute(value: string) {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

test('SVGリソースはpreview/exportともローカル参照だけを保持し通信しない', async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw Error('preview URLがありません');
	const received: string[] = [];
	let exported = '';
	const receive = (
		request: http.IncomingMessage,
		response: http.ServerResponse,
	) => {
		received.push(request.url ?? '');
		response.writeHead(200, {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'no-store',
			'Access-Control-Allow-Origin': '*',
		});
		response.end(RESOURCE);
	};
	const receiver = http.createServer(receive);
	const upstream = new URL(baseURL);
	const proxy = http.createServer((request, response) => {
		if (request.url?.includes(PROBE_PATH)) return receive(request, response);
		if (request.url === '/downloaded-export') {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			return response.end(exported);
		}
		const forwarded = http.request(
			{
				hostname: upstream.hostname,
				port: upstream.port,
				path: request.url,
				method: request.method,
				headers: { ...request.headers, host: upstream.host },
			},
			(result) => {
				response.writeHead(result.statusCode ?? 502, result.headers);
				result.pipe(response);
			},
		);
		forwarded.on('error', () => {
			response.writeHead(502);
			response.end();
		});
		request.pipe(forwarded);
	});
	const external = await listen(receiver);
	const origin = await listen(proxy);
	try {
		await page.route('**/*', (route) => {
			const url = new URL(route.request().url());
			return url.origin === origin || url.origin === external
				? route.continue()
				: route.abort();
		});
		const attempted: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes(PROBE_PATH)) attempted.push(request.url());
		});
		// A positive control proves that the real loopback receiver is reachable.
		await page.request.get(`${external}${PROBE_PATH}positive.svg`);
		expect(received).toEqual([`${PROBE_PATH}positive.svg`]);
		received.length = 0;
		const bad: { id: string; name: string; value: string }[] = [];
		for (const name of [
			'fill',
			'stroke',
			'filter',
			'mask',
			'clip-path',
			'marker-start',
			'marker-mid',
			'marker-end',
			'cursor',
		]) {
			for (const [index, url] of [
				`${external}${PROBE_PATH}${name}.svg`,
				`${PROBE_PATH}${name}.svg`,
				`${external.replace('http:', '')}${PROBE_PATH}${name}.svg`,
			].entries()) {
				bad.push({
					id: `${name}-${index}`,
					name,
					value: `url("${url}#paint")${name === 'cursor' ? ', auto' : ''}`,
				});
			}
		}
		bad.push(
			{
				id: 'escaped-url',
				name: 'fill',
				value: `u\\72l(${external}${PROBE_PATH}escaped.svg#paint)`,
			},
			{
				id: 'escaped-scheme',
				name: 'fill',
				value: `url("http\\3a ${external.slice(5)}${PROBE_PATH}scheme.svg#paint")`,
			},
			{
				id: 'quoted-url',
				name: 'fill',
				value: `url('${external}${PROBE_PATH}quoted.svg#paint')`,
			},
			{
				id: 'mixed-filter',
				name: 'filter',
				value: `url(#local-filter) url(${external}${PROBE_PATH}mixed.svg#filter)`,
			},
			{
				id: 'image-set',
				name: 'mask',
				value: `image-set("${external}${PROBE_PATH}set.svg" 1x)`,
			},
			{
				id: 'variable-url',
				name: 'fill',
				value: `var(--paint, url(${external}${PROBE_PATH}variable.svg#paint))`,
			},
		);
		const hrefs = [
			{ id: 'external-gradient', name: 'href', tag: 'linearGradient' },
			{ id: 'external-pattern', name: 'xlink:href', tag: 'pattern' },
			{ id: 'external-filter', name: 'href', tag: 'filter' },
		];
		const localEscaped = 'u\\72l("\\23 local-paint")';
		await page.goto(`${origin}/markdown/`);
		await page
			.getByLabel('Markdown入力')
			.fill(
				[
					'# SVGリソース確認',
					'',
					'[通常リンク](https://example.invalid/)',
					'',
					'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="280" height="280">',
					'<defs><linearGradient id="local-paint"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><linearGradient id="local-inherit" href="#local-paint"/><filter id="local-filter"><feGaussianBlur stdDeviation="0.3"/></filter><mask id="local-mask"><rect width="280" height="280" fill="white"/></mask><clipPath id="local-clip"><rect width="280" height="280"/></clipPath></defs>',
					'<defs><marker id="local-marker" markerWidth="10" markerHeight="10"><path d="M0 0L10 5L0 10Z" fill="green"/></marker></defs>',
					...hrefs.map(
						({ id, name, tag }) =>
							`<${tag} id="${id}" ${name}="${external}${PROBE_PATH}${id}.svg#paint"/>`,
					),
					...bad.map(
						({ id, name, value }, index) =>
							`<rect id="${id}" x="${(index % 7) * 35}" y="${Math.floor(index / 7) * 35}" width="30" height="30" ${name}="${attribute(value)}"/>`,
					),
					`<rect id="local-control" width="100" height="80" fill="${attribute(localEscaped)}" filter="url(#local-filter)" mask="url('#local-mask')" clip-path="url(#local-clip)"/>`,
					'<path id="local-markers" d="M10 10L50 30L90 70" stroke="green" marker-start="url(#local-marker)" marker-mid="url(#local-marker)" marker-end="url(#local-marker)"/>',
					`<image id="safe-image" href="${IMAGE_DATA}" width="1" height="1"/>`,
					'<a id="svg-link" href="https://example.invalid/"><text>SVGリンク</text></a>',
					'</svg>',
				].join('\n'),
			);
		const tab = page.getByRole('tab', { name: 'プレビュー' });
		if (await tab.isVisible()) await tab.click();
		const preview = page.getByTestId('markdown-preview');
		await expect(preview.locator('h1')).toHaveText('SVGリソース確認');
		await preview.locator('#local-control').scrollIntoViewIfNeeded();
		await page.waitForTimeout(250);
		expect(received, 'previewから実受け口へ要求しない').toEqual([]);
		for (const { id, name } of [...bad, ...hrefs]) {
			await expect(preview.locator(`#${id}`)).toHaveCount(1);
			await expect(preview.locator(`#${id}`)).not.toHaveAttribute(name);
		}
		await expect(preview.locator('#local-control')).toHaveAttribute(
			'fill',
			localEscaped,
		);
		await expect(preview.locator('#local-control')).toHaveAttribute(
			'filter',
			'url(#local-filter)',
		);
		await expect(preview.locator('#local-control')).toHaveAttribute(
			'mask',
			"url('#local-mask')",
		);
		await expect(preview.locator('#local-inherit')).toHaveAttribute(
			'href',
			'#local-paint',
		);
		await expect(preview.locator('#safe-image')).toHaveAttribute(
			'href',
			IMAGE_DATA,
		);
		for (const name of ['marker-start', 'marker-mid', 'marker-end']) {
			await expect(preview.locator('#local-markers')).toHaveAttribute(
				name,
				'url(#local-marker)',
			);
		}
		await expect(preview.locator('#svg-link')).toHaveAttribute(
			'href',
			'https://example.invalid/',
		);
		await expect(
			preview.getByRole('link', { name: '通常リンク', exact: true }),
		).toHaveAttribute('href', 'https://example.invalid/');
		const downloadEvent = page.waitForEvent('download');
		await page.getByRole('button', { name: 'HTMLダウンロード' }).click();
		const stream = await (await downloadEvent).createReadStream();
		if (!stream) throw Error('HTMLを読み取れません');
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		exported = Buffer.concat(chunks).toString('utf8');
		await page.goto(`${origin}/downloaded-export`);
		await expect(page.locator('#local-control')).toHaveAttribute(
			'fill',
			localEscaped,
		);
		await expect(page.locator('#local-inherit')).toHaveAttribute(
			'href',
			'#local-paint',
		);
		await expect(page.locator('#safe-image')).toHaveAttribute(
			'href',
			IMAGE_DATA,
		);
		for (const name of ['marker-start', 'marker-mid', 'marker-end']) {
			await expect(page.locator('#local-markers')).toHaveAttribute(
				name,
				'url(#local-marker)',
			);
		}
		for (const { id, name } of [...bad, ...hrefs]) {
			await expect(page.locator(`#${id}`)).toHaveCount(1);
			await expect(page.locator(`#${id}`)).not.toHaveAttribute(name);
		}
		await page.waitForTimeout(250);
		expect(attempted).toEqual([]);
		expect(received, 'exportからも実受け口へ要求しない').toEqual([]);
	} finally {
		await page.goto('about:blank');
		await close(proxy);
		await close(receiver);
	}
});
