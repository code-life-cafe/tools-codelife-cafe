#!/usr/bin/env node
// 公開物に build-info.json を追加する。npm run build の後、公開（pages deploy）の前に既存deployジョブから呼ぶ。
// 内容は公開リポジトリで既知のコミットSHAと実行IDだけ。秘密情報・ユーザー入力は含まない。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FULL_SHA = /^[0-9a-f]{40}$/;

export function buildInfo(env) {
	const sha = env.GITHUB_SHA ?? '';
	if (!FULL_SHA.test(sha))
		throw new Error('GITHUB_SHA が40桁の小文字16進ではありません');
	return {
		sha,
		runId: String(env.GITHUB_RUN_ID ?? ''),
		runAttempt: String(env.GITHUB_RUN_ATTEMPT ?? ''),
	};
}

const isMain =
	process.argv[1] &&
	import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
	const outDir = process.argv[2];
	if (!outDir) {
		console.error(
			'usage: node scripts/write-build-info.mjs <出力ディレクトリ(dist)>',
		);
		process.exit(2);
	}
	const info = buildInfo(process.env);
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, 'build-info.json'), `${JSON.stringify(info)}\n`);
	console.log(`build-info.json: ${JSON.stringify(info)}`);
}
