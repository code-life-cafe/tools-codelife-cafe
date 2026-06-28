import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	breadcrumb,
	generateJsonLd,
	softwareApplication,
} from '../../src/lib/jsonld.ts';

test('softwareApplication: 正しい仕様の SoftwareApplication オブジェクトを生成する', () => {
	const tool = {
		title: '全角↔半角変換',
		path: '/zenkaku-hankaku',
		summary: 'カタカナ・英数字・記号の全角半角を一括変換。',
		category: 'テキスト変換',
	};

	const app = softwareApplication(tool);

	assert.strictEqual(app['@context'], 'https://schema.org');
	assert.strictEqual(app['@type'], 'SoftwareApplication');
	assert.strictEqual(
		app['@id'],
		'https://tools.codelife.cafe/zenkaku-hankaku#app',
	);
	assert.strictEqual(app.name, '全角↔半角変換');
	assert.strictEqual(
		app.description,
		'カタカナ・英数字・記号の全角半角を一括変換。',
	);
	assert.strictEqual(app.url, 'https://tools.codelife.cafe/zenkaku-hankaku');
	assert.strictEqual(app.applicationCategory, 'UtilitiesApplication');
	assert.strictEqual(app.operatingSystem, 'Any');
	assert.strictEqual(app.inLanguage, 'ja');
	assert.strictEqual(app.isAccessibleForFree, true);

	const offers = app.offers as Record<string, unknown>;
	assert.strictEqual(offers['@type'], 'Offer');
	assert.strictEqual(offers.price, '0');
	assert.strictEqual(offers.priceCurrency, 'JPY');
	assert.strictEqual(offers.availability, 'https://schema.org/InStock');
	assert.strictEqual(offers.url, 'https://tools.codelife.cafe/zenkaku-hankaku');

	const publisher = app.publisher as Record<string, unknown>;
	assert.strictEqual(publisher['@id'], 'https://tools.codelife.cafe/#org');
});

test('breadcrumb: カテゴリ指定ありの場合、3階層の BreadcrumbList を生成する', () => {
	const bc = breadcrumb(
		'/zenkaku-hankaku',
		'全角↔半角変換',
		'テキスト変換',
		'/?category=text',
	);

	assert.strictEqual(bc['@context'], 'https://schema.org');
	assert.strictEqual(bc['@type'], 'BreadcrumbList');

	const elements = bc.itemListElement as unknown as Array<
		Record<string, unknown>
	>;
	assert.strictEqual(elements.length, 3);

	assert.strictEqual(elements[0]['@type'], 'ListItem');
	assert.strictEqual(elements[0].position, 1);
	assert.strictEqual(elements[0].name, 'ホーム');
	assert.strictEqual(elements[0].item, 'https://tools.codelife.cafe/');

	assert.strictEqual(elements[1]['@type'], 'ListItem');
	assert.strictEqual(elements[1].position, 2);
	assert.strictEqual(elements[1].name, 'テキスト変換');
	assert.strictEqual(
		elements[1].item,
		'https://tools.codelife.cafe/?category=text',
	);

	assert.strictEqual(elements[2]['@type'], 'ListItem');
	assert.strictEqual(elements[2].position, 3);
	assert.strictEqual(elements[2].name, '全角↔半角変換');
	assert.strictEqual(
		elements[2].item,
		'https://tools.codelife.cafe/zenkaku-hankaku',
	);
});

test('generateJsonLd: SoftwareApplication と BreadcrumbList を含む @graph を生成する', () => {
	const tool = {
		title: 'JSON整形',
		path: '/json-formatter',
		summary: 'JSONの整形・圧縮・構文チェック。',
		category: '開発ツール',
	};

	const jsonLd = generateJsonLd(tool, '/?category=dev');

	assert.strictEqual(jsonLd['@context'], 'https://schema.org');
	const graph = jsonLd['@graph'] as Array<Record<string, unknown>>;
	assert.strictEqual(graph.length, 2);
	assert.strictEqual(graph[0]['@type'], 'SoftwareApplication');
	assert.strictEqual(graph[1]['@type'], 'BreadcrumbList');
});
