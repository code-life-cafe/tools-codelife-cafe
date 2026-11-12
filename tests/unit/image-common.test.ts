import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { sourceSize } from '../../src/lib/tools/image-common.ts';

type Globals = { HTMLImageElement?: unknown };
const globals = globalThis as Globals;
const originalImageElement = globals.HTMLImageElement;

class FakeImageElement {
	naturalWidth: number;
	naturalHeight: number;
	// 表示サイズ（CSSで縮小された値）。sourceSize はこちらを使わない
	width = 10;
	height = 5;
	constructor(naturalWidth: number, naturalHeight: number) {
		this.naturalWidth = naturalWidth;
		this.naturalHeight = naturalHeight;
	}
}

afterEach(() => {
	globals.HTMLImageElement = originalImageElement;
});

describe('sourceSize', () => {
	it('画像要素は表示サイズではなく naturalWidth / naturalHeight を返す', () => {
		globals.HTMLImageElement = FakeImageElement;
		const image = new FakeImageElement(4000, 3000);
		assert.deepEqual(sourceSize(image as unknown as HTMLImageElement), {
			width: 4000,
			height: 3000,
		});
	});

	it('縮小後の Canvas は width / height を返す', () => {
		globals.HTMLImageElement = FakeImageElement;
		const canvas = { width: 4096, height: 2304 };
		assert.deepEqual(sourceSize(canvas as unknown as HTMLCanvasElement), {
			width: 4096,
			height: 2304,
		});
	});
});
