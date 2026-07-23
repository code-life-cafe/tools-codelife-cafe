// audio-browser.ts のブラウザ境界テスト（正本「詳細設計書 10-A」）
//
// `loadedmetadata` での duration 事前取得、`decodeAudioData`、および
// Object URL / AudioContext の解放は Node のユニットテストでは検証できないため、
// ここで実際にブラウザ上の公開関数を通して確認する。
//
// 推論だけは Mock Worker に差し替える（実 Whisper モデルは CI へ持ち込まない）。
// 音声ファイルはページ内で生成し、UI 経由で `audio-browser.ts` を実行させる。

import { expect, test } from './fixtures/base';
import {
	delayAudioSrc,
	delayFirstAudioSrc,
	FORCE_INFINITE_DURATION,
	installMock,
	RESOURCE_PROBE,
} from './helpers/transcribe-mock-worker';

declare global {
	interface Window {
		__probe?: {
			urlCreated: number;
			urlRevoked: number;
			ctxCreated: number;
			ctxClosed: number;
		};
	}
}

/**
 * ページ内で PCM WAV を組み立てて file input へ投入する。
 * `bytes` を渡すと WAV ではなくそのバイト列をそのまま使う（デコード失敗の再現用）。
 */
async function dropGeneratedWav(
	page: import('@playwright/test').Page,
	options: { seconds: number; rate?: number; name?: string; garbage?: boolean },
) {
	await page.evaluate(
		({ seconds, rate, name, garbage }) => {
			const input =
				document.querySelector<HTMLInputElement>('input[type=file]');
			if (!input) throw new Error('file input not found');

			let buffer: ArrayBuffer;
			if (garbage) {
				// WAV を名乗るがデコードできないバイト列
				const bytes = new Uint8Array(2048);
				for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
				buffer = bytes.buffer;
			} else {
				const sampleRate = rate ?? 8000;
				const samples = Math.round(sampleRate * seconds);
				buffer = new ArrayBuffer(44 + samples);
				const view = new DataView(buffer);
				const write = (offset: number, text: string) => {
					for (let i = 0; i < text.length; i++) {
						view.setUint8(offset + i, text.charCodeAt(i));
					}
				};
				write(0, 'RIFF');
				view.setUint32(4, 36 + samples, true);
				write(8, 'WAVE');
				write(12, 'fmt ');
				view.setUint32(16, 16, true);
				view.setUint16(20, 1, true); // PCM
				view.setUint16(22, 1, true); // mono
				view.setUint32(24, sampleRate, true);
				view.setUint32(28, sampleRate, true);
				view.setUint16(32, 1, true);
				view.setUint16(34, 8, true); // 8bit
				write(36, 'data');
				view.setUint32(40, samples, true);
				// 8bit PCM の無音は 128。わずかに振幅を付けて無音判定に依存しないようにする
				const pcm = new Uint8Array(buffer, 44);
				for (let i = 0; i < pcm.length; i++) {
					pcm[i] =
						128 +
						Math.round(40 * Math.sin((i / sampleRate) * 2 * Math.PI * 220));
				}
			}

			const transfer = new DataTransfer();
			transfer.items.add(
				new File([buffer], name ?? 'generated.wav', { type: 'audio/wav' }),
			);
			input.files = transfer.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		},
		{
			seconds: options.seconds,
			rate: options.rate ?? null,
			name: options.name ?? null,
			garbage: options.garbage ?? false,
		},
	);
}

async function probe(page: import('@playwright/test').Page) {
	return page.evaluate(() => window.__probe);
}

/**
 * このファイルは実際に decodeAudioData を通すため、全件並列実行では CPU 競合で
 * 既定の5秒を超えることがある（単体では1〜2秒）。待ち時間を延ばした slowExpect を使う。
 */
const slowExpect = expect.configure({ timeout: 60_000 });

// ---------------------------------------------------------------------------
// duration の事前取得（loadedmetadata）
// ---------------------------------------------------------------------------

test('loadedmetadata から有限の duration を取得して表示する', async ({
	page,
}) => {
	await installMock(page, 'ok', [RESOURCE_PROBE]);
	await page.goto('/transcribe');

	await dropGeneratedWav(page, { seconds: 4 });

	await slowExpect(page.getByText('長さ 0分04秒')).toBeVisible();
	await slowExpect(page.getByTestId('transcribe-error')).toHaveCount(0);
});

