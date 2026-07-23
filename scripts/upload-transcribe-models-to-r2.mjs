// upload-transcribe-models-to-r2.mjs
// /transcribe の Whisper ONNX モデルを Cloudflare R2 へアップロードする（Phase A2）。
//
// 前提:
//   1. モデル実体をローカルに取得済みであること
//        node scripts/fetch-transcribe-models.mjs --model all --device all
//   2. **実行するプラットフォームと同じ wrangler** が使えること
//      （WSL から Windows グローバルの wrangler を呼ぶと workerd のネイティブバイナリが
//        合わずに起動できない。WRANGLER_BIN で明示指定もできる）
//   3. その wrangler がログイン済みであること（wrangler login）
//      必要権限: Workers R2 Storage: Edit
//
// 使い方:
//   node scripts/upload-transcribe-models-to-r2.mjs codelife-models
//   node scripts/upload-transcribe-models-to-r2.mjs codelife-models --dry-run
//   node scripts/upload-transcribe-models-to-r2.mjs codelife-models --model tiny
//   WRANGLER_BIN=./node_modules/.bin/wrangler node scripts/upload-transcribe-models-to-r2.mjs codelife-models
//
// 配置キーは `transcribe/<model>/<path>`。ブラウザからは Pages Function
// （functions/models/transcribe/[[path]].ts）経由で同一オリジン
// /models/transcribe/<model>/<path> として配信される。
//
// マニフェスト（src/lib/transcribe/model-manifest.ts）に列挙されたファイルだけを送る。
// アップロード前に SHA-256 を再検証し、不一致なら中断する。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MODEL_ARTIFACTS,
	MODEL_BASE_PATH,
} from '../src/lib/transcribe/model-manifest.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = join(ROOT, 'public', MODEL_BASE_PATH.replace(/^\/|\/$/g, ''));
const R2_PREFIX = 'transcribe';

const args = process.argv.slice(2);
const bucket = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const modelArg = (() => {
	const i = args.indexOf('--model');
	return i >= 0 && args[i + 1] ? args[i + 1] : 'all';
})();

if (!bucket) {
	console.error(
		'使い方: node scripts/upload-transcribe-models-to-r2.mjs <BUCKET_NAME> [--model tiny|base|small|all] [--dry-run]',
	);
	process.exit(1);
}

const targets =
	modelArg === 'all'
		? MODEL_ARTIFACTS
		: MODEL_ARTIFACTS.filter((m) => m.id === modelArg);
if (targets.length === 0) {
	console.error(`未知のモデルID: ${modelArg}（tiny / base / small / all）`);
	process.exit(1);
}

