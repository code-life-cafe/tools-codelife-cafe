// generate-heic-fixture.ts — E2E用の決定的な HEIC フィクスチャを生成する。
//
// 実行方法: npx tsx scripts/generate-heic-fixture.ts
//
// sharp / ImageMagick の同梱 libheif は HEVC エンコーダ（x265）を持たず HEIC を出力できないため、
// ffmpeg(libx265) で単一フレームの HEVC を生成し、最小の HEIF(heic) コンテナへ手書きでラップする。
// 生成物は libheif-js でデコード可能（image-convert の HEIC デコード経路と同一）であることを
// scripts/.cache 等で確認済み。出力は決定的（固定サイズ・固定描画）。
//
// ※ ffmpeg(libx265) が必要。CI ではこのスクリプトを実行せず、生成済み .heic をそのまま使う。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const fixturesDir = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
const WIDTH = 64;
const HEIGHT = 48;

const u8 = (...n: number[]): Buffer => Buffer.from(n);
const u16 = (n: number): Buffer => {
	const b = Buffer.alloc(2);
	b.writeUInt16BE(n);
	return b;
};
const u32 = (n: number): Buffer => {
	const b = Buffer.alloc(4);
	b.writeUInt32BE(n >>> 0);
	return b;
};
const str = (s: string): Buffer => Buffer.from(s, 'latin1');
const box = (type: string, ...parts: Buffer[]): Buffer => {
	const body = Buffer.concat(parts);
	return Buffer.concat([u32(body.length + 8), str(type), body]);
};
const fullbox = (
	type: string,
	version: number,
	flags: number,
	...parts: Buffer[]
): Buffer =>
	box(
		type,
		u8(version),
		u8((flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff),
		...parts,
	);

/** Annex-B バイト列を NAL 単位へ分解する */
function splitNals(buf: Buffer): Buffer[] {
	const starts: Array<{ pos: number; scLen: number }> = [];
	let i = 0;
	while (i + 3 < buf.length) {
		if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
			starts.push({ pos: i + 3, scLen: 3 });
			i += 3;
		} else if (
			buf[i] === 0 &&
			buf[i + 1] === 0 &&
			buf[i + 2] === 0 &&
			buf[i + 3] === 1
		) {
			starts.push({ pos: i + 4, scLen: 4 });
			i += 4;
		} else i++;
	}
	const nals: Buffer[] = [];
	for (let s = 0; s < starts.length; s++) {
		const start = starts[s].pos;
		const end =
			s + 1 < starts.length
				? starts[s + 1].pos - starts[s + 1].scLen
				: buf.length;
		nals.push(buf.subarray(start, end));
	}
	return nals;
}
const nalType = (nal: Buffer): number => (nal[0] >> 1) & 0x3f;

