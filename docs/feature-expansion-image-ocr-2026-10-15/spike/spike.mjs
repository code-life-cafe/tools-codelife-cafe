// spike.mjs — OCR資産配信・精度・時間・中断のスパイク（実ブラウザ Worker で実行）
//
// 使い方:
//   node scripts/prepare-ocr-assets.mjs
//   node tests/fixtures/image-ocr/generate.mjs        # fixture（生成済みなら不要）
//   node docs/feature-expansion-image-ocr-2026-10-15/spike/spike.mjs <tesseract.esm.min.js のあるdir> [results.json]
//
// 現行 public/_headers の既定CSP（先頭ブロック）をそのまま付与して同一オリジン配信する。CSPは緩めない。
// 計測するのはこのスクリプトが出力した数値のみ。

import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from 'playwright';
import {
	OCR_MODEL_BASE_PATH,
	OCR_VENDOR_BASE_PATH,
} from '../../../src/lib/ocr/assets.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'image-ocr');
const libDir = process.argv[2];
const outFile = process.argv[3] ?? 'results.json';
if (!libDir) throw new Error('第1引数に tesseract.esm.min.js のあるディレクトリを指定');

// ---- 現行CSP（public/_headers の最初の /* ブロック）を再利用 ----
const headersText = await readFile(join(ROOT, 'public', '_headers'), 'utf8');
const grab = (name) =>
	headersText.match(new RegExp(`^\\s+${name}: (.+)$`, 'm'))?.[1].trim();
const CSP = grab('Content-Security-Policy');
const COOP = grab('Cross-Origin-Opener-Policy');
const COEP = grab('Cross-Origin-Embedder-Policy');

const MIME = {
	'.js': 'text/javascript',
	'.html': 'text/html; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.txt': 'text/plain',
	'.traineddata': 'application/octet-stream',
};
const served = [];
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = decodeURIComponent(url.pathname);
	let file;
	if (p === '/spike.html') file = join(dirname(fileURLToPath(import.meta.url)), 'spike.html');
	else if (p.startsWith('/spike-lib/')) file = join(libDir, p.slice(11));
	else if (p.startsWith('/fixtures/')) file = join(FIX, p.slice(10));
	else file = join(ROOT, 'public', p);
	try {
		await stat(file);
		let body = await readFile(file);
		if (p === '/spike.html') {
			const cfg = `<script>window.__cfg=${JSON.stringify({ vendor: OCR_VENDOR_BASE_PATH, models: OCR_MODEL_BASE_PATH })}</script>`;
			body = Buffer.from(cfg + body.toString('utf8'));
		}
		served.push({ path: p, bytes: body.length });
		res.writeHead(200, {
			'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
			'Content-Security-Policy': CSP,
			'Cross-Origin-Opener-Policy': COOP,
			'Cross-Origin-Embedder-Policy': COEP,
			'Cache-Control': 'no-store',
		});
		res.end(body);
	} catch {
		served.push({ path: p, bytes: 0, status: 404 });
		res.writeHead(404);
		res.end('not found');
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---- CER ----
const lev = (a, b) => {
	const A = [...a];
	const B = [...b];
	let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
	for (let i = 1; i <= A.length; i++) {
		const cur = [i];
		for (let j = 1; j <= B.length; j++) {
			cur[j] = Math.min(
				prev[j] + 1,
				cur[j - 1] + 1,
				prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1),
			);
		}
		prev = cur;
	}
	return prev[B.length];
};
// 事前規定の正規化: CRLF→LF と改行除去のみ（空白・Unicodeは変更しない）
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '');
// 参考値のみ: 全空白除去（合否判定には使わない）
const normNoSpace = (s) => norm(s).replace(/\s/g, '');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const manifest = JSON.parse(await readFile(join(FIX, 'manifest.json'), 'utf8'));
const truth = async (id) => readFile(join(FIX, 'truth', `${id}.txt`), 'utf8');
const only = process.env.STAGES?.split(',');
const log = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const T0 = Date.now();