const CONTENT_TYPES = { json: 'application/json', txt: 'text/plain' };
function contentTypeFor(path) {
	const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
	return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

// --- wrangler 実行 ---

const WRANGLER_BIN = process.env.WRANGLER_BIN ?? 'npx';
const WRANGLER_PREFIX = process.env.WRANGLER_BIN ? [] : ['--yes', 'wrangler'];

function runWrangler(wranglerArgs) {
	// .cmd / .ps1 のラッパ解決を OS のシェルに任せる（Windows / WSL / macOS 共通）
	const quoted = [...WRANGLER_PREFIX, ...wranglerArgs].map((a) =>
		/[\s"']/.test(a) ? JSON.stringify(a) : a,
	);
	return spawnSync(`${WRANGLER_BIN} ${quoted.join(' ')}`, {
		cwd: ROOT,
		shell: true,
		encoding: 'utf8',
	});
}

function explainWranglerFailure(result) {
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	if (/workerd/.test(output) && /platform/i.test(output)) {
		console.error(
			[
				'',
				'wrangler のネイティブバイナリ（workerd）が実行中のプラットフォームと一致していません。',
				'WSL から Windows 側にインストールした wrangler を呼ぶと必ずこの状態になります。',
				'',
				'対処のいずれかを選んでください:',
				'  A. Windows 側（PowerShell / Git Bash）でこのスクリプトを実行する',
				'  B. WSL 側に Linux 版を入れて使う:',
				'       npm i -D wrangler',
				'       WRANGLER_BIN=./node_modules/.bin/wrangler node scripts/upload-transcribe-models-to-r2.mjs ' +
					bucket,
				'',
			].join('\n'),
		);
	}
	return output;
}

// --- 事前チェック ---

console.log(`Bucket : ${bucket}`);
console.log(`Source : ${SRC_ROOT}`);
console.log(`Models : ${targets.map((m) => m.id).join(', ')}`);
console.log(`Mode   : ${dryRun ? 'dry-run（アップロードしない）' : 'upload'}`);
console.log('');

if (!dryRun) {
	const version = runWrangler(['--version']);
	if (version.status !== 0) {
		console.error('[upload] wrangler を実行できませんでした。');
		console.error(explainWranglerFailure(version).trim());
		process.exit(1);
	}
	console.log(`wrangler: ${(version.stdout ?? '').trim().split('\n').pop()}`);

	const who = runWrangler(['whoami']);
	if (who.status !== 0) {
		console.error(
			'[upload] wrangler がログインしていません。先に `wrangler login` を実行してください。',
		);
		console.error(explainWranglerFailure(who).trim());
		process.exit(1);
	}
	console.log('');
}

// --- アップロード ---

let uploaded = 0;
let totalBytes = 0;
const failures = [];

for (const model of targets) {
	console.log(`=== ${model.sourceRepository} @ ${model.revision} ===`);
	for (const file of model.files) {
		const relative = `${model.repositoryPath}${file.path}`;
		const localPath = join(SRC_ROOT, model.repositoryPath, file.path);
		const key = `${R2_PREFIX}/${relative}`;

		let buffer;
		try {
			buffer = await readFile(localPath);
		} catch {
			failures.push(
				`${relative}: ローカルに存在しません。先に node scripts/fetch-transcribe-models.mjs --model all --device all を実行してください`,
			);
			continue;
		}
		const sha256 = createHash('sha256').update(buffer).digest('hex');
		if (buffer.length !== file.bytes || sha256 !== file.sha256) {
			failures.push(
				`${relative}: マニフェスト不一致 bytes=${buffer.length}/${file.bytes}`,
			);
			continue;
		}

		const sizeLabel = `${(buffer.length / 1048576).toFixed(1)}MB`;
		if (dryRun) {
			console.log(`  [dry-run] r2://${bucket}/${key} (${sizeLabel})`);
			uploaded++;
			totalBytes += buffer.length;
			continue;
		}

		process.stdout.write(`  r2://${bucket}/${key} (${sizeLabel}) … `);
		const result = runWrangler([
			'r2',
			'object',
			'put',
			`${bucket}/${key}`,
			`--file=${localPath}`,
			`--content-type=${contentTypeFor(file.path)}`,
			'--remote',
		]);
		if (result.status !== 0) {
			console.log('NG');
			failures.push(`${relative}: ${explainWranglerFailure(result).trim()}`);
			continue;
		}
		console.log('OK');
		uploaded++;
		totalBytes += buffer.length;
	}
	console.log('');
}

if (failures.length > 0) {
	console.error('[upload] 失敗:');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}

console.log(
	`[upload] 完了: ${uploaded} オブジェクト / ${(totalBytes / 1048576).toFixed(0)}MB を r2://${bucket}/${R2_PREFIX}/ へ配置しました`,
);
console.log('');
console.log('検証:');
console.log('  1. Pages をデプロイして Function と R2 バインディングを反映する');
console.log(
	'  2. curl -I https://tools.codelife.cafe/models/transcribe/whisper-tiny/config.json',
);
console.log(
	'     → 200 / Content-Type: application/json / Cache-Control: immutable',
);
console.log(
	'  3. /transcribe を開き、DevTools Network でモデル取得が同一オリジンのみであることを確認する',
);
