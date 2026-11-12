import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
	type AnyCanvas,
	canvasToBlob,
	createCanvas,
	mimeForFormat,
} from '../../src/lib/image-canvas.ts';

type Globals = { OffscreenCanvas?: unknown; document?: unknown };
const globals = globalThis as Globals;
const originalOffscreen = globals.OffscreenCanvas;
const originalDocument = globals.document;

afterEach(() => {
	globals.OffscreenCanvas = originalOffscreen;
	globals.document = originalDocument;
});

describe('createCanvas', () => {
	it('OffscreenCanvas があればそれを指定サイズで作る', () => {
		class FakeOffscreen {
			width: number;
			height: number;
			constructor(width: number, height: number) {
				this.width = width;
				this.height = height;
			}
		}
		globals.OffscreenCanvas = FakeOffscreen;
		globals.document = {
			createElement: () => {
				throw new Error('document は使わない');
			},
		};
		const canvas = createCanvas(320, 200);
		assert.ok(canvas instanceof FakeOffscreen);
		assert.equal(canvas.width, 320);
		assert.equal(canvas.height, 200);
	});

	it('OffscreenCanvas がなければ canvas 要素を作ってサイズを設定する', () => {
		globals.OffscreenCanvas = undefined;
		const created: string[] = [];
		globals.document = {
			createElement: (tag: string) => {
				created.push(tag);
				return { width: 0, height: 0 };
			},
		};
		const canvas = createCanvas(64, 48);
		assert.deepEqual(created, ['canvas']);
		assert.equal(canvas.width, 64);
		assert.equal(canvas.height, 48);
	});
});

describe('canvasToBlob', () => {
	it('convertToBlob を持つ canvas では MIME と品質を渡す', async () => {
		const blob = new Blob(['x']);
		const calls: unknown[] = [];
		const canvas = {
			convertToBlob: (options: unknown) => {
				calls.push(options);
				return Promise.resolve(blob);
			},
		} as unknown as AnyCanvas;
		assert.equal(await canvasToBlob(canvas, 'image/webp', 0.8), blob);
		assert.deepEqual(calls, [{ type: 'image/webp', quality: 0.8 }]);
	});

	it('convertToBlob が失敗したら例外にせず null を返す', async () => {
		const canvas = {
			convertToBlob: () => Promise.reject(new Error('encode failed')),
		} as unknown as AnyCanvas;
		assert.equal(await canvasToBlob(canvas, 'image/avif', 0.5), null);
	});

	it('canvas 要素では toBlob の結果（null を含む）をそのまま返す', async () => {
		const blob = new Blob(['y']);
		const calls: unknown[][] = [];
		const make = (result: Blob | null) =>
			({
				toBlob: (
					callback: (b: Blob | null) => void,
					mime: string,
					quality: number,
				) => {
					calls.push([mime, quality]);
					callback(result);
				},
			}) as unknown as AnyCanvas;
		assert.equal(await canvasToBlob(make(blob), 'image/jpeg', 0.92), blob);
		assert.equal(await canvasToBlob(make(null), 'image/png', 1), null);
		assert.deepEqual(calls, [
			['image/jpeg', 0.92],
			['image/png', 1],
		]);
	});
});

describe('mimeForFormat', () => {
	it('各形式の MIME タイプを返す', () => {
		assert.equal(mimeForFormat('png'), 'image/png');
		assert.equal(mimeForFormat('jpeg'), 'image/jpeg');
		assert.equal(mimeForFormat('webp'), 'image/webp');
	});
});
