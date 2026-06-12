import Encoding from 'encoding-japanese';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Use process.cwd() since __dirname might not exist in ESM
const fixturesDir = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
if (!fs.existsSync(fixturesDir)) {
	fs.mkdirSync(fixturesDir, { recursive: true });
}

const data = `名前,金額,日付,部署,役職,備考
山田太郎,1000,2026-03-11,営業部,部長,新規顧客開拓に貢献
佐藤花子,2500,2026-03-12,開発部,マネージャー,フロントエンドの再構築を担当
鈴木一郎,1500,2026-03-13,人事部,主任,採用プロセスの改善提案を提出
高橋恵理,3200,2026-03-14,総務部,一般,オフィス環境の整備プロジェクト進行中
田中健太,2100,2026-03-15,経理部,課長,月次決算の早期化を実現
`;

// 1. SJIS
fs.writeFileSync(
	path.join(fixturesDir, 'shift_jis.csv'),
	Buffer.from(
		Encoding.convert(Encoding.stringToCode(data), {
			to: 'SJIS',
			from: 'UNICODE',
			type: 'array',
		}),
	),
);

// 2. UTF-8 (no BOM)
fs.writeFileSync(
	path.join(fixturesDir, 'utf8_no_bom.csv'),
	Buffer.from(data, 'utf8'),
);

// 3. UTF-8 (with BOM)
const utf8Bytes = Array.from(Buffer.from(data, 'utf8'));
const bom = [0xef, 0xbb, 0xbf];
fs.writeFileSync(
	path.join(fixturesDir, 'utf8_bom.csv'),
	Buffer.from([...bom, ...utf8Bytes]),
);

// 4. EUC-JP
fs.writeFileSync(
	path.join(fixturesDir, 'euc_jp.csv'),
	Buffer.from(
		Encoding.convert(Encoding.stringToCode(data), {
			to: 'EUCJP',
			from: 'UNICODE',
			type: 'array',
		}),
	),
);

// 5. Invalid Excel (just a renamed text file)
fs.writeFileSync(
	path.join(fixturesDir, 'invalid.xlsx'),
	Buffer.from('This is not an excel file'),
);

// 6. 画像ツールE2E用の決定論的PNG（依存追加なしの手書きエンコーダ）
//    PNGは可逆圧縮のため、ここで指定したピクセル値がブラウザのgetImageDataでそのまま読める

function crc32(buf: Buffer): number {
	let table = crc32.table;
	if (!table) {
		table = new Int32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			}
			table[n] = c;
		}
		crc32.table = table;
	}
	let crc = -1;
	for (const byte of buf) {
		crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
	}
	return (crc ^ -1) >>> 0;
}
crc32.table = null as Int32Array | null;

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

function makePng(
	width: number,
	height: number,
	pixelAt: (x: number, y: number) => [number, number, number, number],
): Buffer {
	const signature = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type: RGBA
	// compression / filter / interlace = 0

	// 各行の先頭に filter byte 0 (None) を付けた生ピクセル列
	const raw = Buffer.alloc(height * (1 + width * 4));
	let offset = 0;
	for (let y = 0; y < height; y++) {
		raw[offset++] = 0;
		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = pixelAt(x, y);
			raw[offset++] = r;
			raw[offset++] = g;
			raw[offset++] = b;
			raw[offset++] = a;
		}
	}

	return Buffer.concat([
		signature,
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', zlib.deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

// 400×300 白地 + (100,80)〜(219,169) に赤 [220,40,40] の矩形
// 赤/白の境界をまたいでマスクをかけると平均色が両者と異なる値になり、ピクセル検証が確実になる
fs.writeFileSync(
	path.join(fixturesDir, 'sample-400x300.png'),
	makePng(400, 300, (x, y) =>
		x >= 100 && x < 220 && y >= 80 && y < 170
			? [220, 40, 40, 255]
			: [255, 255, 255, 255],
	),
);

// 6b. 画像圧縮ツールE2E用の透過PNG（透過→JPEG変換の背景塗り・複数ファイルZIP用）
//     120×90: 全面透過 + 中央 (40,30)〜(79,59) に不透明の青 [40,80,220]
fs.writeFileSync(
	path.join(fixturesDir, 'compress-alpha.png'),
	makePng(120, 90, (x, y) =>
		x >= 40 && x < 80 && y >= 30 && y < 60 ? [40, 80, 220, 255] : [0, 0, 0, 0],
	),
);

// 7. ハッシュツール用の固定内容テキスト（期待ハッシュ値が決定的になる）
// 内容を変更すると tests/e2e/hash.spec.ts の期待値も更新が必要
fs.writeFileSync(
	path.join(fixturesDir, 'hash-sample.txt'),
	Buffer.from('CODE:LIFE hash fixture v1\n', 'utf8'),
);

// 8. PDFツールE2E用の決定的PDF（pdf-lib・固定日時でバイト列を安定させる）
//    各ページに「Page N」テキストを描画する。暗号化PDF（encrypted.pdf）は
//    pdf-lib では生成できないため scripts/generate-encrypted-fixture.ts を使う。
async function makePdf(
	nPages: number,
	size: [number, number],
): Promise<Buffer> {
	const { PDFDocument, StandardFonts } = await import('pdf-lib');
	const doc = await PDFDocument.create();
	doc.setCreationDate(new Date(0));
	doc.setModificationDate(new Date(0));
	doc.setProducer('tools.codelife.cafe fixtures');
	const font = await doc.embedFont(StandardFonts.Helvetica);
	for (let i = 0; i < nPages; i++) {
		const page = doc.addPage(size);
		page.drawText(`Page ${i + 1}`, { x: 30, y: 100, size: 24, font });
	}
	return Buffer.from(await doc.save());
}

// ページサイズを変えてあるのは、結合順のE2E検証を先頭ページの寸法で行うため
// （pdf-lib にはテキスト抽出APIがない）
const pdfTargets: Array<[string, number, [number, number]]> = [
	['sample-3pages.pdf', 3, [300, 200]],
	['sample-5pages.pdf', 5, [400, 300]],
];
for (const [name, pages, size] of pdfTargets) {
	fs.writeFileSync(path.join(fixturesDir, name), await makePdf(pages, size));
}

console.log('Fixtures generated successfully.');
