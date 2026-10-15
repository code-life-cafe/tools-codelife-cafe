import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { toolCatalog } from '../../src/lib/tools/catalog.ts';

const README = fs.readFileSync(
	path.resolve(import.meta.dirname, '../../README.md'),
	'utf8',
);
const SITE_ORIGIN = 'https://tools.codelife.cafe';

// 「公開中ツール」= toolCatalog の件数（ホームの件数表示と同一の集合）。
test('READMEに書かれたツール件数がカタログの公開数と一致する', () => {
	const expected = toolCatalog.length;
	const headline = README.match(/全(\d+)種/);
	const section = README.match(/収録ツール（(\d+)種）/);
	assert.ok(headline, 'README冒頭の「全N種」表記が見つからない');
	assert.ok(section, 'README「収録ツール（N種）」見出しが見つからない');
	assert.equal(Number(headline[1]), expected);
	assert.equal(Number(section[1]), expected);
});

test('カタログの全ツールがREADMEの収録表に掲載されている', () => {
	const missing = toolCatalog
		.map((tool) => tool.href)
		.filter((href) => !README.includes(`(${SITE_ORIGIN}${href})`));
	assert.deepEqual(missing, []);
});
