import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildTxtBlob,
	checkOcrDimensions,
	countCharacters,
	DEFAULT_IMAGE_OCR_SETTINGS,
	imageBaseName,
	inspectOcrImage,
	isBlankText,
	MAX_OCR_EDGE,
	MAX_OCR_FILE_BYTES,
	MAX_OCR_PIXELS,
	MAX_OCR_TEXT_UNITS,
	normalizeNewlines,
	sanitizeImageOcrSettings,
	TEXT_TOO_LONG_MESSAGE,
	txtFileName,
	validateOutputText,
} from '../../src/lib/tools/image-ocr.ts';

// ---- 最小のヘッダーだけを持つ合成バイト列（デコードはしない検査の対象） ----
const be32 = (n: number) => [
	(n >>> 24) & 255,
	(n >>> 16) & 255,
	(n >>> 8) & 255,
	n & 255,
];
const le32 = (n: number) => [
	n & 255,
	(n >>> 8) & 255,
	(n >>> 16) & 255,
	(n >>> 24) & 255,
];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function pngChunk(type: string, data: number[]): number[] {
	return [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

function png(width: number, height: number, animated = false): Uint8Array {
	return Uint8Array.from([
		0x89,
		0x50,
		0x4e,
		0x47,
		0x0d,
		0x0a,
		0x1a,
		0x0a,
		...pngChunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
		...(animated ? pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]) : []),
		...pngChunk('IDAT', [0]),
		...pngChunk('IEND', []),
	]);
}

function jpeg(width: number, height: number): Uint8Array {
	return Uint8Array.from([
		0xff,
		0xd8,
		0xff,
		0xe0,
		0,
		4,
		0,
		0,
		0xff,
		0xc0,
		0,
		11,
		8,
		height >> 8,
		height & 255,
		width >> 8,
		width & 255,
		1,
		1,
		0x11,
		0,
	]);
}

function riff(chunks: number[][]): Uint8Array {
	const body = [...ascii('WEBP'), ...chunks.flat()];
	return Uint8Array.from([...ascii('RIFF'), ...le32(body.length), ...body]);
}
const webpChunk = (type: string, data: number[]) => [
	...ascii(type),
	...le32(data.length),
	...data,
	...(data.length % 2 ? [0] : []),
];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

function webpVp8x(width: number, height: number, flags = 0): Uint8Array {
	return riff([
		webpChunk('VP8X', [
			flags,
			0,
			0,
			0,
			...le24(width - 1),
			...le24(height - 1),
		]),
	]);
}

function webpVp8(width: number, height: number): Uint8Array {
	return riff([
		webpChunk('VP8 ', [
			0,
			0,
			0,
			0x9d,
			0x01,
			0x2a,
			width & 255,
			(width >> 8) & 0x3f,
			height & 255,
			(height >> 8) & 0x3f,
		]),
	]);
}

function webpVp8l(width: number, height: number): Uint8Array {
	const w = width - 1;
	const h = height - 1;
	return riff([
		webpChunk('VP8L', [
			0x2f,
			w & 255,
			((w >> 8) & 0x3f) | ((h & 3) << 6),
			(h >> 2) & 255,
			(h >> 10) & 0x0f,
		]),
	]);
}

