// verify-transcribe-delivery.mjs
// /transcribe の実配信を検証する（Phase A2 のリリースゲート）。
//
// レビューで合意したリリース条件を実行可能な形にしたもの:
//   1. 全モデルファイル + ONNX Runtime WASM を HEAD し、
//      200 / Content-Length / Content-Type / Cache-Control を確認する
//   2. スモークテストで実際に使う tiny の WebGPU / WASM 成果物は、
//      配信レスポンスを取得して SHA-256 をマニフェストと照合する
//   3. --full を付けると全ファイルの SHA-256 を照合する（転送量に注意）
//
// Content-Length の一致だけでは、同じサイズの破損ファイルや誤った内容を検出できない。
// `immutable` で1年配るため、誤配信は長期間残る。だから最低限 tiny は中身まで見る。
//
// 使い方:
//   node scripts/verify-transcribe-delivery.mjs
//   node scripts/verify-transcribe-delivery.mjs --base http://localhost:4321
//   node scripts/verify-transcribe-delivery.mjs --sha tiny,base
//   node scripts/verify-transcribe-delivery.mjs --full
//
// 注意: `astro preview` に対して実行すると Cache-Control と .onnx の Content-Type が
// 必ず NG になる（`public/_headers` と Pages Function はローカルプレビューでは効かない）。
// ステータスと Content-Length、SHA-256 の照合はローカルでも有効。
// ヘッダーまで含めた判定は **デプロイ済み環境に対して** 実行すること。
//
// 将来の改善: R2 オブジェクトへマニフェストの SHA-256 をカスタムメタデータとして保存し、
// HEAD だけで内容まで照合できるようにする（転送量ゼロで完全性を確認できる）。

import { createHash } from 'node:crypto';
import {
	MODEL_ARTIFACTS,
	MODEL_BASE_PATH,
	ONNX_WASM_BASE_PATH,
	RUNTIME_ARTIFACT,
} from '../src/lib/transcribe/model-manifest.ts';
import { requiredFiles } from '../src/lib/transcribe/models.ts';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const base = arg('base', 'https://tools.codelife.cafe').replace(/\/$/, '');
const full = process.argv.includes('--full');
const shaModels = new Set(
	full
		? MODEL_ARTIFACTS.map((m) => m.id)
		: arg('sha', 'tiny')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
);

/** 配信対象の一覧（モデルはデバイス両方ぶん、重複は除く） */
function buildTargets() {
	const targets = new Map();
	for (const model of MODEL_ARTIFACTS) {
		for (const device of ['wasm', 'webgpu']) {
			for (const file of requiredFiles(model, device)) {
				const url = `${base}${MODEL_BASE_PATH}${model.repositoryPath}${file.path}`;
				targets.set(url, {
					url,
					label: `${model.id}/${device} ${file.path}`,
					bytes: file.bytes,
					sha256: file.sha256,
					sha: shaModels.has(model.id),
				});
			}
		}
	}
	for (const file of RUNTIME_ARTIFACT.files) {
		const url = `${base}${ONNX_WASM_BASE_PATH}${file.path}`;
		targets.set(url, {
			url,
			label: `runtime ${file.path}`,
			bytes: file.bytes,
			sha256: file.sha256,
			// WASM ランタイムは全デバイス共通で必ず使うので常に中身まで見る
			sha: true,
		});
	}
	return [...targets.values()];
}

const targets = buildTargets();
const failures = [];
let headOk = 0;
let shaOk = 0;

console.log(`Base   : ${base}`);
console.log(`Targets: ${targets.length}`);
console.log(
	`SHA-256: ${full ? '全ファイル' : `${[...shaModels].join(', ')} + runtime`}`,
);
console.log('');

for (const target of targets) {
	const problems = [];
	let head;
	try {
		head = await fetch(target.url, {
			method: 'HEAD',
			redirect: 'manual',
			// 圧縮されると Content-Length が実体サイズと合わなくなる（Cloudflare は
			// HEAD で 0 や欠落を返すことがある）。素のサイズを見るため identity を要求する。
			headers: { 'Accept-Encoding': 'identity' },
		});
	} catch (error) {
		failures.push(`${target.label}: HEAD 失敗 ${String(error)}`);
		console.log(`  NG   ${target.label}`);
		continue;
	}

	if (head.status !== 200) problems.push(`status=${head.status}`);

	const rawLength = head.headers.get('content-length');
	let lengthVerified = false;
	if (rawLength === null || rawLength === '' || rawLength === '0') {
		// Pages の静的配信は圧縮・チャンク転送で Content-Length を返さないことがある。
		// その場合は SHA-256 照合（実体を GET する）でサイズも確認する。
		if (!target.sha) {
			problems.push('Content-Length なし（SHA-256 照合の対象外）');
		}
	} else if (Number(rawLength) !== target.bytes) {
		problems.push(`Content-Length=${rawLength} 期待=${target.bytes}`);
	} else {
		lengthVerified = true;
	}

	const contentType = head.headers.get('content-type') ?? '';
	if (!contentType) {
		problems.push('Content-Type なし');
	} else if (contentType.includes('text/html')) {
		// SPA フォールバックや 404 ページが返っている
		problems.push(`Content-Type=${contentType}`);
	}

	const cacheControl = head.headers.get('cache-control') ?? '';
	if (!cacheControl.includes('immutable')) {
		problems.push(`Cache-Control=${cacheControl || 'なし'}`);
	}

	if (problems.length === 0) headOk++;

	// ヘッダーの問題があっても中身は確認する（ヘッダー不備で完全性チェックを飛ばさない）
	if (target.sha && head.status === 200) {
		const res = await fetch(target.url);
		const buffer = Buffer.from(await res.arrayBuffer());
		const sha256 = createHash('sha256').update(buffer).digest('hex');
		if (buffer.length !== target.bytes) {
			problems.push(`本文サイズ=${buffer.length} 期待=${target.bytes}`);
		} else if (sha256 !== target.sha256) {
			problems.push(`SHA-256 不一致 ${sha256.slice(0, 12)}…`);
		} else {
			shaOk++;
		}
	}

	if (problems.length > 0) {
		failures.push(`${target.label}: ${problems.join(' / ')}`);
		console.log(`  NG   ${target.label} — ${problems.join(' / ')}`);
	} else {
		const how = target.sha
			? 'sha256'
			: lengthVerified
				? 'content-length'
				: 'headers';
		console.log(`  OK   ${target.label} (${how})`);
	}
}

console.log('');
console.log(
	`HEAD 合格 ${headOk}/${targets.length} / SHA-256 照合 ${shaOk} 件`,
);

if (failures.length > 0) {
	console.error('');
	console.error('[verify-transcribe-delivery] 失敗:');
	for (const f of failures) console.error(`  - ${f}`);
	console.error('');
	console.error(
		'503（Model storage is not configured）の場合は Pages の R2 バインディング未反映、',
	);
	console.error(
		'404 の場合は R2 へ revision 付きキーが配置されていない可能性があります。',
	);
	process.exit(1);
}

console.log('[verify-transcribe-delivery] すべて合格しました');
