// generate-transcribe-manifest.mjs
// /transcribe（ブラウザ内 Whisper 文字起こし）のモデル成果物マニフェストを生成する。
//
// 正本: https://app.notion.com/p/396dfd36033681cba834ecd64d6167b3 「詳細設計書 4.」
//
// 何をするか:
//   1. Hugging Face の onnx-community/whisper-{tiny,base,small} を **コミットハッシュ固定** で参照し、
//      配信対象ファイルの bytes と sha256 を確定する（.onnx は LFS の oid が sha256 そのもの。
//      LFS でない小さな JSON はダウンロードして実測ハッシュを取る）。
//   2. node_modules に実際にインストールされている onnxruntime-web（@huggingface/transformers が
//      解決している方）の WASM 一式のバージョン・bytes・sha256 を確定する。
//   3. src/lib/transcribe/model-manifest.ts を上書き生成する。
//
// 実行はビルド時ではなく手動（モデル・ランタイムを更新するときだけ）:
//   node scripts/generate-transcribe-manifest.mjs
//
// 生成物はコミットする。モデル実体（数百MB）はコミットしない。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ORT_WASM_FILES,
	resolveRuntimePaths,
} from './lib/onnx-runtime-paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'src', 'lib', 'transcribe', 'model-manifest.ts');

const HF = 'https://huggingface.co';

// --- モデル定義（revision はタグではなくコミットハッシュで固定する） ---
//
// dtype 方針（実機 Chromium + transformers.js 4.2.0 / onnxruntime-web 1.26.0-dev で実測。
// whisper-tiny の全 dtype を総当たりし、InferenceSession を作成できた組み合わせだけを採用した）:
//
//   device  dtype  結果
//   ------  -----  ----------------------------------------------------------------
//   wasm    q8     × ORT: qdq_actions.cc TransposeDQWeightsForMatMulNBits Missing required scale
//   wasm    int8   × 同上
//   wasm    uint8  × 同上
//   wasm    fp16   × ORT: graph_utils.cc GetIndexFromName（WASM は fp16 非対応）
//   wasm    q4     × TypeError: network error（ORT 内部で失敗。スタックなし）
//   wasm    fp32   ○ ただし small で 923MB になり配信・メモリともに非現実的
//   wasm    bnb4   ○ ← 採用（tiny 90MB / base 133MB / small 274MB）
//   webgpu  fp16   × TypeError: network error
//   webgpu  fp32   × 同上
//   webgpu  q8     ○ ← 採用（tiny 39MB / base 73MB / small 238MB）
//
// ライブラリを更新したら、この表を取り直してから dtype を変更すること。
const MODELS = [
	{
		id: 'tiny',
		modelId: 'whisper-tiny',
		sourceRepository: 'onnx-community/whisper-tiny',
		revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
	},
	{
		id: 'base',
		modelId: 'whisper-base',
		sourceRepository: 'onnx-community/whisper-base',
		revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
	},
	{
		id: 'small',
		modelId: 'whisper-small',
		sourceRepository: 'onnx-community/whisper-small',
		revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
	},
];

// 配信するファイル（マニフェスト外のファイルは配信も取得もしない）
const CONFIG_FILES = [
	'config.json',
	'generation_config.json',
	'preprocessor_config.json',
	'tokenizer.json',
	'tokenizer_config.json',
];

const DTYPE = { wasm: 'bnb4', webgpu: 'q8' };
// transformers.js の DEFAULT_DTYPE_SUFFIX_MAPPING と一致させること
const DTYPE_SUFFIX = {
	fp32: '',
	fp16: '_fp16',
	int8: '_int8',
	uint8: '_uint8',
	q8: '_quantized',
	q4: '_q4',
	bnb4: '_bnb4',
};

function onnxFilesFor() {
	const suffixes = [...new Set(Object.values(DTYPE))].map(
		(d) => DTYPE_SUFFIX[d],
	);
	return suffixes.flatMap((s) => [
		`onnx/encoder_model${s}.onnx`,
		`onnx/decoder_model_merged${s}.onnx`,
	]);
}