const browser = await chromium.launch();
const results = {
	env: {
		node: process.version,
		chromium: browser.version(),
		cpu: os.cpus()[0].model,
		logicalCores: os.cpus().length,
		ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
		platform: `${os.platform()} ${os.release()}`,
	},
	csp: CSP,
	stages: {},
};
const save = () => writeFile(outFile, JSON.stringify(results, null, 2));

/** 外側timeout付き page.evaluate。超過時は例外（呼び出し側でcontextを閉じて復帰） */
function ev(page, fn, arg, ms, label) {
	let timer;
	const timeout = new Promise((_, rej) => {
		timer = setTimeout(() => rej(new Error(`TIMEOUT ${ms}ms: ${label}`)), ms);
	});
	log('→', label);
	return Promise.race([page.evaluate(fn, arg), timeout]).finally(() => clearTimeout(timer));
}

async function openPage() {
	const context = await browser.newContext();
	const page = await context.newPage();
	const requests = [];
	const failures = [];
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	const sizes = new Map();
	cdp.on('Network.requestWillBeSent', (e) => sizes.set(e.requestId, { url: e.request.url }));
	cdp.on('Network.loadingFinished', (e) => {
		const s = sizes.get(e.requestId);
		if (s) s.transfer = e.encodedDataLength;
	});
	const consoleErrors = [];
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') {
			consoleErrors.push(m.text());
			log('console', m.type(), m.text().slice(0, 200));
		}
	});
	page.on('pageerror', (e) => {
		consoleErrors.push(String(e));
		log('pageerror', String(e).slice(0, 200));
	});
	page.on('request', (r) => requests.push(r.url()));
	page.on('requestfailed', (r) => {
		failures.push(r.url());
		log('requestfailed', r.url().replace(ORIGIN, ''), r.failure()?.errorText);
	});
	page.on('response', (r) => {
		if (r.status() >= 400) log('HTTP', r.status(), r.url().replace(ORIGIN, ''));
	});
	page.on('worker', (w) => log('worker created', w.url().slice(0, 80)));
	await page.goto(`${ORIGIN}/spike.html`);
	await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
	return { context, page, requests, failures, sizes, consoleErrors };
}

async function stage(name, fn) {
	if (only && !only.includes(name)) return;
	log('== stage', name);
	try {
		results.stages[name] = await fn();
	} catch (e) {
		results.stages[name] = { error: String(e).slice(0, 300) };
		log('stage failed', name, String(e).slice(0, 200));
	}
	await save();
}

const INIT_MS = 30000;
const RECOG_MS = 120000;

// ---- 診断: 1 Worker 初期化 + 1 画像 ----
await stage('diag', async () => {
	const { context, page, requests, failures, sizes, consoleErrors } = await openPage();
	try {
		const init = await ev(page, () => window.spike.init({ langs: ['jpn', 'eng'] }), null, INIT_MS, 'init jpn+eng');
		const r = await ev(page, (u) => window.spike.recognize(u), '/fixtures/clear/01-meiryo-prose.png', RECOG_MS, 'recognize 01');
		return { init, recognizeMs: r.ms, text: r.text, requests: requests.map((u) => u.replace(ORIGIN, '')), failures, consoleErrors, served };
	} catch (e) {
		const events = await page.evaluate(() => window.spike.events()).catch(() => 'page unresponsive');
		return { error: String(e), requests: requests.map((u) => u.replace(ORIGIN, '')), failures, consoleErrors, events };
	} finally {
		await context.close().catch(() => {});
	}
});

// ---- 失敗系（早めに実施: errorHandlerで404がrejectされるか・復帰できるか） ----
await stage('missingModel', async () => {
	const { context, page, consoleErrors } = await openPage();
	try {
		const t0 = Date.now();
		const err = await ev(
			page,
			async () => {
				try {
					await window.spike.init({ langs: ['xxx'] });
					return 'no-error';
				} catch (e) {
					return `rejected: ${String(e).slice(0, 200)}`;
				}
			},
			null,
			INIT_MS,
			'init missing language (xxx)',
		);
		// 復帰: 同じページで正しい言語を再初期化できるか
		const ok = await ev(page, () => window.spike.init({ langs: ['eng'] }), null, INIT_MS, 'recover init eng');
		return { result: err, ms: Date.now() - t0, recoveredInit: ok, consoleErrors };
	} catch (e) {
		return { error: String(e), consoleErrors };
	} finally {
		await context.close().catch(() => {});
	}
});

