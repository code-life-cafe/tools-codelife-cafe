import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import {
	adaptiveBinarize,
	addMargin,
	binarize,
	dilate3,
	erode3,
	type GrayImage,
	grayToRgba,
	invert,
	limitPixels,
	MAX_RESTORE_PIXELS,
	medianFilter3,
	otsuThreshold,
	RESTORE_MAX_FILE_SIZE,
	RESTORE_STEPS,
	resize,
	rgbaToGray,
	runRestore,
	sharpen,
	stretchContrast,
	validateRestoreFile,
} from '../../src/lib/tools/qr-restore.ts';
import {
	DAMAGED_QR_TEXT,
	lowContrastNoisyQr,
	renderQr,
	saltPepperQr,
	whiteGapsQr,
} from '../helpers/qr-damage.ts';

function gray(width: number, height: number, values: number[]): GrayImage {
	assert.equal(values.length, width * height);
	return { width, height, data: Uint8ClampedArray.from(values) };
}

function uniform(width: number, height: number, value: number): GrayImage {
	return {
		width,
		height,
		data: new Uint8ClampedArray(width * height).fill(value),
	};
}

describe('rgbaToGray / grayToRgba', () => {
	test('輝度（BT.601）に変換し、透明部分は白として扱う', () => {
		const rgba = Uint8ClampedArray.from([
			255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0,
		]);
		const g = rgbaToGray(rgba, 2, 2);
		assert.deepEqual([...g.data], [76, 150, 29, 255]);
	});

	test('幅・高さとデータの長さが合わない場合はエラー', () => {
		assert.throws(
			() => rgbaToGray(new Uint8ClampedArray(12), 2, 2),
			/画像データの長さ/,
		);
		assert.throws(
			() => rgbaToGray(new Uint8ClampedArray(0), 0, 0),
			/幅と高さが正しくありません/,
		);
		assert.throws(
			() => rgbaToGray(new Uint8ClampedArray(4), 1.5, 1),
			/幅と高さが正しくありません/,
		);
	});

	test('グレースケールを不透明なRGBAへ戻す', () => {
		assert.deepEqual(
			[...grayToRgba(gray(2, 1, [10, 200]))],
			[10, 10, 10, 255, 200, 200, 200, 255],
		);
	});
});

describe('コントラスト・二値化', () => {
	test('stretchContrast は最暗・最明を0と255へ広げる', () => {
		const out = stretchContrast(gray(4, 1, [100, 110, 120, 130]), 0, 1);
		assert.deepEqual([...out.data], [0, 85, 170, 255]);
	});

	test('stretchContrast は単色画像をそのまま返す（0除算しない）', () => {
		const out = stretchContrast(uniform(3, 3, 128));
		assert.ok(out.data.every((v) => v === 128));
	});

	test('otsuThreshold は2つの明るさの山の間を返し、binarize で白黒に分ける', () => {
		const img = gray(6, 1, [20, 25, 30, 200, 210, 220]);
		const t = otsuThreshold(img);
		assert.ok(t >= 30 && t < 200, `しきい値 ${t}`);
		assert.deepEqual([...binarize(img, t).data], [0, 0, 0, 255, 255, 255]);
	});

	test('adaptiveBinarize は照明むら（右ほど暗い）があっても局所的に暗い画素だけを黒にする', () => {
		// 左は明るい背景に暗い点、右は暗い背景（左の点より暗い）に、さらに暗い点
		const values: number[] = [];
		for (let x = 0; x < 40; x++) {
			const background = x < 20 ? 220 : 80;
			values.push(x === 10 || x === 30 ? background - 60 : background);
		}
		const out = adaptiveBinarize(gray(40, 1, values), 9, 8);
		assert.equal(out.data[10], 0);
		assert.equal(out.data[30], 0);
		assert.equal(out.data[25], 255, '暗い背景そのものは黒にしない');
		assert.equal(out.data[5], 255);
	});
});

