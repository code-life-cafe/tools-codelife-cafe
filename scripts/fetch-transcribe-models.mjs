// fetch-transcribe-models.mjs
// /transcribe のモデル実体を public/models/transcribe/ へ取得する（ローカル開発・スモークテスト用）。
//
// 本番は Cloudflare R2 →（同一オリジン）/models/transcribe/ プロキシで配信する。
// 開発時は public/ 配下に置くことで同じ URL 構造を再現できる。
// public/models/transcribe/ は .gitignore 対象（数百MBのためリポジトリに含めない）。
//
// 取得元・ファイル・sha256 は src/lib/transcribe/model-manifest.ts が正本。
// マニフェストに無いファイルは取得しない。sha256 不一致は失敗として扱う。
//
// 使い方:
//   node scripts/fetch-transcribe-models.mjs                  # tiny のみ（既定）
//   node scripts/fetch-transcribe-models.mjs --model base
//   node scripts/fetch-transcribe-models.mjs --model all
//   node scripts/fetch-transcribe-models.mjs --device all     # wasm/webgpu 両方の ONNX を取得
//   node scripts/fetch-transcribe-models.mjs --verify         # 既存ファイルの検証のみ

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MODEL_ARTIFACTS,
	MODEL_BASE_PATH,
} from '../src/lib/transcribe/model-manifest.ts';
import { requiredFiles } from '../src/lib/transcribe/models.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST_ROOT = join(ROOT, 'public', MODEL_BASE_PATH.replace(/^\/|\/$/g, ''));
const HF = 'https://huggingface.co';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const modelArg = arg('model', 'tiny');
const deviceArg = arg('device', 'wasm');
const verifyOnly = process.argv.includes('--verify');

const targets =
	modelArg === 'all'
		? MODEL_ARTIFACTS
		: MODEL_ARTIFACTS.filter((m) => m.id === modelArg);
if (targets.length === 0) {
	console.error(`未知のモデルID: ${modelArg}（tiny / base / small / all）`);
	process.exit(1);
}

/** 指定デバイスで実際にロードされる ONNX だけに絞る（config / tokenizer は常に対象） */
function wantedFiles(model) {
	if (deviceArg === 'all') return model.files;
	return requiredFiles(model, deviceArg === 'webgpu' ? 'webgpu' : 'wasm');
}

async function sha256File(path) {
	try {
		const buf = await readFile(path);
		return {
			sha256: createHash('sha256').update(buf).digest('hex'),
			bytes: buf.length,
		};
	} catch {
		return null;
	}
}

let downloaded = 0;
let skipped = 0;
const failures = [];

for (const model of targets) {
	const files = wantedFiles(model);
	console.log(
		`\n=== ${model.sourceRepository} @ ${model.revision} (${files.length} files) ===`,
	);
	for (const file of files) {
		const dest = join(DEST_ROOT, model.repositoryPath, file.path);
		const existing = await sha256File(dest);
		if (existing && existing.sha256 === file.sha256) {
			skipped++;
			continue;
		}
		if (verifyOnly) {
			failures.push(
				`${model.repositoryPath}${file.path}: ${existing ? 'sha256 不一致' : '未取得'}`,
			);
			continue;
		}

		const url = `${HF}/${model.sourceRepository}/resolve/${model.revision}/${file.path}`;
		process.stdout.write(`  ${file.path} … `);
		const res = await fetch(url);
		if (!res.ok) {
			failures.push(`${file.path}: GET ${url} -> ${res.status}`);
			console.log(`NG (${res.status})`);
			continue;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		const sha256 = createHash('sha256').update(buf).digest('hex');
		if (buf.length !== file.bytes || sha256 !== file.sha256) {
			failures.push(
				`${file.path}: マニフェスト不一致 bytes=${buf.length}/${file.bytes}`,
			);
			console.log('NG (hash)');
			continue;
		}
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, buf);
		downloaded++;
		console.log(`OK (${(buf.length / 1048576).toFixed(1)}MB)`);
	}
}

if (failures.length > 0) {
	console.error('\n[fetch-transcribe-models] 失敗:');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}

console.log(
	`\n[fetch-transcribe-models] 完了: 取得 ${downloaded} / 検証済みスキップ ${skipped} → ${DEST_ROOT}`,
);
