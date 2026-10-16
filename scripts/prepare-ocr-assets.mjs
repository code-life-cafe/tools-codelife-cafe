// prepare-ocr-assets.mjs
// /image-ocr が使うOCR資産（Worker・core・言語データ・ライセンス）を public/ へ配置する。
//
// 利用時のCDN取得は不可のため、準備時だけ公式配布元（npm レジストリ / tessdata_fast の固定コミット）へ接続し、
// 取得物を src/lib/ocr/assets.ts のマニフェスト（sha256）で検証してから書き出す。不一致は exit 1。
// public/vendor/ocr/ と public/models/ocr/ の固定資産は、既存CIで配信できるようコミットする。
//
// 使い方:
//   node scripts/prepare-ocr-assets.mjs           # 取得して配置する
//   node scripts/prepare-ocr-assets.mjs --check   # 配置済みファイルの検証のみ（接続しない）

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
	NPM_PACKAGES,
	OCR_MODEL_BASE_PATH,
	OCR_MODEL_FILES,
	OCR_VENDOR_BASE_PATH,
	OCR_VENDOR_FILES,
} from '../src/lib/ocr/assets.ts';
import { OCR_THIRD_PARTY_LICENSES } from '../src/lib/ocr/licenses.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** tar（ustar）から指定パスのファイル本体を取り出す */
function extractTarEntry(tar, wanted) {
	let offset = 0;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) break;
		const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
		const size = Number.parseInt(
			header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim(),
			8,
		);
		const body = offset + 512;
		if (name === wanted) return tar.subarray(body, body + size);
		offset = body + Math.ceil(size / 512) * 512;
	}
	throw new Error(`tarball 内に ${wanted} がありません`);
}

async function download(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${url}`);
	return Buffer.from(await res.arrayBuffer());
}

function verify(label, buf, file) {
	const actual = sha256(buf);
	if (buf.length !== file.bytes || actual !== file.sha256) {
		throw new Error(
			`${label}: 検証失敗（bytes ${buf.length}/${file.bytes}, sha256 ${actual}）`,
		);
	}
}

let failed = false;
const destRoot = (base) => join(ROOT, 'public', base.replace(/^\/|\/$/g, ''));

async function checkOrWrite(base, file, getBuffer) {
	const dest = join(destRoot(base), file.path);
	const label = `${base}${file.path}`;
	try {
		if (checkOnly) {
			verify(label, await readFile(dest), file);
		} else {
			const buf = await getBuffer();
			verify(label, buf, file);
			await mkdir(dirname(dest), { recursive: true });
			await writeFile(dest, buf);
		}
		console.log(`OK   ${label} (${file.bytes} bytes)`);
	} catch (error) {
		failed = true;
		console.error(`FAIL ${label}: ${error.message}`);
	}
}

// npm tarball は1度だけ取得し、sha256 / sha512 integrity の両方を検証する
const tarballs = new Map();
async function tarballOf(pkgName) {
	if (!tarballs.has(pkgName)) {
		tarballs.set(
			pkgName,
			(async () => {
				const pkg = NPM_PACKAGES[pkgName];
				const gz = await download(pkg.tarball);
				const integrity = `sha512-${createHash('sha512').update(gz).digest('base64')}`;
				if (sha256(gz) !== pkg.sha256 || integrity !== pkg.integrity) {
					throw new Error(`${pkgName}@${pkg.version} の tarball 検証失敗`);
				}
				return gunzipSync(gz);
			})(),
		);
	}
	return tarballs.get(pkgName);
}

for (const file of OCR_VENDOR_FILES) {
	await checkOrWrite(OCR_VENDOR_BASE_PATH, file, async () =>
		Buffer.from(extractTarEntry(await tarballOf(file.package), file.source)),
	);
}
for (const file of OCR_MODEL_FILES) {
	await checkOrWrite(OCR_MODEL_BASE_PATH, file, () => download(file.source));
}

// 原文ライセンスも配布物として固定し、取得時・オフライン検査時の両方で照合する。
for (const file of OCR_THIRD_PARTY_LICENSES) {
 await checkOrWrite(OCR_VENDOR_BASE_PATH, file, async () => {
  const bytes = await download(file.source);
  if ('member' in file) {
   const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
   if (integrity !== file.integrity) throw new Error('ライセンス配布元のintegrityが一致しません');
   return Buffer.from(extractTarEntry(gunzipSync(bytes), file.member));
  }
  return bytes;
 });
}

if (failed) process.exit(1);
console.log(checkOnly ? '検証完了' : '配置完了');
