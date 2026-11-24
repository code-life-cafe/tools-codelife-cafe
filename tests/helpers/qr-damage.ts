// qr-damage.ts — QRコード復元のテスト用に、決定論的な劣化QR画像（グレースケール）を作る。
// unit（実際の zxing-wasm での読み取り確認）と E2E（PNG化してアップロード）で共有する。

import QRCode from 'qrcode';
import type { GrayImage } from '../../src/lib/tools/qr-restore.ts';

export const DAMAGED_QR_TEXT = 'https://tools.codelife.cafe/qr-restore/';

/** QRコードを scale ピクセル/モジュール、margin モジュールの余白で描く */
export function renderQr(
	text: string,
	options: {
		scale?: number;
		margin?: number;
		dark?: number;
		light?: number;
	} = {},
): GrayImage {
	const { scale = 6, margin = 4, dark = 0, light = 255 } = options;
	const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
	const n = qr.modules.size;
	const side = (n + margin * 2) * scale;
	const data = new Uint8ClampedArray(side * side).fill(light);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			if (!qr.modules.get(y, x)) continue;
			for (let dy = 0; dy < scale; dy++) {
				const row = ((y + margin) * scale + dy) * side;
				data.fill(
					dark,
					row + (x + margin) * scale,
					row + (x + margin + 1) * scale,
				);
			}
		}
	}
	return { width: side, height: side, data };
}

/** 線形合同法による決定論的な乱数（0以上1未満） */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

/** 明暗差が小さい（灰色120と140）うえにノイズが乗った画像 */
export function lowContrastNoisyQr(text = DAMAGED_QR_TEXT): GrayImage {
	const image = renderQr(text, { dark: 120, light: 140 });
	const random = seededRandom(1);
	for (let i = 0; i < image.data.length; i++) {
		image.data[i] += (random() - 0.5) * 40;
	}
	return image;
}

/** 画素の30%が黒または白の点に置き換わった（ごま塩ノイズ）画像 */
export function saltPepperQr(text = DAMAGED_QR_TEXT): GrayImage {
	const image = renderQr(text);
	const random = seededRandom(2);
	for (let i = 0; i < image.data.length; i++) {
		const v = random();
		if (v < 0.15) image.data[i] = 0;
		else if (v < 0.3) image.data[i] = 255;
	}
	return image;
}

/** 黒いモジュールに白い筋状の欠け（かすれ）が入った画像 */
export function whiteGapsQr(text = DAMAGED_QR_TEXT): GrayImage {
	const image = renderQr(text, { scale: 8 });
	const random = seededRandom(4);
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			if ((x % 8 === 3 || y % 8 === 4) && random() < 0.9) {
				image.data[y * image.width + x] = 255;
			}
		}
	}
	return image;
}