test('duration が Infinity の場合は事前判定をスキップしてデコードへ進む', async ({
	page,
}) => {
	await installMock(page, 'ok', [RESOURCE_PROBE, FORCE_INFINITE_DURATION]);
	await page.goto('/transcribe');

	await dropGeneratedWav(page, { seconds: 3 });

	// 長さ表示は出ない（事前取得できていない）が、エラーにもしない
	await slowExpect(page.getByText(/^長さ /)).toHaveCount(0);
	await slowExpect(page.getByTestId('transcribe-error')).toHaveCount(0);

	// 実行するとデコードまで進み、完走できる
	await page.getByTestId('transcribe-run').click();
	await slowExpect(page.getByTestId('transcribe-segments')).toContainText(
		'テストです',
	);
});

test('duration を取得できない（メタデータ読み込み失敗）場合もデコードへ進む', async ({
	page,
}) => {
	await installMock(page, 'ok', [RESOURCE_PROBE]);
	await page.goto('/transcribe');

	// `<audio>` が error になるファイル。duration は取れないが即エラーにはしない
	await dropGeneratedWav(page, { seconds: 0, garbage: true });

	await slowExpect(page.getByText(/^長さ /)).toHaveCount(0);
	await slowExpect(page.getByTestId('transcribe-error')).toHaveCount(0);

	// メタデータ取得に失敗しても Object URL は解放されている
	await slowExpect
		.poll(async () => {
			const p = await probe(page);
			return p ? p.urlCreated > 0 && p.urlCreated === p.urlRevoked : false;
		})
		.toBe(true);
});

// ---------------------------------------------------------------------------
// decodeAudioData
// ---------------------------------------------------------------------------

test('decodeAudioData の失敗は decode-failed に正規化される', async ({
	page,
}) => {
	await installMock(page, 'ok', [RESOURCE_PROBE]);
	await page.goto('/transcribe');

	await dropGeneratedWav(page, { seconds: 0, garbage: true });
	await page.getByTestId('transcribe-run').click();

	await slowExpect(page.getByTestId('transcribe-error')).toContainText(
		'音声を読み取れませんでした',
	);

	// 失敗経路でも AudioContext は閉じられる（finally）
	await slowExpect
		.poll(async () => {
			const p = await probe(page);
			return p ? p.ctxCreated > 0 && p.ctxCreated === p.ctxClosed : false;
		})
		.toBe(true);
});

test('デコード後の長さが15分ちょうどなら許可される', async ({ page }) => {
	test.slow();
	await installMock(page, 'ok', [RESOURCE_PROBE]);
	await page.goto('/transcribe');

	// 8000Hz → 16000Hz は 1:2 の整数比なので、デコード後の長さは正確に 900 秒になる
	await dropGeneratedWav(page, { seconds: 900, rate: 8000 });
	// 15分ぶんのデコードとリサンプルが入るため、並列実行時の負荷を見込んで長めに待つ
	await slowExpect(page.getByText('長さ 15分00秒')).toBeVisible();

	await page.getByTestId('transcribe-run').click();

	await slowExpect(page.getByTestId('transcribe-segments')).toContainText(
		'テストです',
	);
	await slowExpect(page.getByTestId('transcribe-error')).toHaveCount(0);
});

test('duration を事前取得できなくても、デコード後の長さが15分超なら file-too-long で停止する', async ({
	page,
}) => {
	test.slow();
	await installMock(page, 'ok', [RESOURCE_PROBE, FORCE_INFINITE_DURATION]);
	await page.goto('/transcribe');

	await dropGeneratedWav(page, { seconds: 901, rate: 8000 });
	// 事前判定は効かない
	await slowExpect(page.getByTestId('transcribe-error')).toHaveCount(0);

	await page.getByTestId('transcribe-run').click();

	// デコード後の AudioBuffer 長で判定されて停止する
	// （15分超のデコードが先に走るため、並列実行時の負荷を見込んで長めに待つ）
	await slowExpect(page.getByTestId('transcribe-error')).toContainText(
		'音声が長すぎます',
	);
});

// ---------------------------------------------------------------------------
// リソース解放
// ---------------------------------------------------------------------------

