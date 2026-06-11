// zip.ts — 無圧縮（stored）ZIP 書き込みのゼロ依存純TS実装
// CRC32 は hash.ts の実装を再利用する。圧縮（deflate）は行わない（画像は既に圧縮済み）。
// ファイル名は UTF-8 フラグ（general purpose bit 11）を立てて格納し、日本語名でも
// Windows / macOS 標準の解凍で文字化けしないようにする。

import { createCrc32 } from './hash.ts';

export interface ZipEntry {
	name: string;
	data: Blob | Uint8Array;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

// general purpose bit flag: bit 11 を立てるとファイル名/コメントが UTF-8 とみなされる
const UTF8_FLAG = 0x0800;
// stored（無圧縮）
const METHOD_STORED = 0;
// version needed to extract: 2.0
const VERSION = 20;
// 固定 DOS 日時（1980-01-01 00:00:00）。出力を決定的にするため日時は埋め込まない
const DOS_DATE_1980 = 0x21;
const DOS_TIME_ZERO = 0x00;

/** バイト列の CRC32 を符号なし32bit整数で返す（hash.ts の実装を数値化して再利用） */
export function crc32Of(bytes: Uint8Array): number {
	const hasher = createCrc32();
	hasher.update(bytes);
	return Number.parseInt(hasher.digest(), 16) >>> 0;
}

// 返り値は ArrayBuffer 裏付けを保証する（BlobPart 互換・SharedArrayBuffer を排除）
async function toBytes(
	data: Blob | Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
	if (data instanceof Uint8Array) return new Uint8Array(data);
	return new Uint8Array(await data.arrayBuffer());
}

/**
 * 同名エントリに `_2`, `_3` ... を付与して一意化する（拡張子の前に挿入）。
 * 例: `a.jpg`, `a.jpg` → `a.jpg`, `a_2.jpg`
 */
export function dedupeZipNames(names: readonly string[]): string[] {
	const used = new Set<string>();
	return names.map((name) => {
		if (!used.has(name)) {
			used.add(name);
			return name;
		}
		const dot = name.lastIndexOf('.');
		const base = dot > 0 ? name.slice(0, dot) : name;
		const ext = dot > 0 ? name.slice(dot) : '';
		let counter = 2;
		let candidate = `${base}_${counter}${ext}`;
		while (used.has(candidate)) {
			counter++;
			candidate = `${base}_${counter}${ext}`;
		}
		used.add(candidate);
		return candidate;
	});
}

/**
 * stored 方式の ZIP を生成する。
 * 構造: [ローカルファイルヘッダ + データ] × N → [中央ディレクトリヘッダ] × N → EOCD。
 */
export async function buildZip(entries: readonly ZipEntry[]): Promise<Blob> {
	const encoder = new TextEncoder();
	const localParts: Uint8Array<ArrayBuffer>[] = [];
	const centralParts: Uint8Array<ArrayBuffer>[] = [];
	let offset = 0;
	let centralSize = 0;

	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const data = await toBytes(entry.data);
		const crc = crc32Of(data);
		const size = data.length;

		// --- ローカルファイルヘッダ（30バイト + ファイル名） ---
		const local = new Uint8Array(30 + nameBytes.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, LOCAL_FILE_HEADER_SIG, true);
		lv.setUint16(4, VERSION, true);
		lv.setUint16(6, UTF8_FLAG, true);
		lv.setUint16(8, METHOD_STORED, true);
		lv.setUint16(10, DOS_TIME_ZERO, true);
		lv.setUint16(12, DOS_DATE_1980, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, size, true); // compressed size（stored なので同じ）
		lv.setUint32(22, size, true); // uncompressed size
		lv.setUint16(26, nameBytes.length, true);
		lv.setUint16(28, 0, true); // extra field length
		local.set(nameBytes, 30);

		localParts.push(local, data);

		// --- 中央ディレクトリヘッダ（46バイト + ファイル名） ---
		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, CENTRAL_DIR_HEADER_SIG, true);
		cv.setUint16(4, VERSION, true); // version made by
		cv.setUint16(6, VERSION, true); // version needed
		cv.setUint16(8, UTF8_FLAG, true);
		cv.setUint16(10, METHOD_STORED, true);
		cv.setUint16(12, DOS_TIME_ZERO, true);
		cv.setUint16(14, DOS_DATE_1980, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, size, true);
		cv.setUint32(24, size, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint16(30, 0, true); // extra field length
		cv.setUint16(32, 0, true); // file comment length
		cv.setUint16(34, 0, true); // disk number start
		cv.setUint16(36, 0, true); // internal file attributes
		cv.setUint32(38, 0, true); // external file attributes
		cv.setUint32(42, offset, true); // relative offset of local header
		central.set(nameBytes, 46);

		centralParts.push(central);
		offset += local.length + data.length;
		centralSize += central.length;
	}

	// --- EOCD（End Of Central Directory, 22バイト） ---
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, EOCD_SIG, true);
	ev.setUint16(4, 0, true); // number of this disk
	ev.setUint16(6, 0, true); // disk where central directory starts
	ev.setUint16(8, entries.length, true); // CD records on this disk
	ev.setUint16(10, entries.length, true); // total CD records
	ev.setUint32(12, centralSize, true); // size of central directory
	ev.setUint32(16, offset, true); // offset of start of central directory
	ev.setUint16(20, 0, true); // comment length

	return new Blob([...localParts, ...centralParts, eocd], {
		type: 'application/zip',
	});
}
