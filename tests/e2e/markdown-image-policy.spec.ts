import { expect, test } from './fixtures/base';

const IMAGE_DATA =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const PROBE_ORIGIN = 'http://127.0.0.1:49383';

// A fulfilled loopback fixture records attempted requests without contacting an external host.
test('SVG画像の外部参照を除去し埋め込み画像と通常の内容を保持する', async ({
	page,
	createToolPage,
}) => {
	const toolPage = createToolPage('markdown');
	await toolPage.goto();
	const requests: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/markdown-image-probe/')) {
			requests.push(request.url());
		}
	});
	await page.route('**/markdown-image-probe/**', (route) =>
		route.fulfill({ status: 200, contentType: 'image/png', body: '' }),
	);

	await page
		.getByLabel('Markdown入力')
		.fill(
			[
				'# 画像ポリシー確認',
				'',
				'[通常リンク](https://example.com/)',
				'',
				`<img id="external-img" src="${PROBE_ORIGIN}/markdown-image-probe/img.png" srcset="${PROBE_ORIGIN}/markdown-image-probe/srcset.png 2x">`,
				`<img id="safe-img" src="${IMAGE_DATA}">`,
				'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">',
				`<image id="external-href" href="${PROBE_ORIGIN}/markdown-image-probe/href.png" width="1" height="1"/>`,
				`<image id="external-xlink" xlink:href="${PROBE_ORIGIN}/markdown-image-probe/xlink.png" width="1" height="1"/>`,
				`<image id="mixed-hrefs" href="${IMAGE_DATA}" xlink:href="${PROBE_ORIGIN}/markdown-image-probe/mixed.png" width="1" height="1"/>`,
				'<image id="relative-href" href="/markdown-image-probe/relative.png" width="1" height="1"/>',
				'<image id="protocol-relative" href="//127.0.0.1:49383/markdown-image-probe/protocol.png" width="1" height="1"/>',
				`<image id="safe-href" href="${IMAGE_DATA}" width="1" height="1"/>`,
				`<image id="safe-xlink" xlink:href="${IMAGE_DATA}" width="1" height="1"/>`,
				'<defs><filter id="external-filter">',
				`<feImage id="external-feimage" href="${PROBE_ORIGIN}/markdown-image-probe/filter.png"/>`,
				`<feImage id="external-feimage-xlink" xlink:href="${PROBE_ORIGIN}/markdown-image-probe/filter-xlink.png"/>`,
				'</filter></defs>',
				'<circle id="safe-shape" cx="5" cy="5" r="4" filter="url(#external-filter)"/>',
				'</svg>',
			].join('\n'),
		);
	// モバイルでは初期表示がエディタなので、プレビュータブに切り替える。
	const previewTab = page.getByRole('tab', { name: 'プレビュー' });
	if (await previewTab.isVisible()) {
		await previewTab.click();
	}
	const preview = page.getByTestId('markdown-preview');
	await expect(preview).toBeVisible();
	await expect(preview.locator('h1')).toHaveText('画像ポリシー確認');
	for (const id of [
		'external-img',
		'external-href',
		'external-xlink',
		'relative-href',
		'protocol-relative',
		'external-feimage',
		'external-feimage-xlink',
	]) {
		const element = preview.locator(`#${id}`);
		await expect(element).toHaveCount(1);
		for (const attribute of ['src', 'srcset', 'href', 'xlink:href']) {
			await expect(element).not.toHaveAttribute(attribute);
		}
	}
	await expect(preview.locator('#mixed-hrefs')).toHaveAttribute(
		'href',
		IMAGE_DATA,
	);
	await expect(preview.locator('#mixed-hrefs')).not.toHaveAttribute(
		'xlink:href',
	);
	await expect(preview.locator('#safe-img')).toHaveAttribute('src', IMAGE_DATA);
	await expect(preview.locator('#safe-href')).toHaveAttribute(
		'href',
		IMAGE_DATA,
	);
	await expect(preview.locator('#safe-xlink')).toHaveAttribute(
		'xlink:href',
		IMAGE_DATA,
	);
	await expect(preview.locator('#safe-shape')).toHaveCount(1);
	const normalLink = preview.getByRole('link', { name: '通常リンク' });
	await expect(normalLink).toBeVisible();
	await expect(normalLink).toHaveAttribute('href', 'https://example.com/');

	// The download must use the same sanitized output as the preview.
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'HTMLダウンロード' }).click();
	const download = await downloadPromise;
	const stream = await download.createReadStream();
	expect(stream).not.toBeNull();
	if (!stream) throw new Error('ダウンロードを読み取れません');
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	const exported = Buffer.concat(chunks).toString('utf8');
	expect(exported).not.toContain('/markdown-image-probe/');
	expect(exported).toContain(IMAGE_DATA);
	expect(exported).toContain('画像ポリシー確認');
	// Parse the downloaded document without attaching it or executing its contents.
	// Compare actual element/namespace/attribute state, so dropping SVG or retaining
	// only the safe HTML img cannot satisfy the export policy assertions.
	const ids = [
		'external-img',
		'safe-img',
		'external-href',
		'external-xlink',
		'mixed-hrefs',
		'relative-href',
		'protocol-relative',
		'safe-href',
		'safe-xlink',
		'external-feimage',
		'external-feimage-xlink',
		'safe-shape',
	];
	const previewElements = await preview.evaluate(
		(root, ids) =>
			ids.map((id) => {
				const element = root.querySelector(`#${id}`);
				return element
					? {
							id,
							name: element.localName,
							namespace: element.namespaceURI,
							attributes: Array.from(element.attributes)
								.map((attribute) => [
									attribute.namespaceURI,
									attribute.name,
									attribute.value,
								])
								.sort(),
						}
					: null;
			}),
		ids,
	);
	const exportedElements = await page.evaluate(
		({ html, ids }) => {
			const document = new DOMParser().parseFromString(html, 'text/html');
			return ids.map((id) => {
				const element = document.querySelector(`#${id}`);
				return element
					? {
							id,
							name: element.localName,
							namespace: element.namespaceURI,
							attributes: Array.from(element.attributes)
								.map((attribute) => [
									attribute.namespaceURI,
									attribute.name,
									attribute.value,
								])
								.sort(),
						}
					: null;
			});
		},
		{ html: exported, ids },
	);
	expect(previewElements.every((element) => element !== null)).toBe(true);
	expect(exportedElements).toEqual(previewElements);
	expect(requests).toEqual([]);
});
