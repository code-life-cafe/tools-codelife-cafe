import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	normalizeCanonicalPath,
	toCanonicalUrl,
} from '../../src/lib/seo/url.ts';

test('normalizeCanonicalPath removes query, hash, and non-root trailing slash', () => {
	assert.equal(
		normalizeCanonicalPath('/json-formatter?settings=abc#preview'),
		'/json-formatter',
	);
	assert.equal(normalizeCanonicalPath('/about/'), '/about');
	assert.equal(normalizeCanonicalPath('/'), '/');
});

test('toCanonicalUrl converts absolute or relative paths to site canonical URLs', () => {
	assert.equal(
		toCanonicalUrl('privacy'),
		'https://tools.codelife.cafe/privacy',
	);
	assert.equal(
		toCanonicalUrl('https://tools.codelife.cafe/base64/?settings=abc'),
		'https://tools.codelife.cafe/base64',
	);
});
