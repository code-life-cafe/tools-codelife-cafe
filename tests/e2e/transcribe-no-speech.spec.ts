import { expect, test } from './fixtures/base.ts';
import { installMock } from './helpers/transcribe-mock-worker.ts';

test('3秒・16kHz・mono・16bitの全ゼロWAVで、空のWorker結果を発話なしと表示する（#572）', async ({
	page,
}) => {
	// 無音の推論抑止は transcribe-worker.test.ts で実Workerハンドラを検証する。
	// ここでは実WAVのデコードと、空結果を受け取るUI・ダウンロード非表示を検証する。
	const samples = 3 * 16000;
	const wav = Buffer.alloc(44 + samples * 2);
	wav.write('RIFF', 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(16000, 24);
	wav.writeUInt32LE(32000, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write('data', 36);
	wav.writeUInt32LE(samples * 2, 40);
	await installMock(page, 'no-speech');
	await page.goto('/transcribe');
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 'silence.wav', mimeType: 'audio/wav', buffer: wav });
	await page.getByTestId('transcribe-run').click();
	await expect(page.getByRole('status')).toHaveText(
		'発話は検出されませんでした。',
	);
	await expect(page.getByTestId('transcribe-segments')).toHaveCount(0);
	await expect(page.getByTestId('transcribe-download-srt')).toHaveCount(0);
	await expect(page.getByTestId('transcribe-progress')).toHaveCount(0);
	await expect(page.getByTestId('transcribe-run')).toBeEnabled();
});
