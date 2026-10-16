// PDF圧縮・PDF→画像のE2Eで共有する検証ヘルパー
// 出力の検証は実装とは独立に、pdf-lib（構造・寸法・埋め込み画像）・PDF.js（テキスト）・sharp（画素）で行う。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Download, Page, Request } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';

export const PDF_FIXTURES = path.join(
	process.cwd(),
	'tests',
	'fixtures',
	'pdf-expansion',
);
export const fixturePath = (name: string) => path.join(PDF_FIXTURES, name);
export const ENCRYPTED_PDF = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'encrypted.pdf',
);

export async function readDownload(download: Download): Promise<Buffer> {
	return fs.readFileSync(await download.path());
}

/** 指定サイズ・ページ数の空白PDF（上限・キャンセル検証用） */
export async function blankPdf(
	pageCount: number,
	size: [number, number] = [200, 200],
): Promise<Buffer> {
	const doc = await PDFDocument.create();
	for (let i = 0; i < pageCount; i++) {
		const page = doc.addPage(size);
		// 描画に時間がかかるよう、ページごとに図形を描く
		page.drawRectangle({
			x: 10,
			y: 10,
			width: size[0] / 2,
			height: size[1] / 2,
		});
	}
	return Buffer.from(await doc.save());
}

export async function pageSizes(bytes: Uint8Array) {
	const doc = await PDFDocument.load(bytes);
	return doc.getPages().map((p) => ({
		width: Math.round(p.getWidth()),
		height: Math.round(p.getHeight()),
		rotation: p.getRotation().angle,
	}));
}

/** 各ページの XObject に埋め込まれた JPEG（DCTDecode）を取り出す */
export async function pageJpegs(bytes: Uint8Array): Promise<Buffer[]> {
	const doc = await PDFDocument.load(bytes);
	return doc.getPages().map((page, index) => {
		const xobjects = page.node
			.Resources()
			?.lookupMaybe(PDFName.of('XObject'), PDFDict);
		for (const [, ref] of xobjects?.entries() ?? []) {
			const stream = doc.context.lookup(ref);
			if (
				stream instanceof PDFRawStream &&
				stream.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode')
			) {
				return Buffer.from(stream.contents);
			}
		}
		throw new Error(`${index + 1}ページ目にJPEG画像がありません`);
	});
}

export async function rawPixels(image: Buffer) {
	const { data, info } = await sharp(image)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		width: info.width,
		height: info.height,
		at(x: number, y: number): [number, number, number, number] {
			const i = (y * info.width + x) * 4;
			return [data[i], data[i + 1], data[i + 2], data[i + 3]];
		},
	};
}

export function isRed([r, g, b, a]: number[]) {
	return a > 200 && r > 180 && g < 80 && b < 80;
}
export function isBlue([r, g, b, a]: number[]) {
	return a > 200 && b > 180 && r < 80 && g < 80;
}

/**
 * rotated.pdf（回転前 200×100pt、左上に赤・右下に青の40pt正方形）を /Rotate で表示したときの
 * 赤・青正方形の中心座標（72dpi・左上原点のpx）。90度は時計回り表示。
 */
export const ROTATED_EXPECTATIONS = [
	{ rotate: 0, size: [200, 100], red: [20, 20], blue: [180, 80] },
	{ rotate: 90, size: [100, 200], red: [80, 20], blue: [20, 180] },
	{ rotate: 180, size: [200, 100], red: [180, 80], blue: [20, 20] },
	{ rotate: 270, size: [100, 200], red: [20, 180], blue: [80, 20] },
] as const;

/** PDF.js（Node）でページごとのテキストを抽出する */
export async function extractText(bytes: Uint8Array): Promise<string[]> {
	const root = process.cwd();
	const pdfjs = await import(
		pathToFileURL(
			path.join(
				root,
				'node_modules',
				'pdfjs-dist',
				'legacy',
				'build',
				'pdf.mjs',
			),
		).href
	);
	const task = pdfjs.getDocument({
		data: new Uint8Array(bytes),
		cMapUrl: `${path.join(root, 'node_modules', 'pdfjs-dist', 'cmaps')}/`,
		cMapPacked: true,
		verbosity: 0,
	});
	const doc = await task.promise;
	const texts: string[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const content = await (await doc.getPage(n)).getTextContent();
		texts.push(
			content.items.map((item: { str?: string }) => item.str ?? '').join(''),
		);
	}
	await task.destroy();
	return texts;
}

/**
 * ページが発行するリクエストを記録する。ファイル内容・ファイル名が外部や
 * リクエスト本文・URLに含まれないことの確認に使う（遮断ではなく観測）。
 */
export function recordRequests(page: Page) {
	const requests: Request[] = [];
	page.on('request', (request) => requests.push(request));
	return {
		requests,
		assertNoLeak(baseURL: string, secrets: string[]) {
			const origin = new URL(baseURL).origin;
			for (const request of requests) {
				const url = request.url();
				if (url.startsWith('blob:') || url.startsWith('data:')) continue;
				if (new URL(url).origin !== origin) {
					throw new Error(`外部へのリクエスト: ${url}`);
				}
				const body = request.postData() ?? '';
				for (const secret of secrets) {
					if (url.includes(secret) || body.includes(secret)) {
						throw new Error(`リクエストに入力由来の値が含まれています: ${url}`);
					}
				}
			}
		},
	};
}

/** localStorage / URL に入力由来の値が残っていないことを確認する */
export async function storageSnapshot(page: Page) {
	return page.evaluate(() => ({
		url: window.location.href,
		local: Object.fromEntries(
			Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
		),
		session: Object.keys(sessionStorage),
	}));
}