describe('inspectOcrImage: 形式と寸法', () => {
	it('PNG/JPEG/WebP(VP8X・VP8・VP8L)の寸法を読み取る', () => {
		assert.deepEqual(inspectOcrImage(png(640, 480)), {
			ok: true,
			format: 'png',
			width: 640,
			height: 480,
		});
		assert.deepEqual(inspectOcrImage(jpeg(1920, 1080)), {
			ok: true,
			format: 'jpeg',
			width: 1920,
			height: 1080,
		});
		for (const bytes of [
			webpVp8x(1000, 500),
			webpVp8(1000, 500),
			webpVp8l(1000, 500),
		]) {
			assert.deepEqual(inspectOcrImage(bytes), {
				ok: true,
				format: 'webp',
				width: 1000,
				height: 500,
			});
		}
	});

	it('総画素数 12,000,000 ちょうどは許可し、1画素ぶん超えると拒否する', () => {
		assert.equal(inspectOcrImage(png(4000, 3000)).ok, true);
		const over = inspectOcrImage(png(4001, 3000));
		assert.equal(over.ok, false);
		assert.equal(over.ok === false && over.code, 'too-many-pixels');
		assert.equal(MAX_OCR_PIXELS, 12_000_000);
	});

	it('1辺 8192px ちょうどは許可し、8193px は拒否する', () => {
		assert.equal(inspectOcrImage(png(8192, 1464)).ok, true);
		assert.equal(inspectOcrImage(jpeg(1464, 8192)).ok, true);
		for (const bytes of [png(8193, 1), jpeg(1, 8193), webpVp8x(8193, 1)]) {
			const r = inspectOcrImage(bytes);
			assert.equal(r.ok, false);
			assert.equal(r.ok === false && r.code, 'too-large-dimension');
		}
		assert.equal(MAX_OCR_EDGE, 8192);
	});

	it('1辺が上限内でも画素数が超える画像（8192×1465）は拒否する', () => {
		const r = inspectOcrImage(png(8192, 1465));
		assert.equal(r.ok === false && r.code, 'too-many-pixels');
	});

	it('ファイルサイズ 20MiB ちょうどは許可し、1バイト超過・空は拒否する', () => {
		assert.equal(inspectOcrImage(png(10, 10), MAX_OCR_FILE_BYTES).ok, true);
		const big = inspectOcrImage(png(10, 10), MAX_OCR_FILE_BYTES + 1);
		assert.equal(big.ok === false && big.code, 'too-large-file');
		const empty = inspectOcrImage(new Uint8Array(0), 0);
		assert.equal(empty.ok === false && empty.code, 'empty');
		assert.equal(MAX_OCR_FILE_BYTES, 20 * 1024 * 1024);
	});

	it('エラーメッセージは日本語で、寸法を含む', () => {
		const r = inspectOcrImage(png(9000, 100));
		assert.ok(r.ok === false && r.message.includes('9000×100'));
		assert.ok(r.ok === false && /[ぁ-んァ-ン]/.test(r.message));
	});

	it('0×0・破損ヘッダー・SOFのないJPEGは壊れた画像として拒否する', () => {
		const zero = inspectOcrImage(png(0, 0));
		assert.equal(zero.ok === false && zero.code, 'broken');
		const truncated = inspectOcrImage(png(10, 10).slice(0, 20));
		assert.equal(truncated.ok === false && truncated.code, 'broken');
		const noSof = inspectOcrImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
		assert.equal(noSof.ok === false && noSof.code, 'broken');
	});
});

describe('inspectOcrImage: 非対応・アニメーション', () => {
	it('APNG（IDATより前のacTL）を拒否する', () => {
		const r = inspectOcrImage(png(100, 100, true));
		assert.equal(r.ok === false && r.code, 'animated');
		assert.ok(r.ok === false && r.message.includes('アニメーション'));
	});

	it('アニメーションWebP（VP8Xフラグ・ANIM/ANMFのみ）を拒否する', () => {
		const flagged = inspectOcrImage(webpVp8x(100, 100, 0x02));
		assert.equal(flagged.ok === false && flagged.code, 'animated');
		const anim = inspectOcrImage(
			riff([
				webpChunk('VP8X', [0, 0, 0, 0, 99, 0, 0, 99, 0, 0]),
				webpChunk('ANIM', [0, 0, 0, 0, 0, 0]),
			]),
		);
		assert.equal(anim.ok === false && anim.code, 'animated');
		const anmf = inspectOcrImage(
			riff([
				webpChunk('VP8X', [0, 0, 0, 0, 99, 0, 0, 99, 0, 0]),
				webpChunk('ANMF', [0, 0, 0, 0]),
			]),
		);
		assert.equal(anmf.ok === false && anmf.code, 'animated');
	});

	it('静止画のWebP（アニメーションフラグなし）は許可する', () => {
		assert.equal(inspectOcrImage(webpVp8x(100, 100, 0x10)).ok, true);
	});

	it('GIF・未知の形式は、拡張子やMIMEに関わらず内容で拒否する', () => {
		const gif = inspectOcrImage(Uint8Array.from(ascii('GIF89a......')));
		assert.equal(gif.ok === false && gif.code, 'gif');
		const text = inspectOcrImage(
			Uint8Array.from(ascii('<svg xmlns="x"></svg>')),
		);
		assert.equal(text.ok === false && text.code, 'unsupported-format');
		const heic = inspectOcrImage(
			Uint8Array.from([0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0]),
		);
		assert.equal(heic.ok === false && heic.code, 'unsupported-format');
	});
});

