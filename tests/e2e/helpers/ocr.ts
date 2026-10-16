// 画像OCRのE2E共通ヘルパー（固定fixture・CER計算・テスト画像の生成）
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export const OCR_FIXTURE_DIR = path.join(
	process.cwd(),
	'tests',
	'fixtures',
	'image-ocr',
);

export type OcrFixtureEntry = {
	id: string;
	group: 'clear' | 'degraded' | 'perf';
	file: string;
};

export function fixtureManifest(): OcrFixtureEntry[] {
	return JSON.parse(
		fs.readFileSync(path.join(OCR_FIXTURE_DIR, 'manifest.json'), 'utf8'),
	);
}

export const fixtureImage = (file: string) => path.join(OCR_FIXTURE_DIR, file);
export const fixtureTruth = (id: string) =>
	fs.readFileSync(path.join(OCR_FIXTURE_DIR, 'truth', `${id}.txt`), 'utf8');

/** CRLF→LF と改行除去だけを行う（誤字を隠す正規化はしない） */
export const normalizeForCer = (s: string) =>
	s.replace(/\r\n/g, '\n').replace(/\n/g, '');

export function levenshtein(a: string, b: string): number {
	const A = [...a];
	const B = [...b];
	let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
	for (let i = 1; i <= A.length; i++) {
		const cur = [i];
		for (let j = 1; j <= B.length; j++) {
			cur[j] = Math.min(
				prev[j] + 1,
				cur[j - 1] + 1,
				prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1),
			);
		}
		prev = cur;
	}
	return prev[B.length];
}

export function cer(
	truth: string,
	actual: string,
): {
	dist: number;
	chars: number;
} {
	const ref = normalizeForCer(truth);
	return {
		dist: levenshtein(ref, normalizeForCer(actual)),
		chars: [...ref].length,
	};
}

export type SynthImageOptions = {
	width: number;
	height: number;
	text?: string;
	/** true の場合、背景を塗らず透過のまま黒文字だけを描く */
	transparent?: boolean;
	mime?: 'image/png' | 'image/jpeg' | 'image/webp';
	/** 画素を反時計回りに90度回転して保存する（EXIF向き6の検証用） */
	rotateCcw?: boolean;
	fontSize?: number;
};

/** ブラウザのcanvasで合成画像を作り、バイト列を返す（個人情報なし） */
export async function synthImage(
	page: Page,
	options: SynthImageOptions,
): Promise<Buffer> {
	const base64 = await page.evaluate(async (o) => {
		const canvas = document.createElement('canvas');
		canvas.width = o.width;
		canvas.height = o.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no 2d context');
		if (!o.transparent) {
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, o.width, o.height);
		}
		if (o.text) {
			ctx.fillStyle = '#000';
			ctx.font = `${o.fontSize ?? 40}px sans-serif`;
			ctx.textBaseline = 'top';
			ctx.fillText(o.text, 24, 24);
		}
		let out = canvas;
		if (o.rotateCcw) {
			out = document.createElement('canvas');
			out.width = o.height;
			out.height = o.width;
			const octx = out.getContext('2d');
			if (!octx) throw new Error('no 2d context');
			octx.fillStyle = '#fff';
			octx.fillRect(0, 0, out.width, out.height);
			octx.translate(0, out.height);
			octx.rotate(-Math.PI / 2);
			octx.drawImage(canvas, 0, 0);
		}
		const blob = await new Promise<Blob | null>((resolve) =>
			out.toBlob(resolve, o.mime ?? 'image/png', 0.95),
		);
		if (!blob) throw new Error('toBlob failed');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = '';
		for (let i = 0; i < bytes.length; i += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		}
		return btoa(binary);
	}, options);
	return Buffer.from(base64, 'base64');
}

/** JPEG の先頭に EXIF（Orientation のみ）を挿入する */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
	const tiff = Buffer.from([
		0x4d,
		0x4d,
		0x00,
		0x2a,
		0x00,
		0x00,
		0x00,
		0x08,
		0x00,
		0x01,
		0x01,
		0x12,
		0x00,
		0x03,
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		orientation,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
	]);
	const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
	const segment = Buffer.concat([
		Buffer.from([
			0xff,
			0xe1,
			(payload.length + 2) >> 8,
			(payload.length + 2) & 255,
		]),
		payload,
	]);
	return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

function crc32(buf: Buffer): number {
	let c = ~0;
	for (const b of buf) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
	}
	return ~c >>> 0;
}

/** PNG の IHDR の後ろへ任意のチャンクを挿入する（tEXt マーカー・acTL 等の検証用） */
export function insertPngChunk(
	png: Buffer,
	type: string,
	data: Buffer,
): Buffer {
	const typeBuf = Buffer.from(type, 'latin1');
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
	const chunk = Buffer.concat([len, typeBuf, data, crc]);
	const ihdrEnd = 8 + 4 + 4 + 13 + 4;
	return Buffer.concat([
		png.subarray(0, ihdrEnd),
		chunk,
		png.subarray(ihdrEnd),
	]);
}

/** アニメーションPNG（acTL を持つ）に見せた静止PNG */
export function asApng(png: Buffer): Buffer {
	return insertPngChunk(png, 'acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]));
}

/** アニメーションフラグを立てたWebP（VP8X + ANIM）。デコードはしない拒否検証用 */
export function animatedWebpHeader(): Buffer {
	const chunk = (type: string, data: number[]) =>
		Buffer.concat([
			Buffer.from(type, 'latin1'),
			Buffer.from([data.length & 255, 0, 0, 0]),
			Buffer.from(data),
		]);
	const body = Buffer.concat([
		Buffer.from('WEBP', 'latin1'),
		chunk('VP8X', [0x02, 0, 0, 0, 9, 0, 0, 9, 0, 0]),
		chunk('ANIM', [0, 0, 0, 0, 0, 0]),
	]);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(body.length);
	return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body]);
}