describe('フィルタ', () => {
	test('medianFilter3 は孤立した黒い点を消す', () => {
		const img = uniform(5, 5, 255);
		img.data[12] = 0;
		assert.ok(medianFilter3(img).data.every((v) => v === 255));
	});

	test('sharpen は輪郭の明暗差を広げる', () => {
		const img = gray(4, 1, [100, 100, 150, 150]);
		const out = sharpen(img, 1);
		assert.ok(out.data[1] < 100 && out.data[2] > 150);
	});

	test('erode3 は黒を1画素太らせ、dilate3 は細らせる', () => {
		const img = uniform(5, 5, 255);
		img.data[12] = 0;
		const eroded = erode3(img);
		assert.equal(eroded.data.filter((v) => v === 0).length, 9);
		assert.ok(dilate3(img).data.every((v) => v === 255));
	});

	test('invert は明暗を反転する', () => {
		assert.deepEqual([...invert(gray(2, 1, [0, 200])).data], [255, 55]);
	});
});

describe('サイズ', () => {
	test('resize は指定の大きさにし、単色はそのまま保つ', () => {
		const out = resize(uniform(3, 2, 90), 7, 5);
		assert.equal(out.width, 7);
		assert.equal(out.height, 5);
		assert.ok(out.data.every((v) => v === 90));
		assert.throws(() => resize(uniform(2, 2, 0), 0, 3), /幅と高さ/);
	});

	test('limitPixels は上限以下ならそのまま、超えれば縦横比を保って縮小する', () => {
		const small = uniform(10, 10, 0);
		assert.equal(limitPixels(small, 100), small);
		const big = limitPixels(uniform(400, 100, 0), 10_000);
		assert.ok(big.width * big.height <= 10_000);
		assert.equal(big.width / big.height, 4);
		assert.equal(MAX_RESTORE_PIXELS, 1600 * 1600);
	});

	test('addMargin は周囲に白い余白を足し、元の画素を中央に置く', () => {
		const out = addMargin(gray(1, 1, [0]), 2);
		assert.equal(out.width, 5);
		assert.equal(out.height, 5);
		assert.equal(out.data[2 * 5 + 2], 0);
		assert.equal(out.data.filter((v) => v === 255).length, 24);
	});
});

describe('validateRestoreFile', () => {
	test('PNG・JPEG・WebPで20MB以下なら null', () => {
		for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
			assert.equal(validateRestoreFile({ type, size: 1 }), null);
		}
		assert.equal(
			validateRestoreFile({ type: 'image/png', size: RESTORE_MAX_FILE_SIZE }),
			null,
		);
	});

	test('非対応形式・空・上限超えはエラー文言を返す', () => {
		assert.match(
			validateRestoreFile({ type: 'image/gif', size: 10 }) ?? '',
			/PNG・JPEG・WebP/,
		);
		assert.match(
			validateRestoreFile({ type: 'application/pdf', size: 10 }) ?? '',
			/対応形式/,
		);
		assert.match(
			validateRestoreFile({ type: 'image/png', size: 0 }) ?? '',
			/空/,
		);
		assert.match(
			validateRestoreFile({
				type: 'image/png',
				size: RESTORE_MAX_FILE_SIZE + 1,
			}) ?? '',
			/20MB以下/,
		);
	});
});

