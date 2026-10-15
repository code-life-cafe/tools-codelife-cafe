// PDF→テキスト抽出のテスト用PDFを決定的に生成する（個人情報を含まない合成データのみ）。
// 実行: node tests/fixtures/pdf-expansion/generate-text-fixtures.ts
// 既存の generate-fixtures.ts の出力（text-ja.pdf 等）は変更しない。
//
// 生成物:
// - text-lines.pdf   … 1ページ。同一行を複数のtext itemに分割し、2行目→1行目の順で描画（座標順の確認用）
// - text-rotated.pdf … 200×100ptを /Rotate 0/90/180/270 で4ページ。表示上は常に横書きになるよう
//                      文字を逆回転して描画した「Rotation <角度> ABC」「回転<角度>度」の2行
// - text-layout.pdf  … 4ページ。1:2段組み（行ごとに左右を交互に描画） 2:表 3:縦書き(UniJIS-UCS2-V) 4:ルビ
// - text-mixed.pdf   … 4ページ。1:文字 2:白紙 3:画像のみ 4:文字＋画像
// - text-empty.pdf   … 白紙2ページ（全ページ文字なし）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	degrees,
	PDFDocument,
	PDFName,
	PDFString,
	StandardFonts,
} from 'pdf-lib';
import sharp from 'sharp';

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXED_DATE = new Date('2026-10-14T00:00:00Z');

async function write(name: string, doc: PDFDocument) {
	doc.setCreationDate(FIXED_DATE);
	doc.setModificationDate(FIXED_DATE);
	doc.setProducer('tools.codelife.cafe test fixture');
	doc.setCreator('tools.codelife.cafe test fixture');
	const bytes = await doc.save({ useObjectStreams: false });
	fs.writeFileSync(path.join(OUT_DIR, name), bytes);
	console.log(`${name}: ${bytes.length} bytes`);
}

function ucs2Hex(text: string): string {
	return [...text]
		.map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0'))
		.join('')
		.toUpperCase();
}

