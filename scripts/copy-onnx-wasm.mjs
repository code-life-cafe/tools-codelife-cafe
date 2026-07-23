// copy-onnx-wasm.mjs
// ONNX Runtime Web の WASM 一式を public/vendor/onnx-wasm/ へ配置する。
//
// なぜ必要か:
//   transformers.js は import 時に wasmPaths を cdn.jsdelivr.net の URL で自動設定する。
//   /transcribe は「同一オリジン以外への通信禁止」が不変条件のため、自サイト配下へ固定する。
//   その配布実体をここで用意する（public/vendor/ は .gitignore 対象＝リポジトリに含めない）。
//
// 版ずれ検出:
//   @huggingface/transformers が解決している onnxruntime-web のバージョンと sha256 が
//   src/lib/transcribe/model-manifest.ts の RUNTIME_ARTIFACT と一致しない場合は exit 1。
//   （JS 側と WASM 側の版ずれは実行時に不可解なクラッシュになるため CI で落とす）
//
// 使い方:
//   node scripts/copy-onnx-wasm.mjs           # 配置する
//   node scripts/copy-onnx-wasm.mjs --check   # 検証のみ（コピーしない）

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../src/lib/transcribe/model-manifest.ts';
import { resolveRuntimePaths } from './lib/onnx-runtime-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 配信パスにバージョンが入るため、public 配下も同じ構造で置く
// （固定 URL の内容を差し替えないので `immutable` を安全に付けられる）
const DEST = join(ROOT, 'public', ...ONNX_WASM_BASE_PATH.split('/').filter(Boolean));
const checkOnly = process.argv.includes('--check');

const { transformersVersion, onnxRuntimeVersion, ortDist } =
	await resolveRuntimePaths(ROOT);

const problems = [];

if (transformersVersion !== RUNTIME_ARTIFACT.transformersVersion) {
	problems.push(
		`transformers.js の版ずれ: installed=${transformersVersion} manifest=${RUNTIME_ARTIFACT.transformersVersion}`,
	);
}
if (onnxRuntimeVersion !== RUNTIME_ARTIFACT.onnxRuntimeVersion) {
	problems.push(
		`onnxruntime-web の版ずれ: installed=${onnxRuntimeVersion} manifest=${RUNTIME_ARTIFACT.onnxRuntimeVersion}`,
	);
}

if (!checkOnly) await mkdir(DEST, { recursive: true });

for (const file of RUNTIME_ARTIFACT.files) {
	let buf;
	try {
		buf = await readFile(join(ortDist, file.path));
	} catch {
		problems.push(`${file.path}: onnxruntime-web の dist に存在しません`);
		continue;
	}
	const sha256 = createHash('sha256').update(buf).digest('hex');
	if (buf.length !== file.bytes || sha256 !== file.sha256) {
		problems.push(
			`${file.path}: マニフェスト不一致 bytes=${buf.length}/${file.bytes} sha256=${sha256.slice(0, 12)}…/${file.sha256.slice(0, 12)}…`,
		);
		continue;
	}
	if (!checkOnly) {
		await writeFile(join(DEST, file.path), buf);
		console.log(`  ${file.path} (${(buf.length / 1048576).toFixed(1)}MB)`);
	}
}

if (problems.length > 0) {
	console.error('\n[copy-onnx-wasm] マニフェストと実体が一致しません:');
	for (const p of problems) console.error(`  - ${p}`);
	console.error(
		'\nライブラリを更新した場合は node scripts/generate-transcribe-manifest.mjs を再実行し、' +
			'生成された model-manifest.ts をコミットしてください。',
	);
	process.exit(1);
}

console.log(
	checkOnly
		? `[copy-onnx-wasm] OK: onnxruntime-web ${onnxRuntimeVersion} がマニフェストと一致`
		: `[copy-onnx-wasm] 配置完了: ${DEST} (onnxruntime-web ${onnxRuntimeVersion})`,
);
