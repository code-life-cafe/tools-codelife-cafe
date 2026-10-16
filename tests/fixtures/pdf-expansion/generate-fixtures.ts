// PDF圧縮・PDF→画像のテスト用PDFを決定的に生成する（個人情報を含まない合成データのみ）。
// 実行: node tests/fixtures/pdf-expansion/generate-fixtures.ts
//
// 生成物:
// - text-ja.pdf      … 3ページ（縦・横・縦）。非埋め込みの日本語CIDフォント（UniJIS-UCS2-H）、
//                      Helvetica、URIリンク注釈を含み、ページ内容は非圧縮ストリーム
// - rotated.pdf      … 200×100ptのページを /Rotate 0/90/180/270 で4ページ。
//                      回転前の左上に赤、右下に青の正方形（40pt）を描く
// - form.pdf         … テキスト入力フィールド付き
// - signed.pdf       … 署名フィールド（/FT /Sig）と署名辞書（/ByteRange）。オブジェクトストリームなし
// - signed-hidden.pdf … どこからも参照されない署名辞書だけを、圧縮オブジェクトストリーム内に持つ
// - compact.pdf      … pdf-libの既定保存（圧縮済み・オブジェクトストリーム）の1ページ
// - scan.pdf         … 150dpi相当のA4グレースケール画像（JPEG品質90）を全面に配置した2ページ
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	degrees,
	PDFDocument,
	PDFHexString,
	PDFName,
	PDFNumber,
	PDFString,
	StandardFonts,
} from 'pdf-lib';
import sharp from 'sharp';

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));
// pdf-libの既定では作成・更新日時が入るため、固定値で上書きして決定的にする
const FIXED_DATE = new Date('2026-10-14T00:00:00Z');

function fixDates(doc: PDFDocument) {
	doc.setCreationDate(FIXED_DATE);
	doc.setModificationDate(FIXED_DATE);
	doc.setProducer('tools.codelife.cafe test fixture');
	doc.setCreator('tools.codelife.cafe test fixture');
}

async function write(name: string, doc: PDFDocument, useObjectStreams = true) {
	fixDates(doc);
	const bytes = await doc.save({ useObjectStreams });
	fs.writeFileSync(path.join(OUT_DIR, name), bytes);
	console.log(`${name}: ${bytes.length} bytes`);
}

/** 文字列をUCS-2（BMP）の16進文字列にする */
function ucs2Hex(text: string): string {
	return [...text]
		.map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0'))
		.join('')
		.toUpperCase();
}

async function textJa() {
	const doc = await PDFDocument.create();
	const ctx = doc.context;
	const descriptor = ctx.register(
		ctx.obj({
			Type: 'FontDescriptor',
			FontName: 'KozMinPr6N-Regular',
			Flags: 6,
			FontBBox: [-437, -340, 1147, 1317],
			ItalicAngle: 0,
			Ascent: 880,
			Descent: -120,
			CapHeight: 742,
			StemV: 80,
		}),
	);
	const cidFont = ctx.register(
		ctx.obj({
			Type: 'Font',
			Subtype: 'CIDFontType0',
			BaseFont: 'KozMinPr6N-Regular',
			CIDSystemInfo: {
				Registry: PDFString.of('Adobe'),
				Ordering: PDFString.of('Japan1'),
				Supplement: 6,
			},
			FontDescriptor: descriptor,
			DW: 1000,
		}),
	);
	const jaFont = ctx.register(
		ctx.obj({
			Type: 'Font',
			Subtype: 'Type0',
			BaseFont: 'KozMinPr6N-Regular-UniJIS-UCS2-H',
			Encoding: 'UniJIS-UCS2-H',
			DescendantFonts: [cidFont],
		}),
	);
	const helvetica = ctx.register(
		ctx.obj({
			Type: 'Font',
			Subtype: 'Type1',
			BaseFont: 'Helvetica',
			Encoding: 'WinAnsiEncoding',
		}),
	);

	const sizes: Array<[number, number]> = [
		[595, 842],
		[842, 595],
		[595, 842],
	];
	for (const [index, [w, h]] of sizes.entries()) {
		const page = doc.addPage([w, h]);
		const lines: string[] = [
			'BT',
			`/FJ 24 Tf 50 ${h - 80} Td <${ucs2Hex('日本語テキストの抽出確認')}> Tj`,
			'ET',
			'BT',
			`/FH 14 Tf 50 ${h - 120} Td (Page ${index + 1} - Hello PDF link) Tj`,
			'ET',
		];
		// 同じ文言の繰り返しで、非圧縮ストリームの再圧縮効果を測れるようにする
		for (let row = 0; row < 24; row++) {
			lines.push(
				'BT',
				`/FJ 12 Tf 50 ${h - 160 - row * 16} Td <${ucs2Hex(`圧縮テスト用の本文です。行番号${row + 1}`)}> Tj`,
				'ET',
			);
		}
		const content = ctx.register(ctx.stream(lines.join('\n')));
		page.node.set(PDFName.of('Contents'), content);
		page.node.set(
			PDFName.of('Resources'),
			ctx.obj({ Font: { FJ: jaFont, FH: helvetica } }),
		);
		const link = ctx.register(
			ctx.obj({
				Type: 'Annot',
				Subtype: 'Link',
				Rect: [50, h - 125, 260, h - 105],
				Border: [0, 0, 0],
				A: {
					Type: 'Action',
					S: 'URI',
					URI: PDFString.of(`https://example.com/page-${index + 1}`),
				},
			}),
		);
		page.node.set(PDFName.of('Annots'), ctx.obj([link]));
	}
	doc.setTitle('日本語テスト');
	await write('text-ja.pdf', doc);
}