test('成功経路で Object URL と AudioContext が解放される', async ({ page }) => {
	await installMock(page, 'ok', [RESOURCE_PROBE]);
	await page.goto('/transcribe');

	await dropGeneratedWav(page, { seconds: 3 });
	await page.getByTestId('transcribe-run').click();
	await slowExpect(page.getByTestId('transcribe-segments')).toContainText(
		'テストです',
	);

	const p = await probe(page);
	slowExpect(p).toBeTruthy();
	slowExpect(p?.urlCreated).toBeGreaterThan(0);
	slowExpect(p?.urlRevoked).toBe(p?.urlCreated);
	slowExpect(p?.ctxCreated).toBeGreaterThan(0);
	slowExpect(p?.ctxClosed).toBe(p?.ctxCreated);
});

test('キャンセル経路でも Object URL が解放され、リスナーが残らない', async ({
	page,
}) => {
	await installMock(page, 'stall', [RESOURCE_PROBE]);
	await page.goto('/transcribe');

	await dropGeneratedWav(page, { seconds: 3 });
	await slowExpect(page.getByText('長さ 0分03秒')).toBeVisible();

	await page.getByTestId('transcribe-run').click();
	await slowExpect(page.getByTestId('transcribe-cancel')).toBeVisible();
	await page.getByTestId('transcribe-cancel').click();
	await slowExpect(page.getByTestId('transcribe-cancel')).toHaveCount(0);

	const p = await probe(page);
	// duration 取得で作った Object URL は解放済み。デコードまでは進んでいないので
	// AudioContext は作られていない（作られていれば必ず閉じられている）
	slowExpect(p?.urlCreated).toBeGreaterThan(0);
	slowExpect(p?.urlRevoked).toBe(p?.urlCreated);
	slowExpect(p?.ctxClosed).toBe(p?.ctxCreated);
});

// ---------------------------------------------------------------------------
// ファイル選択のフィードバックと duration 解析の分離（不具合2の修正）
// ---------------------------------------------------------------------------

test('ファイル名は先に表示され、確認中は開始ボタンが無効・完了後に有効になる', async ({
	page,
}) => {
	await installMock(page, 'ok', [RESOURCE_PROBE, delayAudioSrc(500)]);
	await page.goto('/transcribe');

	await dropGeneratedWav(page, { seconds: 3, name: 'generated.wav' });

	// duration 解析（loadedmetadata）がまだ終わっていない間も、ファイル名は既に見える
	await slowExpect(page.getByText('generated.wav')).toBeVisible();
	await slowExpect(
		page.getByTestId('transcribe-metadata-checking'),
	).toBeVisible();
	await slowExpect(page.getByTestId('transcribe-run')).toBeDisabled();

	// 解析完了後は有効化され、長さが表示される
	await slowExpect(
		page.getByTestId('transcribe-metadata-checking'),
	).toHaveCount(0);
	await slowExpect(page.getByText('長さ 0分03秒')).toBeVisible();
	await slowExpect(page.getByTestId('transcribe-run')).toBeEnabled();
});

test('解析中に別ファイルを選び直すと、旧ファイルの結果は新ファイルの表示を上書きしない', async ({
	page,
}) => {
	await installMock(page, 'ok', [RESOURCE_PROBE, delayFirstAudioSrc(2000)]);
	await page.goto('/transcribe');

	// 1ファイル目（a.wav）: loadedmetadata が 2 秒遅延する
	await dropGeneratedWav(page, { seconds: 5, name: 'a.wav' });
	await slowExpect(
		page.getByTestId('transcribe-metadata-checking'),
	).toBeVisible();

	// 解析完了前に 2 ファイル目（b.wav）へ差し替える。b.wav は遅延なしで即解決する
	await dropGeneratedWav(page, { seconds: 3, name: 'b.wav' });
	await slowExpect(page.getByText('長さ 0分03秒')).toBeVisible();

	// a.wav 用の Object URL は、abort により遅延終了を待たず即座に解放されている
	await slowExpect
		.poll(async () => {
			const p = await probe(page);
			return p ? p.urlCreated === p.urlRevoked : false;
		})
		.toBe(true);

	// a.wav の遅延した loadedmetadata が後から発火しても、表示は b.wav のまま
	await page.waitForTimeout(2200);
	await slowExpect(page.getByText('長さ 0分03秒')).toBeVisible();
	await slowExpect(page.getByText('長さ 0分05秒')).toHaveCount(0);
	await slowExpect(page.getByTestId('transcribe-run')).toBeEnabled();
});
