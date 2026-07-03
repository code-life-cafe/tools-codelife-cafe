// generate-qr-fixtures.ts — QRコード読み取りツールのE2Eテスト用フィクスチャ画像を生成する
// 実行: npm run generate:fixtures
//
// qrcode パッケージで決定論的にQRコードPNGを生成し、sharp で合成・加工する。
// 生成物は tests/e2e/fixtures/qr-reader/ 配下にコミットして再現性を持たせる。

import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import sharp from 'sharp';

const fixturesDir = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'qr-reader',
);
if (!fs.existsSync(fixturesDir)) {
	fs.mkdirSync(fixturesDir, { recursive: true });
}

async function qrPngBuffer(text: string, size = 300): Promise<Buffer> {
	return QRCode.toBuffer(text, {
		type: 'png',
		width: size,
		margin: 2,
		errorCorrectionLevel: 'M',
	});
}

async function main() {
	// 1. 単一QR
	const singleValue = 'https://tools.codelife.cafe/qr-reader';
	await fs.promises.writeFile(
		path.join(fixturesDir, 'single-qr.png'),
		await qrPngBuffer(singleValue),
	);

	// 2. 1枚に2つのQRを合成
	const qrA = await qrPngBuffer('QR-FIXTURE-A', 260);
	const qrB = await qrPngBuffer('QR-FIXTURE-B', 260);
	const padding = 40;
	const canvasWidth = 260 * 2 + padding * 3;
	const canvasHeight = 260 + padding * 2;
	await sharp({
		create: {
			width: canvasWidth,
			height: canvasHeight,
			channels: 3,
			background: { r: 255, g: 255, b: 255 },
		},
	})
		.composite([
			{ input: qrA, left: padding, top: padding },
			{ input: qrB, left: padding * 2 + 260, top: padding },
		])
		.png()
		.toFile(path.join(fixturesDir, 'multi-qr-2codes.png'));

	// 3. vCard QR
	const vcard = [
		'BEGIN:VCARD',
		'VERSION:3.0',
		'N:codelife;cafe;;;',
		'FN:cafe codelife',
		'TEL:0312345678',
		'EMAIL:info@example.com',
		'END:VCARD',
	].join('\n');
	await fs.promises.writeFile(
		path.join(fixturesDir, 'vcard-qr.png'),
		await qrPngBuffer(vcard),
	);

	// 4. Wi-Fi QR
	const wifi = 'WIFI:T:WPA;S:CodeLifeCafe;P:samplePassword123;;';
	await fs.promises.writeFile(
		path.join(fixturesDir, 'wifi-qr.png'),
		await qrPngBuffer(wifi),
	);

	// 5. QRコードを含まないプレーン画像
	await sharp({
		create: {
			width: 300,
			height: 300,
			channels: 3,
			background: { r: 120, g: 180, b: 220 },
		},
	})
		.png()
		.toFile(path.join(fixturesDir, 'not-a-qr.png'));

	// 6. CSVフォーミュラインジェクション検証用（値が = で始まる）
	const formulaValue = '=1+1';
	await fs.promises.writeFile(
		path.join(fixturesDir, 'formula-injection-qr.png'),
		await qrPngBuffer(formulaValue),
	);

	console.log(`[generate-qr-fixtures] wrote fixtures to ${fixturesDir}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