async function rotated() {
	const doc = await PDFDocument.create();
	for (const angle of [0, 90, 180, 270]) {
		const page = doc.addPage([200, 100]);
		page.setRotation(degrees(angle));
		const content = doc.context.register(
			doc.context.stream(
				['1 0 0 rg 0 60 40 40 re f', '0 0 1 rg 160 0 40 40 re f'].join('\n'),
			),
		);
		page.node.set(PDFName.of('Contents'), content);
	}
	await write('rotated.pdf', doc);
}

async function form() {
	const doc = await PDFDocument.create();
	const page = doc.addPage([595, 842]);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	page.drawText('Form sample', { x: 50, y: 780, size: 18, font });
	const field = doc.getForm().createTextField('name');
	field.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
	await write('form.pdf', doc);
}

async function signed() {
	const doc = await PDFDocument.create();
	const page = doc.addPage([595, 842]);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	page.drawText('Signed sample', { x: 50, y: 780, size: 18, font });
	const ctx = doc.context;
	const sig = ctx.register(
		ctx.obj({
			Type: 'Sig',
			Filter: 'Adobe.PPKLite',
			SubFilter: 'adbe.pkcs7.detached',
			ByteRange: [0, 0, 0, 0],
			Contents: PDFHexString.of('00'.repeat(64)),
		}),
	);
	const widget = ctx.register(
		ctx.obj({
			Type: 'Annot',
			Subtype: 'Widget',
			FT: 'Sig',
			T: PDFString.of('Signature1'),
			V: sig,
			Rect: [0, 0, 0, 0],
			F: 132,
			P: page.ref,
		}),
	);
	page.node.set(PDFName.of('Annots'), ctx.obj([widget]));
	doc.catalog.set(
		PDFName.of('AcroForm'),
		ctx.obj({ Fields: [widget], SigFlags: PDFNumber.of(3) }),
	);
	await write('signed.pdf', doc, false);
}

async function signedHidden() {
	const doc = await PDFDocument.create();
	const page = doc.addPage([595, 842]);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	page.drawText('Hidden signature dictionary', {
		x: 50,
		y: 780,
		size: 18,
		font,
	});
	// カタログからもページからも参照されない署名辞書（圧縮オブジェクトストリームに格納される）
	doc.context.register(
		doc.context.obj({
			Type: 'Sig',
			Filter: 'Adobe.PPKLite',
			ByteRange: [0, 0, 0, 0],
			Contents: PDFHexString.of('00'.repeat(64)),
		}),
	);
	await write('signed-hidden.pdf', doc, true);
}

async function compact() {
	const doc = await PDFDocument.create();
	const page = doc.addPage([595, 842]);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	page.drawText('Already compact', { x: 50, y: 780, size: 18, font });
	await write('compact.pdf', doc, true);
}

/** 疑似乱数（mulberry32）で決定的なノイズを作る */
function prng(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

async function scan() {
	const width = 1240;
	const height = 1754;
	const doc = await PDFDocument.create();
	for (const seed of [1, 2]) {
		const random = prng(seed);
		const pixels = Buffer.alloc(width * height);
		// 文字に見立てた 14×18px のセルごとに、塗るかどうかを先に決める
		const cellCols = Math.ceil(width / 14);
		const inkCells = Array.from(
			{ length: Math.ceil(height / 18) * cellCols },
			() => random() < 0.7,
		);
		for (let y = 0; y < height; y++) {
			// 紙のムラ（弱いノイズ）と、文字行に見立てた暗いブロック
			const lineIndex = Math.floor(y / 36);
			const inLine = y > 150 && y < 1600 && y % 36 < 18;
			for (let x = 0; x < width; x++) {
				let v = 236 + Math.floor(random() * 8) - 4;
				const cell = lineIndex * 2 * cellCols + Math.floor(x / 14);
				if (inLine && x > 120 && x < 1120 && x % 14 < 11 && inkCells[cell]) {
					v = 50;
				}
				pixels[y * width + x] = v;
			}
		}
		const jpeg = await sharp(pixels, { raw: { width, height, channels: 1 } })
			.jpeg({ quality: 90 })
			.toBuffer();
		const image = await doc.embedJpg(jpeg);
		const page = doc.addPage([595.28, 841.89]);
		page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
	}
	await write('scan.pdf', doc);
}

await textJa();
await rotated();
await form();
await signed();
await signedHidden();
await compact();
await scan();
