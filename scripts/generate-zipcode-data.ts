// generate-zipcode-data.ts — 日本郵便 郵便番号データ(utf_ken_all.csv)から
// 上2桁チャンクJSON(public/data/zipcode/{00..99}.json)と metadata.json を生成する。
//
// ⚠ このスクリプトはビルドでは実行しない。データ更新時に手動で実行する。
//   実行: node scripts/generate-zipcode-data.ts
//
// 入力CSVの準備（リポジトリにはコミットしないキャッシュ）:
//   1. https://www.post.japanpost.jp/zipcode/dl/utf/zip/utf_ken_all.zip を取得
//   2. 展開して scripts/.cache/utf_ken_all.csv に配置
//      - Windows(PowerShell): Expand-Archive utf_ken_all.zip -DestinationPath scripts/.cache
//      - macOS/Linux:        unzip utf_ken_all.zip -d scripts/.cache
//   3. このスクリプトを実行
//
// 出典: 日本郵便 郵便番号データ（自由に配布・利用可能）
//   https://www.post.japanpost.jp/service/search/zipcode/download/

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INPUT_CSV =
	process.env.ZIPCODE_CSV ?? join(ROOT, 'scripts', '.cache', 'utf_ken_all.csv');
const OUTPUT_DIR = join(ROOT, 'public', 'data', 'zipcode');

const SOURCE_URL =
	'https://www.post.japanpost.jp/service/search/zipcode/download/';
const SOURCE_LABEL = '日本郵便 郵便番号データ';

/** 1レコード = [郵便番号7桁, 都道府県, 市区町村, 町域] */
type ZipRecord = [string, string, string, string];

/** ダブルクォート対応のCSV行パーサ（フィールド数可変） */
function splitCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out;
}

/** 丸括弧の開閉が釣り合っているか（複数行に分割された町域の結合判定に使う） */
function isBalanced(text: string): boolean {
	let depth = 0;
	for (const ch of text) {
		if (ch === '（' || ch === '(') depth++;
		else if (ch === '）' || ch === ')') depth--;
	}
	return depth === 0;
}

/**
 * 町域名を正規化する。
 * - 丸括弧内の補足（番地・ビル名・除外条件など）を除去
 * - 「以下に掲載がない場合」「○○の次に番地がくる場合」等の特殊表記 → 空文字
 * - 「○○一円」 → 空文字（市区町村全域を指す）
 */
function normalizeTown(rawTown: string): string {
	let town = rawTown.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
	if (town.includes('以下に掲載がない場合')) return '';
	if (town.includes('場合')) return '';
	if (/一円$/.test(town)) return '';
	return town.trim();
}

async function main(): Promise<void> {
	if (!existsSync(INPUT_CSV)) {
		console.error(
			`[generate-zipcode-data] 入力CSVが見つかりません: ${INPUT_CSV}\n` +
				'  https://www.post.japanpost.jp/zipcode/dl/utf/zip/utf_ken_all.zip を取得・展開して\n' +
				'  scripts/.cache/utf_ken_all.csv に配置してください（詳細はスクリプト冒頭のコメント参照）。',
		);
		process.exitCode = 1;
		return;
	}

	const raw = await readFile(INPUT_CSV, 'utf8');
	const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
	const lines = text.split(/\r?\n/).filter((line) => line.length > 0);

	const records: ZipRecord[] = [];
	// 町域が複数行に分割されているケース（丸括弧が複数レコードに跨る）を結合する
	let pending: { zip: string; pref: string; city: string; town: string } | null =
		null;

	for (const line of lines) {
		const fields = splitCsvLine(line);
		if (fields.length < 9) continue;
		const zip = fields[2].trim();
		const pref = fields[6].trim();
		const city = fields[7].trim();
		const town = fields[8].trim();

		if (pending) {
			pending.town += town;
			if (isBalanced(pending.town)) {
				records.push([
					pending.zip,
					pending.pref,
					pending.city,
					normalizeTown(pending.town),
				]);
				pending = null;
			}
			continue;
		}

		if (!isBalanced(town)) {
			pending = { zip, pref, city, town };
			continue;
		}

		records.push([zip, pref, city, normalizeTown(town)]);
	}
	if (pending) {
		records.push([
			pending.zip,
			pending.pref,
			pending.city,
			normalizeTown(pending.town),
		]);
	}

	// 上2桁でチャンク分割
	const chunks = new Map<string, ZipRecord[]>();
	for (const record of records) {
		const prefix = record[0].slice(0, 2);
		if (!/^\d{2}$/.test(prefix)) continue;
		const bucket = chunks.get(prefix);
		if (bucket) bucket.push(record);
		else chunks.set(prefix, [record]);
	}

	// 各チャンクを決定的にソート・重複排除（冪等性確保）
	let totalRecords = 0;
	const sortedPrefixes = [...chunks.keys()].sort();
	const normalizedChunks = new Map<string, ZipRecord[]>();
	for (const prefix of sortedPrefixes) {
		const bucket = chunks.get(prefix) ?? [];
		bucket.sort((a, b) => {
			if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
			return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
		});
		const seen = new Set<string>();
		const deduped = bucket.filter((r) => {
			const key = r.join('');
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		normalizedChunks.set(prefix, deduped);
		totalRecords += deduped.length;
	}

	// 出力ディレクトリを準備し、既存の *.json を一掃してから書き出す
	await mkdir(OUTPUT_DIR, { recursive: true });
	for (const name of await readdir(OUTPUT_DIR)) {
		if (name.endsWith('.json')) await unlink(join(OUTPUT_DIR, name));
	}

	for (const [prefix, bucket] of normalizedChunks) {
		await writeFile(
			join(OUTPUT_DIR, `${prefix}.json`),
			JSON.stringify(bucket),
			'utf8',
		);
	}

	const now = new Date();
	const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const metadata = {
		generatedAt: now.toISOString(),
		dataVersion: yyyymm,
		sourceUrl: SOURCE_URL,
		sourceLabel: SOURCE_LABEL,
		recordCount: totalRecords,
		chunkCount: normalizedChunks.size,
	};
	await writeFile(
		join(OUTPUT_DIR, 'metadata.json'),
		JSON.stringify(metadata, null, 2),
		'utf8',
	);

	console.log(
		`[generate-zipcode-data] records=${totalRecords}, chunks=${normalizedChunks.size}, output=${OUTPUT_DIR}`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