async function main(): Promise<void> {
	// 1) ソース画像（赤地＋中央の青矩形）→ PNG → HEVC(annexb)
	const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const i = (y * WIDTH + x) * 3;
			const blue = x >= 20 && x < 44 && y >= 14 && y < 34;
			raw[i] = blue ? 40 : 200;
			raw[i + 1] = blue ? 80 : 60;
			raw[i + 2] = blue ? 220 : 60;
		}
	}
	const png = await sharp(raw, {
		raw: { width: WIDTH, height: HEIGHT, channels: 3 },
	})
		.png()
		.toBuffer();

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heic-fixture-'));
	const pngPath = path.join(tmpDir, 'src.png');
	const hevcPath = path.join(tmpDir, 'src.hevc');
	fs.writeFileSync(pngPath, png);
	execFileSync('ffmpeg', [
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-i',
		pngPath,
		'-frames:v',
		'1',
		'-c:v',
		'libx265',
		'-x265-params',
		'info=0:log-level=none',
		'-pix_fmt',
		'yuv420p',
		hevcPath,
	]);
	const hevc = fs.readFileSync(hevcPath);
	fs.rmSync(tmpDir, { recursive: true, force: true });

	// 2) NAL 分解（VPS/SPS/PPS/スライス）
	const nals = splitNals(hevc);
	const vps = nals.find((n) => nalType(n) === 32);
	const sps = nals.find((n) => nalType(n) === 33);
	const pps = nals.find((n) => nalType(n) === 34);
	const slices = nals.filter((n) => nalType(n) <= 31);
	if (!vps || !sps || !pps || slices.length === 0) {
		throw new Error('HEVC の NAL（VPS/SPS/PPS/スライス）が揃っていません。');
	}

	// 3) hvcC（profile_tier_level は SPS から抽出）
	const sp = sps.subarray(2); // NAL ヘッダ2バイトを除いた payload
	const generalByte = sp[1];
	const compat = sp.subarray(2, 6);
	const constraint = sp.subarray(6, 12);
	const levelIdc = sp[12];
	const nalArray = (type: number, nal: Buffer): Buffer =>
		Buffer.concat([u8(type), u16(1), u16(nal.length), nal]);
	const hvcC = box(
		'hvcC',
		u8(1), // configurationVersion
		u8(generalByte),
		compat,
		constraint,
		u8(levelIdc),
		u8(0xf0, 0x00), // min_spatial_segmentation_idc=0
		u8(0xfc), // parallelismType=0
		u8(0xfd), // chromaFormat=1 (4:2:0)
		u8(0xf8), // bitDepthLumaMinus8=0
		u8(0xf8), // bitDepthChromaMinus8=0
		u16(0), // avgFrameRate
		u8(0x0f), // cfr=0,numTempLayers=1,nested=1,lengthSizeMinus1=3
		u8(3), // numOfArrays
		nalArray(32, vps),
		nalArray(33, sps),
		nalArray(34, pps),
	);

	// 4) HEIF メタ構造
	const ispe = fullbox('ispe', 0, 0, u32(WIDTH), u32(HEIGHT));
	const ipco = box('ipco', ispe, hvcC); // property 1=ispe, 2=hvcC
	const ipma = fullbox('ipma', 0, 0, u32(1), u16(1), u8(2), u8(0x01), u8(0x82)); // item1 ← ispe(1), hvcC(2,essential)
	const iprp = box('iprp', ipco, ipma);
	const hdlr = fullbox(
		'hdlr',
		0,
		0,
		u32(0),
		str('pict'),
		u32(0),
		u32(0),
		u32(0),
		u8(0),
	);
	const pitm = fullbox('pitm', 0, 0, u16(1));
	const infe = fullbox('infe', 2, 0, u16(1), u16(0), str('hvc1'), u8(0));
	const iinf = fullbox('iinf', 0, 0, u16(1), infe);

	const mdatData = Buffer.concat(
		slices.map((s) => Buffer.concat([u32(s.length), s])),
	);
	const buildIloc = (dataOffset: number): Buffer =>
		fullbox(
			'iloc',
			0,
			0,
			u8(0x44), // offset_size=4, length_size=4
			u8(0x00), // base_offset_size=0
			u16(1), // item_count
			u16(1), // item_ID
			u16(0), // data_reference_index
			u16(1), // extent_count
			u32(dataOffset),
			u32(mdatData.length),
		);

	const ftyp = box('ftyp', str('heic'), u32(0), str('mif1'), str('heic'));
	// meta サイズは iloc の値に依らず一定 → 2パスでオフセット確定
	const metaTmp = fullbox('meta', 0, 0, hdlr, pitm, iinf, iprp, buildIloc(0));
	const dataOffset = ftyp.length + metaTmp.length + 8; // +8 = mdat ヘッダ
	const meta = fullbox(
		'meta',
		0,
		0,
		hdlr,
		pitm,
		iinf,
		iprp,
		buildIloc(dataOffset),
	);
	const mdat = box('mdat', mdatData);
	const heic = Buffer.concat([ftyp, meta, mdat]);

	const outPath = path.join(fixturesDir, 'convert-sample.heic');
	fs.writeFileSync(outPath, heic);
	console.log(
		`convert-sample.heic を生成しました（${heic.length} bytes, ${WIDTH}x${HEIGHT}, brand=heic）。`,
	);
}

main().catch((err) => {
	console.error('HEIC フィクスチャ生成に失敗:', err.message);
	process.exit(1);
});