// openai/whisper（MIT）を ONNX 変換した onnx-community 版。派生物も MIT。
function licenseFor(model) {
	return {
		spdx: 'MIT',
		sourceUrl: `${HF}/${model.sourceRepository}`,
		noticePath: 'THIRD-PARTY-NOTICES.md',
	};
}

async function fetchJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
	return res.json();
}

async function sha256OfUrl(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

async function buildModel(model) {
	const wanted = new Set([...CONFIG_FILES, ...onnxFilesFor()]);
	// tree API は再帰取得しないため、ルートと onnx/ を個別に引く
	const tree = [
		...(await fetchJson(
			`${HF}/api/models/${model.sourceRepository}/tree/${model.revision}`,
		)),
		...(await fetchJson(
			`${HF}/api/models/${model.sourceRepository}/tree/${model.revision}/onnx`,
		)),
	];

	const files = [];
	for (const path of wanted) {
		const entry = tree.find((t) => t.path === path);
		if (!entry) {
			throw new Error(`${model.sourceRepository}: ${path} が revision に存在しません`);
		}
		if (entry.lfs?.oid) {
			// LFS ポインタの oid は対象ファイルの sha256 そのもの
			files.push({ path, bytes: entry.size, sha256: entry.lfs.oid });
			console.log(`  ${path} (lfs) ${entry.size}`);
		} else {
			const url = `${HF}/${model.sourceRepository}/resolve/${model.revision}/${path}`;
			const { sha256, bytes } = await sha256OfUrl(url);
			if (bytes !== entry.size) {
				throw new Error(`${path}: サイズ不一致 tree=${entry.size} body=${bytes}`);
			}
			files.push({ path, bytes, sha256 });
			console.log(`  ${path} (blob) ${bytes}`);
		}
	}

	files.sort((a, b) => a.path.localeCompare(b.path));
	return {
		id: model.id,
		modelId: model.modelId,
		sourceRepository: model.sourceRepository,
		revision: model.revision,
		repositoryPath: `${model.modelId}/`,
		dtype: DTYPE,
		license: licenseFor(model),
		files,
		totalBytes: files.reduce((s, f) => s + f.bytes, 0),
	};
}

async function buildRuntime() {
	const { transformersVersion, onnxRuntimeVersion, ortDist } =
		await resolveRuntimePaths(ROOT);

	const files = [];
	for (const name of ORT_WASM_FILES) {
		const buf = await readFile(join(ortDist, name));
		files.push({
			path: name,
			bytes: buf.length,
			sha256: createHash('sha256').update(buf).digest('hex'),
		});
		console.log(`  ${name} ${buf.length}`);
	}
	return { transformersVersion, onnxRuntimeVersion, files };
}

// Biome の整形規約（タブインデント・シングルクォート・識別子キーはクォートなし）に
// 合わせた TS リテラルを直接出力する（生成後に整形コマンドを走らせなくて済む）。
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function quote(str) {
	return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function ts(value, depth = 0) {
	const pad = '\t'.repeat(depth + 1);
	const closePad = '\t'.repeat(depth);
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		const items = value.map((v) => `${pad}${ts(v, depth + 1)},`).join('\n');
		return `[\n${items}\n${closePad}]`;
	}
	if (value && typeof value === 'object') {
		const keys = Object.keys(value);
		if (keys.length === 0) return '{}';
		const items = keys
			.map((k) => {
				const key = IDENT.test(k) ? k : quote(k);
				return `${pad}${key}: ${ts(value[k], depth + 1)},`;
			})
			.join('\n');
		return `{\n${items}\n${closePad}}`;
	}
	if (typeof value === 'string') return quote(value);
	return String(value);
}

const models = [];
for (const m of MODELS) {
	console.log(`=== ${m.sourceRepository} @ ${m.revision} ===`);
	models.push(await buildModel(m));
}
console.log('=== onnx runtime wasm ===');
const runtime = await buildRuntime();

const header = `// model-manifest.ts — /transcribe のモデル成果物マニフェスト（自動生成・手で編集しない）
//
// 生成: node scripts/generate-transcribe-manifest.mjs
// 正本: https://app.notion.com/p/396dfd36033681cba834ecd64d6167b3 「詳細設計書 4.」
//
// ここに列挙されたファイルだけを R2 / 同一オリジン \`/models/transcribe/\` から配信する。
// マニフェスト外のパス解決・Hugging Face へのフォールバックは禁止。
`;

const body = `${header}
export type ModelId = 'tiny' | 'base' | 'small';

/** transformers.js の DATA_TYPES のうち本ツールで使い得るもの */
export type DtypeName =
	| 'fp32'
	| 'fp16'
	| 'int8'
	| 'uint8'
	| 'q8'
	| 'q4'
	| 'bnb4';

export type ArtifactFile = {
	/** repositoryPath からの相対パス */
	path: string;
	bytes: number;
	/** 小文字16進の sha256 */
	sha256: string;
};

export type ModelArtifact = {
	id: ModelId;
	/** transformers.js の pipeline へ渡すモデルID（= 配信ディレクトリ名） */
	modelId: string;
	/** 変換元の正確なモデルID */
	sourceRepository: string;
	/** タグではなくコミットハッシュ */
	revision: string;
	/** /models/transcribe/ 配下の相対パス */
	repositoryPath: string;
	dtype: { webgpu: DtypeName; wasm: DtypeName };
	license: { spdx: string; sourceUrl: string; noticePath?: string };
	files: ArtifactFile[];
	totalBytes: number;
};

export type RuntimeArtifact = {
	transformersVersion: string;
	onnxRuntimeVersion: string;
	files: ArtifactFile[];
};

/** 同一オリジンのモデル配信ルート（Cloudflare 側で R2 へプロキシする） */
export const MODEL_BASE_PATH = '/models/transcribe/';

/** ONNX Runtime Web の WASM 配信ルート（CDN 既定へのフォールバックは禁止） */
export const ONNX_WASM_BASE_PATH = '/vendor/onnx-wasm/';

export const MODEL_ARTIFACTS: readonly ModelArtifact[] = ${ts(models)};

export const RUNTIME_ARTIFACT: RuntimeArtifact = ${ts(runtime)};

export const MODEL_IDS: readonly ModelId[] = MODEL_ARTIFACTS.map((m) => m.id);

export function getModelArtifact(id: ModelId): ModelArtifact {
	const artifact = MODEL_ARTIFACTS.find((m) => m.id === id);
	if (!artifact) throw new Error(\`未知のモデルIDです: \${id}\`);
	return artifact;
}

/**
 * 同一オリジン配信で許可するパス一覧（先頭スラッシュ付き）。
 * Pages Function / テストの許可リストはこれを正本とする。
 */
export function listAllowedModelPaths(): string[] {
	return MODEL_ARTIFACTS.flatMap((m) =>
		m.files.map((f) => \`\${MODEL_BASE_PATH}\${m.repositoryPath}\${f.path}\`),
	);
}

export function listAllowedRuntimePaths(): string[] {
	return RUNTIME_ARTIFACT.files.map((f) => \`\${ONNX_WASM_BASE_PATH}\${f.path}\`);
}
`;

await writeFile(OUT_PATH, body.replace(/\r\n/g, '\n'), 'utf8');
// 生成物も src/ 配下で `npm run lint` の対象になるため、Biome の整形を通しておく
execFileSync(
	process.execPath,
	[
		join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'),
		'check',
		'--write',
		OUT_PATH,
	],
	{ cwd: ROOT, stdio: 'inherit' },
);
console.log(`\n生成: ${OUT_PATH}`);
console.log(
	`models: ${models.map((m) => `${m.id}=${(m.totalBytes / 1048576).toFixed(1)}MB`).join(', ')}`,
);
console.log(
	`runtime: transformers.js ${runtime.transformersVersion} / onnxruntime-web ${runtime.onnxRuntimeVersion}`,
);
