import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures/base';

// Synthetic TIFF IFD0 with inline Make=TEST; no personal or image data.
const TIFF = Buffer.from([
	0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x0f, 1, 2, 0, 4, 0, 0, 0, 0x54, 0x45,
	0x53, 0x54, 0, 0, 0, 0,
]);
const WEBP = Buffer.concat([
	Buffer.from('RIFF'),
	Buffer.from([38, 0, 0, 0]),
	Buffer.from('WEBPEXIF'),
	Buffer.from([26, 0, 0, 0]),
	TIFF,
]);
const UNSUPPORTED = [
	{ name: 'dummy.tiff', mimeType: 'image/tiff', buffer: TIFF },
	{ name: 'dummy.webp', mimeType: 'image/webp', buffer: WEBP },
];
const ERROR =
	'この形式ではメタデータのロスレス削除ができないため、再エンコードが必要です。';

test.describe('EXIF cleaned export rejects unsanitized formats', () => {
	test.beforeEach(async ({ createToolPage }) => {
		await createToolPage('exif').goto();
	});

	for (const file of UNSUPPORTED) {
		test(`single ${file.name} never downloads original bytes`, async ({
			page,
		}) => {
			const downloads: string[] = [];
			page.on('download', (download) =>
				downloads.push(download.suggestedFilename()),
			);
			await page.getByTestId('exif-input').setInputFiles(file);
			await page.getByTestId('strip-button').click();
			await expect(page.getByText(ERROR, { exact: true })).toBeVisible();
			await expect(page.getByTestId('strip-button')).toBeEnabled();
			await expect(page.getByTestId('strip-completion')).toHaveCount(0);
			await expect(
				page.getByRole('button', { name: 'ダウンロード', exact: true }),
			).toHaveCount(0);
			expect(downloads).toEqual([]);
		});
	}

	test('mixed batch ZIP only contains sanitized JPEG results', async ({
		page,
	}) => {
		const jpeg = await readFile(
			path.join(process.cwd(), 'tests/e2e/fixtures/convert-exif.jpg'),
		);
		await page
			.getByTestId('exif-input')
			.setInputFiles([
				{ name: 'first.jpg', mimeType: 'image/jpeg', buffer: jpeg },
				...UNSUPPORTED,
				{ name: 'last.jpg', mimeType: 'image/jpeg', buffer: jpeg },
			]);
		const downloadPromise = page.waitForEvent('download');
		await page.getByTestId('strip-button').click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('cleaned.zip');
		await expect(page.getByText(ERROR, { exact: true })).toHaveCount(2);
		await expect(page.getByTestId('strip-completion')).toContainText(
			'2件の画像',
		);
		const stream = await download.createReadStream();
		if (!stream) throw new Error('Downloaded ZIP stream is unavailable');
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		const zip = Buffer.concat(chunks);
		const end = zip.length - 22;
		expect(zip.readUInt32LE(end)).toBe(0x06054b50);
		expect(zip.readUInt16LE(end + 10)).toBe(2);
		let offset = zip.readUInt32LE(end + 16);
		const names: string[] = [];
		for (let i = 0; i < 2; i++) {
			expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
			const length = zip.readUInt16LE(offset + 28);
			names.push(zip.subarray(offset + 46, offset + 46 + length).toString());
			offset +=
				46 +
				length +
				zip.readUInt16LE(offset + 30) +
				zip.readUInt16LE(offset + 32);
		}
		expect(names).toEqual(['first_cleaned.jpg', 'last_cleaned.jpg']);
	});
});
