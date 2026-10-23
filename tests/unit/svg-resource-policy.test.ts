import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalSvgResourceValue } from '../../src/lib/tools/svg-resource-policy.ts';

test('SVG presentation policy preserves local fragments and ordinary paint/filter values', () => {
	for (const value of [
		'url("#paint")',
		"url('#mask')",
		'url("#paint") rgb(1, 2, 3)',
		'url("#a") blur(2px) url("#b")',
		'url("#cursor"), auto',
		'image-set(url("#image") 1x)',
		'none',
		'currentcolor',
		'rgb(1, 2, 3)',
		'blur(2px)',
	])
		assert.equal(isLocalSvgResourceValue(value), true, value);
});

test('SVG presentation policy rejects every non-fragment URL and unparsed/deferred URLs', () => {
	for (const value of [
		'',
		'url("https://example.invalid/paint.svg#p")',
		'url("http://127.0.0.1/paint.svg#p")',
		'url("//example.invalid/paint.svg#p")',
		'url("/paint.svg#p")',
		'url("paint.svg#p")',
		'url("data:image/svg+xml,test")',
		'url("blob:local")',
		'url("%23paint")',
		'url("#local") url("https://example.invalid/f.svg")',
		'image-set(url("https://example.invalid/image.png") 1x)',
		'url(#unserialized)',
		'url("\\23 unparsed")',
		'var(--paint)',
		'var(--paint, url("#local"))',
		'env(paint)',
		'attr(data-paint)',
		'image("https://example.invalid/image.png")',
		'u\\72l(https://example.invalid/image.png)',
	])
		assert.equal(isLocalSvgResourceValue(value), false, value);
});
