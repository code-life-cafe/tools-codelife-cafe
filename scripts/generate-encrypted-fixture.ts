// generate-encrypted-fixture.ts — テスト用の暗号化PDFフィクスチャを決定的に生成する
// PDF 1.4 標準セキュリティハンドラ（R=2, V=1, RC4 40-bit）を最小実装で適用した
// 1ページPDFを tests/e2e/fixtures/encrypted.pdf に書き出す。
// パスワード: user / owner ともに "test"。
// 実行: npx tsx scripts/generate-encrypted-fixture.ts（node --experimental-strip-types でも可）
//
// pdf-lib は暗号化PDFの生成に対応していないため、本スクリプトで自前生成する。
// CI ではこのPDFを復号せず、loadPdfInfo() が encrypted: true を返すことのみ検証する。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// PDF仕様 7.6.3.3 のパディング定数（32バイト）
const PAD = Uint8Array.from([
	0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
	0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
	0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const PASSWORD = 'test';
// 全許可（rev2 では下位ビットのみ意味を持つ）。符号付き32bit表現で -4
const PERMISSIONS = -4 >>> 0;
// 決定的なファイルID（16バイト固定値）
const FILE_ID = Uint8Array.from(
	Array.from({ length: 16 }, (_, i) => (i * 17 + 1) & 0xff),
);

function md5(...parts: Uint8Array[]): Uint8Array {
	const h = createHash('md5');
	for (const p of parts) h.update(p);
	return new Uint8Array(h.digest());
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
	const s = Array.from({ length: 256 }, (_, i) => i);
	let j = 0;
	for (let i = 0; i < 256; i++) {
		j = (j + s[i] + key[i % key.length]) & 0xff;
		[s[i], s[j]] = [s[j], s[i]];
	}
	const out = new Uint8Array(data.length);
	let a = 0;
	let b = 0;
	for (let k = 0; k < data.length; k++) {
		a = (a + 1) & 0xff;
		b = (b + s[a]) & 0xff;
		[s[a], s[b]] = [s[b], s[a]];
		out[k] = data[k] ^ s[(s[a] + s[b]) & 0xff];
	}
	return out;
}

function padPassword(password: string): Uint8Array {
	const bytes = new TextEncoder().encode(password);
	const padded = new Uint8Array(32);
	padded.set(bytes.subarray(0, 32));
	padded.set(PAD.subarray(0, 32 - Math.min(bytes.length, 32)), bytes.length);
	return padded;
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// --- 標準セキュリティハンドラ（R=2）の O / U / 暗号化キー計算 ---
const paddedUser = padPassword(PASSWORD);
const paddedOwner = padPassword(PASSWORD);

// Algorithm 3: O 値 = RC4(MD5(paddedOwner)[0..5], paddedUser)
const oValue = rc4(md5(paddedOwner).subarray(0, 5), paddedUser);

// Algorithm 2: 暗号化キー = MD5(paddedUser + O + P(LE 4bytes) + ID)[0..5]
const pBytes = new Uint8Array(4);
new DataView(pBytes.buffer).setUint32(0, PERMISSIONS, true);
const fileKey = md5(paddedUser, oValue, pBytes, FILE_ID).subarray(0, 5);

// Algorithm 4: U 値 = RC4(fileKey, PAD)
const uValue = rc4(fileKey, PAD);

// オブジェクト単位のRC4キー: MD5(fileKey + objNum(LE 3bytes) + genNum(LE 2bytes))[0..10]
function objectKey(objNum: number): Uint8Array {
	const ext = new Uint8Array(5);
	ext[0] = objNum & 0xff;
	ext[1] = (objNum >> 8) & 0xff;
	ext[2] = (objNum >> 16) & 0xff;
	// gen は 0 固定
	return md5(fileKey, ext).subarray(0, Math.min(fileKey.length + 5, 16));
}

// --- PDF 本体の組み立て ---
const encoder = new TextEncoder();
const contentStream = rc4(
	objectKey(4),
	encoder.encode('BT /F1 24 Tf 72 720 Td (Encrypted) Tj ET'),
);

const objects: Array<{ num: number; body: Uint8Array }> = [
	{ num: 1, body: encoder.encode('<< /Type /Catalog /Pages 2 0 R >>') },
	{ num: 2, body: encoder.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') },
	{
		num: 3,
		body: encoder.encode(
			'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		),
	},
	{
		num: 4,
		body: Uint8Array.from([
			...encoder.encode(`<< /Length ${contentStream.length} >>\nstream\n`),
			...contentStream,
			...encoder.encode('\nendstream'),
		]),
	},
	{
		num: 5,
		body: encoder.encode(
			'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		),
	},
	{
		num: 6,
		body: encoder.encode(
			`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${toHex(oValue)}> /U <${toHex(uValue)}> /P ${PERMISSIONS | 0} >>`,
		),
	},
];

const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n')];
let offset = parts[0].length;
const offsets: number[] = [];
for (const obj of objects) {
	offsets.push(offset);
	const chunk = Uint8Array.from([
		...encoder.encode(`${obj.num} 0 obj\n`),
		...obj.body,
		...encoder.encode('\nendobj\n'),
	]);
	parts.push(chunk);
	offset += chunk.length;
}

const xrefOffset = offset;
const xrefLines = [
	'xref',
	`0 ${objects.length + 1}`,
	'0000000000 65535 f ',
	...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
];
const idHex = toHex(FILE_ID);
const trailer = [
	'trailer',
	`<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${idHex}> <${idHex}>] >>`,
	'startxref',
	String(xrefOffset),
	'%%EOF',
];
parts.push(encoder.encode(`${[...xrefLines, ...trailer].join('\n')}\n`));

const out = Buffer.concat(parts.map((p) => Buffer.from(p)));
const dest = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'encrypted.pdf',
);
fs.writeFileSync(dest, out);
console.log(`written: ${dest} (${out.length} bytes)`);