describe('checkOcrDimensions', () => {
	it('正常値は null、不正値はエラー', () => {
		assert.equal(checkOcrDimensions(4000, 3000), null);
		assert.equal(checkOcrDimensions(0, 10)?.ok, false);
		assert.equal(checkOcrDimensions(Number.NaN, 10)?.ok, false);
	});
});

describe('設定', () => {
	it('言語モードだけを保持し、不正値は既定に戻す', () => {
		assert.deepEqual(sanitizeImageOcrSettings({ mode: 'eng' }), {
			mode: 'eng',
		});
		assert.deepEqual(sanitizeImageOcrSettings({ mode: 'jpn+eng' }), {
			mode: 'jpn+eng',
		});
		for (const bad of [
			null,
			undefined,
			[],
			'eng',
			{ mode: 'fra' },
			{ mode: 1 },
		]) {
			assert.deepEqual(
				sanitizeImageOcrSettings(bad),
				DEFAULT_IMAGE_OCR_SETTINGS,
			);
		}
	});

	it('余計なキー（入力内容になりうる値）は保持しない', () => {
		assert.deepEqual(
			sanitizeImageOcrSettings({
				mode: 'eng',
				text: '秘密',
				fileName: 'a.png',
			}),
			{ mode: 'eng' },
		);
	});
});

describe('出力テキスト', () => {
	it('改行コードだけをLFに統一し、内容は変えない', () => {
		assert.equal(normalizeNewlines('a\r\nb\rc\nd'), 'a\nb\nc\nd');
		assert.equal(normalizeNewlines(' 空白 　全角\t'), ' 空白 　全角\t');
	});

	it('空・空白のみ（全角空白・改行を含む）は空として扱う', () => {
		assert.equal(isBlankText(''), true);
		assert.equal(isBlankText(' \n\t　\r\n'), true);
		assert.equal(isBlankText('あ'), false);
	});

	it('10万UTF-16コード単位ちょうどは許可、超過はエラー（切り捨てない）', () => {
		assert.equal(validateOutputText('a'.repeat(MAX_OCR_TEXT_UNITS)), null);
		assert.equal(
			validateOutputText('a'.repeat(MAX_OCR_TEXT_UNITS + 1)),
			TEXT_TOO_LONG_MESSAGE,
		);
		// サロゲートペアは2コード単位
		assert.equal(validateOutputText('😀'.repeat(50_000)), null);
		assert.equal(
			validateOutputText('😀'.repeat(50_001)),
			TEXT_TOO_LONG_MESSAGE,
		);
	});

	it('文字数はコードポイント数で数える', () => {
		assert.equal(countCharacters('あ😀a'), 3);
	});

	it('TXTはUTF-8・BOMなし・LFで、本文はそのまま保存する', async () => {
		const blob = buildTxtBlob('日本語\r\nabc\r\n');
		assert.equal(blob.type, 'text/plain;charset=utf-8');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		assert.notDeepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
		assert.equal(new TextDecoder().decode(bytes), '日本語\nabc\n');
	});

	it('ファイル名は元名＋_ocr.txt。拡張子なし・空名は既定名', () => {
		assert.equal(
			txtFileName(imageBaseName('スクショ 1.PNG')),
			'スクショ 1_ocr.txt',
		);
		assert.equal(txtFileName(imageBaseName('a.b.jpeg')), 'a.b_ocr.txt');
		assert.equal(imageBaseName('noext'), 'noext');
		assert.equal(imageBaseName('.png'), 'image');
		assert.equal(imageBaseName('  '), 'image');
	});
});