/** 非埋め込みの日本語CIDフォント（H=横書き / V=縦書き）とHelveticaを文書に登録する */
function registerFonts(doc: PDFDocument) {
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
	const type0 = (encoding: string) =>
		ctx.register(
			ctx.obj({
				Type: 'Font',
				Subtype: 'Type0',
				BaseFont: `KozMinPr6N-Regular-${encoding}`,
				Encoding: encoding,
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
	return {
		FJ: type0('UniJIS-UCS2-H'),
		FV: type0('UniJIS-UCS2-V'),
		FH: helvetica,
	};
}

type Fonts = ReturnType<typeof registerFonts>;
type Run = {
	font: 'FJ' | 'FV' | 'FH';
	size: number;
	/** ページ上の位置（ユーザー空間） */
	x: number;
	y: number;
	text: string;
	/** テキスト行列の回転（度、反時計回り） */
	angle?: number;
};

function show(run: Run): string[] {
	const body = run.font === 'FH' ? `(${run.text})` : `<${ucs2Hex(run.text)}>`;
	const rad = ((run.angle ?? 0) * Math.PI) / 180;
	const c = Math.round(Math.cos(rad) * 1e6) / 1e6;
	const s = Math.round(Math.sin(rad) * 1e6) / 1e6;
	return [
		'BT',
		`/${run.font} ${run.size} Tf`,
		`${c} ${s} ${-s} ${c} ${run.x} ${run.y} Tm`,
		`${body} Tj`,
		'ET',
	];
}

function setContent(
	doc: PDFDocument,
	page: ReturnType<PDFDocument['addPage']>,
	fonts: Fonts,
	lines: string[],
) {
	const ctx = doc.context;
	page.node.set(
		PDFName.of('Contents'),
		ctx.register(ctx.stream(lines.join('\n'))),
	);
	page.node.set(PDFName.of('Resources'), ctx.obj({ Font: fonts }));
}

/** Helvetica の文字列幅（pt） */
async function helveticaWidth(text: string, size: number) {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	return font.widthOfTextAtSize(text, size);
}

async function textLines() {
	const doc = await PDFDocument.create();
	const fonts = registerFonts(doc);
	const page = doc.addPage([595, 842]);
	const w = (t: string) => helveticaWidth(t, 12);
	const lines: string[] = [];
	// 2行目（下）を先に描画。英語1文を3つに、日本語1文を2つに分割して置く
	const second = 'Second line: ';
	lines.push(
		...show({ font: 'FH', size: 12, x: 50, y: 680, text: second }),
		...show({
			font: 'FJ',
			size: 12,
			x: 50 + (await w(second)),
			y: 680,
			text: '句読点、です。',
		}),
	);
	// 1行目（上）: 「Hello」「World」の語間は空白幅、「日本」「語です。」は隙間なし
	lines.push(
		...show({
			font: 'FH',
			size: 12,
			x: 50 + (await w('Hello ')),
			y: 700,
			text: 'World',
		}),
		...show({ font: 'FH', size: 12, x: 50, y: 700, text: 'Hello' }),
		...show({
			font: 'FJ',
			size: 12,
			x: 50 + (await w('Hello World')),
			y: 700,
			text: '日本',
		}),
		...show({
			font: 'FJ',
			size: 12,
			x: 50 + (await w('Hello World')) + 24,
			y: 700,
			text: '語です。',
		}),
	);
	setContent(doc, page, fonts, lines);
	await write('text-lines.pdf', doc);
}

async function textRotated() {
	const doc = await PDFDocument.create();
	const fonts = registerFonts(doc);
	const W = 200;
	const H = 100;
	for (const angle of [0, 90, 180, 270]) {
		const page = doc.addPage([W, H]);
		page.setRotation(degrees(angle));
		// 表示座標（右・下向き、回転後）の点 (X, Y) を回転前のユーザー空間へ戻す
		const place = (X: number, Y: number): [number, number] => {
			if (angle === 90) return [Y, X];
			if (angle === 180) return [W - X, Y];
			if (angle === 270) return [W - Y, H - X];
			return [X, H - Y];
		};
		const [x1, y1] = place(10, 30);
		const [x2, y2] = place(10, 60);
		setContent(doc, page, fonts, [
			...show({
				font: 'FH',
				size: 10,
				x: x1,
				y: y1,
				angle,
				text: `Rotation ${angle} ABC`,
			}),
			...show({
				font: 'FJ',
				size: 10,
				x: x2,
				y: y2,
				angle,
				text: `回転${angle}度`,
			}),
		]);
	}
	await write('text-rotated.pdf', doc);
}

async function textLayout() {
	const doc = await PDFDocument.create();
	const fonts = registerFonts(doc);

	// 1: 2段組み。左右を1行ずつ交互に描画（読み順＝左段全部→右段全部、とは限らない例）
	const columns = doc.addPage([595, 842]);
	const colLines: string[] = [];
	for (let row = 0; row < 3; row++) {
		colLines.push(
			...show({
				font: 'FJ',
				size: 12,
				x: 50,
				y: 780 - row * 20,
				text: `左段${row + 1}行目の文章`,
			}),
			...show({
				font: 'FJ',
				size: 12,
				x: 320,
				y: 780 - row * 20,
				text: `右段${row + 1}行目の文章`,
			}),
		);
	}
	setContent(doc, columns, fonts, colLines);

	// 2: 表。行ごとにセルを左から描画
	const table = doc.addPage([595, 842]);
	const tableLines: string[] = [];
	const rows = [
		['品名', '数量', '単価'],
		['りんご', '3', '120'],
		['みかん', '10', '80'],
	];
	for (const [r, cells] of rows.entries()) {
		for (const [c, cell] of cells.entries()) {
			tableLines.push(
				...show({
					font: 'FJ',
					size: 12,
					x: 50 + c * 150,
					y: 780 - r * 24,
					text: cell,
				}),
			);
		}
	}
	setContent(doc, table, fonts, tableLines);

	// 3: 縦書き（UniJIS-UCS2-V）。右端から下へ
	const vertical = doc.addPage([595, 842]);
	setContent(
		doc,
		vertical,
		fonts,
		show({ font: 'FV', size: 14, x: 500, y: 780, text: '縦書きの文章です' }),
	);

	// 4: ルビ。親文字の上に小さな文字を置く
	const ruby = doc.addPage([595, 842]);
	setContent(doc, ruby, fonts, [
		...show({ font: 'FJ', size: 14, x: 50, y: 700, text: '漢字' }),
		...show({ font: 'FJ', size: 7, x: 50, y: 716, text: 'かんじ' }),
	]);
	await write('text-layout.pdf', doc);
}

async function textMixed() {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const png = await sharp({
		create: {
			width: 120,
			height: 80,
			channels: 3,
			background: { r: 200, g: 30, b: 30 },
		},
	})
		.png()
		.toBuffer();
	const image = await doc.embedPng(png);
	const box = { x: 50, y: 600, width: 240, height: 160 };

	doc
		.addPage([595, 842])
		.drawText('Mixed page one', { x: 50, y: 780, size: 14, font });
	doc.addPage([595, 842]); // 白紙
	doc.addPage([595, 842]).drawImage(image, box); // 画像のみ
	const p4 = doc.addPage([595, 842]);
	p4.drawImage(image, box);
	p4.drawText('Mixed page four', { x: 50, y: 780, size: 14, font });
	await write('text-mixed.pdf', doc);
}

async function textEmpty() {
	const doc = await PDFDocument.create();
	doc.addPage([595, 842]);
	doc.addPage([595, 842]);
	await write('text-empty.pdf', doc);
}

await textLines();
await textRotated();
await textLayout();
await textMixed();
await textEmpty();