describe('runRestore（デコーダーを差し替えて確認）', () => {
	test('手法は13通りで、IDは重複しない（LPのFAQの記述と一致）', () => {
		assert.equal(RESTORE_STEPS.length, 13);
		assert.equal(new Set(RESTORE_STEPS.map((s) => s.id)).size, 13);
		assert.equal(RESTORE_STEPS[0].id, 'original');
	});

	test('最初に読めた手法で止め、試した手法と進捗を返す', async () => {
		const progress: number[] = [];
		let calls = 0;
		const outcome = await runRestore(
			uniform(20, 20, 255),
			async () => {
				calls++;
				return calls === 3 ? ['結果', '結果', ''] : [];
			},
			{ onProgress: (p) => progress.push(p.index) },
		);
		assert.equal(outcome.status, 'success');
		if (outcome.status !== 'success') return;
		assert.deepEqual(outcome.texts, ['結果'], '重複と空文字は除く');
		assert.equal(outcome.step.id, RESTORE_STEPS[2].id);
		assert.deepEqual(
			outcome.attempts.map((a) => a.found),
			[false, false, true],
		);
		assert.deepEqual(progress, [0, 1, 2]);
	});

	test('どの手法でも読めなければ failed と全手法の記録を返す', async () => {
		const outcome = await runRestore(uniform(10, 10, 255), async () => []);
		assert.equal(outcome.status, 'failed');
		assert.equal(outcome.attempts.length, RESTORE_STEPS.length);
		assert.ok(outcome.attempts.every((a) => !a.found));
	});

	test('デコーダーが例外を投げた手法は読めなかったものとして次へ進む', async () => {
		let calls = 0;
		const outcome = await runRestore(uniform(10, 10, 255), async () => {
			calls++;
			if (calls === 1) throw new Error('decode failed');
			return ['OK'];
		});
		assert.equal(outcome.status, 'success');
		if (outcome.status !== 'success') return;
		assert.equal(outcome.step.id, RESTORE_STEPS[1].id);
		assert.equal(outcome.attempts[0].found, false);
	});

	test('上限を超える画像は縮小してから各手法へ渡す', async () => {
		const sizes: number[] = [];
		await runRestore(
			uniform(1700, 1700, 255),
			async (img) => {
				sizes.push(img.width * img.height);
				return ['x'];
			},
			{ steps: [RESTORE_STEPS[0]] },
		);
		assert.ok(sizes[0] <= MAX_RESTORE_PIXELS);
	});
});

describe('実際の zxing-wasm での読み取り（回帰）', () => {
	const require = createRequire(import.meta.url);
	const wasm = fs.readFileSync(
		require.resolve('zxing-wasm/reader/zxing_reader.wasm'),
	);
	prepareZXingModule({
		overrides: {
			wasmBinary: wasm.buffer.slice(
				wasm.byteOffset,
				wasm.byteOffset + wasm.byteLength,
			) as ArrayBuffer,
		},
		fireImmediately: true,
	});

	async function decode(image: GrayImage): Promise<string[]> {
		const results = await readBarcodes(
			{
				data: grayToRgba(image),
				width: image.width,
				height: image.height,
				colorSpace: 'srgb',
			} as ImageData,
			{ formats: ['QRCode'] },
		);
		return results.map((r) => r.text);
	}

	test('劣化のないQRは元の画像のまま読める', async () => {
		const outcome = await runRestore(renderQr(DAMAGED_QR_TEXT), decode);
		assert.equal(outcome.status, 'success');
		if (outcome.status !== 'success') return;
		assert.equal(outcome.step.id, 'original');
		assert.deepEqual(outcome.texts, [DAMAGED_QR_TEXT]);
	});

	for (const [name, make] of [
		['低コントラスト＋ノイズ', lowContrastNoisyQr],
		['ごま塩ノイズ', saltPepperQr],
		['白い筋状の欠け', whiteGapsQr],
	] as const) {
		test(`${name}: そのままでは読めず、復元で読める`, async () => {
			const image = make();
			assert.deepEqual(await decode(image), [], '前提: 補正なしでは読めない');
			const outcome = await runRestore(image, decode);
			assert.equal(outcome.status, 'success');
			if (outcome.status !== 'success') return;
			assert.deepEqual(outcome.texts, [DAMAGED_QR_TEXT]);
			assert.notEqual(outcome.step.id, 'original');
		});
	}

	test('QRコードを含まない画像は failed', async () => {
		const outcome = await runRestore(uniform(120, 120, 200), decode);
		assert.equal(outcome.status, 'failed');
	});
});
