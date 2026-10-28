import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	assertAllowedBaseUrl,
	checkHttp,
	summarize,
	waitForBuildInfo,
} from '../../scripts/lib/production-smoke.mjs';
import { buildInfo } from '../../scripts/write-build-info.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const BASE = 'https://tools.codelife.cafe';
const res = (status: number, body?: unknown) =>
	new Response(body === undefined ? null : JSON.stringify(body), { status });

test('公開URLは固定のホストだけ許可し、他のホスト・http・パス付き・資格情報付きは拒否する', () => {
	assert.equal(assertAllowedBaseUrl(BASE), BASE);
	assert.equal(
		assertAllowedBaseUrl('https://54676359.tools-codelife-cafe.pages.dev'),
		'https://54676359.tools-codelife-cafe.pages.dev',
	);
	for (const bad of [
		'http://tools.codelife.cafe',
		'https://evil.example',
		'https://tools.codelife.cafe.evil.example',
		'https://tools.codelife.cafe/wordcloud/',
		'https://user:pw@tools.codelife.cafe',
		'https://tools.codelife.cafe:8443',
		'http://localhost:4321',
		'not a url',
	]) {
		assert.throws(() => assertAllowedBaseUrl(bad), /URL|ホスト/, bad);
	}
	assert.equal(
		assertAllowedBaseUrl('http://localhost:4321', { allowLocal: true }),
		'http://localhost:4321',
	);
	assert.throws(() =>
		assertAllowedBaseUrl('http://evil.example', { allowLocal: true }),
	);
});

test('HTTPは200だけ成功（リダイレクト・5xxは失敗）', async () => {
	assert.equal(
		(await checkHttp({ url: BASE, fetchImpl: async () => res(200) as never }))
			.ok,
		true,
	);
	assert.equal(
		(await checkHttp({ url: BASE, fetchImpl: async () => res(302) as never }))
			.ok,
		false,
	);
	assert.equal(
		(await checkHttp({ url: BASE, fetchImpl: async () => res(503) as never }))
			.ok,
		false,
	);
});

const wait = (fetchImpl: unknown, attempts = 3) =>
	waitForBuildInfo({
		fetchImpl: fetchImpl as never,
		baseUrl: BASE,
		expectedSha: SHA,
		runId: '9',
		runAttempt: '1',
		attempts,
		intervalMs: 0,
		sleep: async () => {},
	});

test('公開SHAが期待SHAに一致するまで再試行し、一致したら成功', async () => {
	let n = 0;
	const r = await wait(async () =>
		++n < 3 ? res(200, { sha: OTHER }) : res(200, { sha: SHA }),
	);
	assert.equal(r.ok, true);
	assert.equal(r.history.length, 3);
});

test('旧SHAのまま・404・通信失敗・形式不明は失敗（公開確認失敗として扱う）', async () => {
	assert.equal((await wait(async () => res(200, { sha: OTHER }))).ok, false);
	assert.equal((await wait(async () => res(404))).ok, false);
	assert.equal((await wait(async () => res(200, { notSha: 1 }))).ok, false);
	const r = await wait(async () => {
		throw new Error('ECONNRESET');
	});
	assert.equal(r.ok, false);
	assert.match(String(r.history[0].error), /ECONNRESET/);
});

test('期待SHAが不正なら例外（SHA証明なしで成功にしない）', async () => {
	await assert.rejects(
		waitForBuildInfo({
			fetchImpl: (async () => res(200, { sha: SHA })) as never,
			baseUrl: BASE,
			expectedSha: '',
			runId: '1',
			runAttempt: '1',
			attempts: 1,
			sleep: async () => {},
		}),
		/EXPECTED_SHA/,
	);
});

test('キャッシュを避けるため毎回別のクエリを付けて取得する', async () => {
	const urls: string[] = [];
	await wait(async (u: string) => {
		urls.push(u);
		return res(200, { sha: OTHER });
	});
	assert.equal(new Set(urls).size, 3);
});

test('build-info は40桁SHAのときだけ生成され、CLIはdist配下にJSONを書く', () => {
	assert.deepEqual(
		buildInfo({ GITHUB_SHA: SHA, GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '2' }),
		{ sha: SHA, runId: '1', runAttempt: '2' },
	);
	assert.throws(() => buildInfo({ GITHUB_SHA: 'abc' }));
	assert.throws(() => buildInfo({}));
	const dir = mkdtempSync(join(tmpdir(), 'bi-'));
	execFileSync(process.execPath, ['scripts/write-build-info.mjs', dir], {
		env: {
			...process.env,
			GITHUB_SHA: SHA,
			GITHUB_RUN_ID: '7',
			GITHUB_RUN_ATTEMPT: '1',
		},
	});
	assert.deepEqual(
		JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf-8')),
		{ sha: SHA, runId: '7', runAttempt: '1' },
	);
});

test('summarize は run ID・SHA・操作結果を含み、失敗を成功と書かない', () => {
	const ok = summarize({
		ok: true,
		baseUrl: BASE,
		expectedSha: SHA,
		runId: '9',
		runAttempt: '1',
		http: { status: 200 },
		buildInfo: { matched: { sha: SHA }, history: [1] },
		operation: { ok: true },
	});
	assert.match(ok, /成功/);
	assert.match(ok, new RegExp(SHA));
	const ng = summarize({
		ok: false,
		baseUrl: BASE,
		expectedSha: SHA,
		runId: '9',
		runAttempt: '1',
		http: { status: 200 },
		buildInfo: { matched: null, history: [1] },
		operation: { ok: false, error: 'x' },
	});
	assert.match(ng, /失敗/);
	assert.doesNotMatch(ng, /公開後smoke: 成功/);
});