// ---- 精度 + 配信 ----
await stage('accuracy', async () => {
	const { context, page, requests, failures, sizes, consoleErrors } = await openPage();
	try {
		const init = await ev(page, () => window.spike.init({ langs: ['jpn', 'eng'] }), null, INIT_MS, 'init');
		const perImage = [];
		for (const m of manifest.filter((x) => x.group !== 'perf')) {
			const r = await ev(page, (u) => window.spike.recognize(u), `/fixtures/${m.file}`, RECOG_MS, `recognize ${m.id}`);
			const t = await truth(m.id);
			const ref = norm(t);
			const dist = lev(ref, norm(r.text));
			const nsRef = [...normNoSpace(t)].length;
			const distNs = lev(normNoSpace(t), normNoSpace(r.text));
			perImage.push({
				id: m.id,
				group: m.group,
				font: m.font,
				refChars: [...ref].length,
				dist,
				cer: +(dist / [...ref].length).toFixed(4),
				refCharsNoSpace: nsRef,
				distNoSpace: distNs,
				cerNoSpaceReference: +(distNs / nsRef).toFixed(4),
				ms: r.ms,
				text: r.text,
			});
			results.stages.accuracy_partial = perImage.length;
		}
		const clear = perImage.filter((r) => r.group === 'clear');
		const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
		const origins = [...new Set(requests.map((u) => new URL(u).origin))];
		const assetRows = [...sizes.values()].filter((s) => /\/(vendor|models)\/ocr\//.test(s.url));
		return {
			init,
			clear: {
				images: clear.length,
				refChars: sum(clear, 'refChars'),
				dist: sum(clear, 'dist'),
				cer: +(sum(clear, 'dist') / sum(clear, 'refChars')).toFixed(4),
				cerWhitespaceStrippedReference: +(sum(clear, 'distNoSpace') / sum(clear, 'refCharsNoSpace')).toFixed(4),
			},
			perImage,
			delivery: {
				origins,
				allSameOrigin: origins.every((o) => o === ORIGIN || o.startsWith('blob:') || o.startsWith('data:')),
				assetRequests: assetRows.map((s) => ({ url: s.url.replace(ORIGIN, ''), transfer: s.transfer })),
				assetTransferBytes: assetRows.reduce((n, s) => n + (s.transfer ?? 0), 0),
				allRequests: requests.map((u) => u.replace(ORIGIN, '')),
				failures,
				consoleErrors,
			},
			storage: await page.evaluate(() => window.spike.storageState()),
		};
	} finally {
		await context.close().catch(() => {});
	}
});

// ---- 約3MP warm 3回 ----
await stage('perf', async () => {
	const { context, page } = await openPage();
	try {
		await ev(page, () => window.spike.init({ langs: ['jpn', 'eng'] }), null, INIT_MS, 'init');
		const meta = manifest.find((m) => m.group === 'perf');
		const url = `/fixtures/${meta.file}`;
		const dims = await page.evaluate(async (u) => {
			const bmp = await createImageBitmap(await (await fetch(u)).blob());
			return { w: bmp.width, h: bmp.height };
		}, url);
		await page.evaluate(() => window.spike.startLagProbe());
		const runs = [];
		for (let i = 0; i < 3; i++) {
			const r = await ev(page, (u) => window.spike.recognize(u), url, RECOG_MS, `perf run ${i + 1}`);
			const ref = norm(await truth(meta.id));
			runs.push({ ms: r.ms, cer: +(lev(ref, norm(r.text)) / [...ref].length).toFixed(4) });
		}
		const lag = await page.evaluate(() => window.spike.stopLagProbe());
		return {
			image: { ...dims, megapixels: +((dims.w * dims.h) / 1e6).toFixed(2), file: meta.file },
			runsMs: runs.map((r) => r.ms),
			cerPerRun: runs.map((r) => r.cer),
			medianMs: median(runs.map((r) => r.ms)),
			mainThreadMaxTimerLagMs: lag,
		};
	} finally {
		await context.close().catch(() => {});
	}
});

// ---- cancel / terminate ----
await stage('cancel', async () => {
	const { context, page } = await openPage();
	try {
		await ev(page, () => window.spike.init({ langs: ['jpn', 'eng'] }), null, INIT_MS, 'init');
		await page.evaluate(() => window.spike.startLagProbe());
		await page.evaluate((u) => window.spike.startRecognize(u), '/fixtures/perf/p1-3mp.png');
		await page.waitForTimeout(1500);
		const terminateMs = await ev(page, () => window.spike.terminate(), null, INIT_MS, 'terminate');
		const pending = await ev(page, () => window.spike.pendingState(), null, INIT_MS, 'pending state');
		const lag = await page.evaluate(() => window.spike.stopLagProbe());
		await ev(page, () => window.spike.init({ langs: ['eng'] }), null, INIT_MS, 're-init after terminate');
		const rerun = await ev(page, (u) => window.spike.recognize(u), '/fixtures/clear/07-meiryo-english.png', RECOG_MS, 'rerun');
		return {
			terminateAwaitedMs: terminateMs,
			pendingRecognizePromiseAfterTerminate: pending,
			mainThreadMaxTimerLagMs: lag,
			rerunAfterTerminateMs: rerun.ms,
			rerunLooksValid: rerun.text.includes('quick brown fox'),
		};
	} finally {
		await context.close().catch(() => {});
	}
});

// ---- core 経路（SIMD / 非SIMD） ----
await stage('corePaths', async () => {
	const out = {};
	for (const name of ['tesseract-core-relaxedsimd-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-lstm']) {
		const { context, page, requests, consoleErrors } = await openPage();
		try {
			await ev(page, (p) => window.spike.init({ langs: ['jpn', 'eng'], corePath: p }), `${OCR_VENDOR_BASE_PATH}core/${name}.wasm.js`, INIT_MS, `init ${name}`);
			const r = await ev(page, (u) => window.spike.recognize(u), '/fixtures/clear/01-meiryo-prose.png', RECOG_MS, `recognize via ${name}`);
			const ref = norm(await truth('01-meiryo-prose'));
			out[name] = {
				ok: true,
				ms: r.ms,
				cer: +(lev(ref, norm(r.text)) / [...ref].length).toFixed(4),
				coreRequests: requests.filter((u) => u.includes('/core/')).map((u) => u.replace(ORIGIN, '')),
			};
		} catch (e) {
			out[name] = { ok: false, error: String(e).slice(0, 200), consoleErrors };
		} finally {
			await context.close().catch(() => {});
		}
	}
	const { context, page, requests } = await openPage();
	try {
		await ev(page, () => window.spike.init({ langs: ['eng'] }), null, INIT_MS, 'init default detection');
		out.defaultDetectionLoaded = requests.filter((u) => u.includes('/core/')).map((u) => u.replace(ORIGIN, ''));
	} finally {
		await context.close().catch(() => {});
	}
	return out;
});

await browser.close();
server.close();
// サーバー側で実際に配信したバイト数（Workerのリクエストはページ側CDPに出ないため）。圧縮なしの実バイト
const perPath = new Map();
for (const s of served) {
	if (/\/(vendor|models)\/ocr\//.test(s.path)) {
		const e = perPath.get(s.path) ?? { path: s.path, bytes: s.bytes, requests: 0 };
		e.requests++;
		perPath.set(s.path, e);
	}
}
results.servedOcrAssets = [...perPath.values()];
await save();
log('done');
console.log(
	JSON.stringify(
		JSON.parse(JSON.stringify(results), (k, v) => (k === 'text' || k === 'allRequests' || k === 'served' ? undefined : v)),
		null,
		2,
	),
);
process.exit(0);
