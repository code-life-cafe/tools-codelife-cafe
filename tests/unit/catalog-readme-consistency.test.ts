import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { toolCatalog } from '../../src/lib/tools/catalog.ts';

const README = fs.readFileSync(
	path.resolve(import.meta.dirname, '../../README.md'),
	'utf8',
);
const SECTION_START = '## 📦 収録ツール';
const SECTION_END = '## 🛡️';

// 「公開中ツール」= toolCatalog の件数（ホームの件数表示と同一の集合）。
// 収録表 = SECTION_START から SECTION_END までの範囲（主力ツール欄は含めない）。
function extractSection(readme: string): string {
	const start = readme.indexOf(SECTION_START);
	const end = readme.indexOf(SECTION_END, start);
	assert.ok(start >= 0, `README に「${SECTION_START}」見出しが見つからない`);
	assert.ok(end > start, `README に「${SECTION_END}」見出しが見つからない`);
	return readme.slice(start, end);
}

function extractToolPaths(section: string): string[] {
	return [
		...section.matchAll(/\]\(https:\/\/tools\.codelife\.cafe(\/[^)\s#]*)\)/g),
	].map((m) => m[1]);
}

function diffPaths(catalogPaths: string[], readmePaths: string[]) {
	const catalog = new Set(catalogPaths);
	const readme = new Set(readmePaths);
	return {
		missing: [...catalog].filter((p) => !readme.has(p)).sort(),
		extra: [...readme].filter((p) => !catalog.has(p)).sort(),
	};
}

const catalogPaths = toolCatalog.map((tool) => tool.href);

test('READMEに書かれたツール件数がカタログの公開数と一致する', () => {
	const headline = README.match(/全(\d+)種/);
	const section = README.match(/収録ツール（(\d+)種）/);
	assert.ok(headline, 'README冒頭の「全N種」表記が見つからない');
	assert.ok(section, 'README「収録ツール（N種）」見出しが見つからない');
	assert.equal(Number(headline[1]), toolCatalog.length);
	assert.equal(Number(section[1]), toolCatalog.length);
});

test('収録表のURL集合がカタログと過不足なく一致する', () => {
	const readmePaths = extractToolPaths(extractSection(README));
	assert.equal(
		new Set(readmePaths).size,
		readmePaths.length,
		'収録表に重複行がある',
	);
	assert.deepEqual(diffPaths(catalogPaths, readmePaths), {
		missing: [],
		extra: [],
	});
});

test('回帰: 収録表から行を消すと主力ツール欄にURLが残っていても欠落を検出する', () => {
	// csv-fixer 等は主力ツール欄にも載るため、README全体検索では見逃していた。
	const featured = README.slice(0, README.indexOf(SECTION_START));
	const featuredPaths = extractToolPaths(featured);
	const target = catalogPaths.find((p) => featuredPaths.includes(p));
	assert.ok(target, '主力ツール欄に載るカタログ掲載ツールが見つからない');
	const section = extractSection(README)
		.split('\n')
		.filter((line) => !line.includes(`https://tools.codelife.cafe${target})`))
		.join('\n');
	const { missing, extra } = diffPaths(catalogPaths, extractToolPaths(section));
	assert.deepEqual(missing, [target]);
	assert.deepEqual(extra, []);
});

test('回帰: カタログから外したツールの行が収録表に残ると余剰として検出する', () => {
	const retired = catalogPaths[0];
	const { missing, extra } = diffPaths(
		catalogPaths.slice(1),
		extractToolPaths(extractSection(README)),
	);
	assert.deepEqual(missing, []);
	assert.deepEqual(extra, [retired]);
});
