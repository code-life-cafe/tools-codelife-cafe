import { expect, test } from './fixtures/base';

test('成功結果と現在設定を区別し、元に戻す・失敗・キャンセル・連続実行で整合する', async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	// UIの結果ライフサイクルを決定的に検証する。実コーデックは既存実動画テストで検証。
	await page.addInitScript(() => {
		class VideoWorker {
			onmessage: ((event: { data: unknown }) => void) | null = null;
			terminated = false;
			timer = 0;
			thumbnail: boolean;
			constructor(url: string | URL) {
				this.thumbnail = String(url).includes('video-thumbnails.worker');
			}
			postMessage(message: { type: string }) {
				if (this.thumbnail) {
					// サムネイル未取得は仕様上のfallback。圧縮Workerの応答とは分ける。
					this.timer = window.setTimeout(() => this.reply(null), 10);
				} else if (message.type === 'load') {
					this.timer = window.setTimeout(
						() =>
							this.reply({
								type: 'ready',
								info: {
									width: 640,
									height: 360,
									duration: 2.333,
									audioTracks: 1,
									frameRate: 30,
								},
							}),
						10,
					);
				} else {
					const mode = sessionStorage.getItem('test-video-reply');
					if (mode === 'pending') return;
					this.timer = window.setTimeout(
						() =>
							this.reply(
								mode === 'error'
									? { type: 'error', message: 'テスト用圧縮失敗' }
									: { type: 'done', buffer: new ArrayBuffer(32) },
							),
						10,
					);
				}
			}
			reply(data: unknown) {
				if (!this.terminated) this.onmessage?.({ data });
			}
			terminate() {
				this.terminated = true;
				clearTimeout(this.timer);
			}
		}
		Object.defineProperty(window, 'Worker', { value: VideoWorker });
	});
	await page.goto('/video-compress');
	await page.getByLabel('動画を選択、またはここにドロップ').setInputFiles({
		name: 'sample.mp4',
		mimeType: 'video/mp4',
		buffer: Buffer.from('test'),
	});
	const compress = page.getByRole('button', { name: '圧縮する', exact: true });
	const status = page.getByRole('status');
	const result = page.getByRole('region', { name: '圧縮結果', exact: true });
	await expect(compress).toBeEnabled();
	await expect(
		page.getByText(
			'フレームを表示できません。範囲の調整・圧縮は引き続き利用できます。',
		),
	).toBeVisible();
	await compress.click();
	await expect(status).toHaveText('圧縮が完了しました。');
	const url = await page
		.getByRole('link', { name: 'MP4をダウンロード', exact: true })
		.getAttribute('href');
	await page.getByLabel('開始秒').fill('1');
	await page.getByLabel('終了秒').fill('2');
	await page.getByLabel('終了秒').press('Tab');
	await expect(status).toContainText('現在の設定で再圧縮');
	await expect(result.getByRole('heading')).toHaveText('前回の圧縮結果');
	await expect(result).toContainText('現在の設定は反映されていません');
	await expect(
		page.getByRole('link', { name: '前回のMP4をダウンロード' }),
	).toHaveAttribute('href', url ?? '');
	await page.getByLabel('開始秒').fill('0');
	await page.getByLabel('終了秒').fill('2.333');
	await page.getByLabel('終了秒').press('Tab');
	await expect(status).toHaveText('圧縮が完了しました。');
	await expect(result.getByRole('heading')).toHaveText('圧縮結果');
	const quality = page.getByLabel('品質', { exact: true });
	const originalQuality = await quality.inputValue();
	await quality.selectOption(originalQuality === 'low' ? 'high' : 'low');
	await expect(status).toContainText('現在の設定で再圧縮');
	await quality.selectOption(originalQuality);
	await expect(status).toHaveText('圧縮が完了しました。');
	await page.getByLabel('解像度（長辺の上限）').selectOption('854');
	await expect(status).toContainText('現在の設定で再圧縮');
	await compress.click();
	await expect(status).toHaveText('圧縮が完了しました。');
	await expect(result.getByRole('heading')).toHaveText('圧縮結果');
	await page.getByLabel('音声を削除').check();
	await expect(status).toContainText('現在の設定で再圧縮');
	await page.evaluate(() =>
		sessionStorage.setItem('test-video-reply', 'error'),
	);
	await compress.click();
	await expect(page.getByRole('alert')).toContainText('テスト用圧縮失敗');
	await expect(result).toHaveCount(0);
	await expect(status).not.toContainText('完了');
	await page.evaluate(() => sessionStorage.removeItem('test-video-reply'));
	await compress.click();
	await expect(status).toHaveText('圧縮が完了しました。');
	await page.evaluate(() =>
		sessionStorage.setItem('test-video-reply', 'pending'),
	);
	await compress.click();
	await expect(status).toContainText('圧縮中');
	await expect(result).toHaveCount(0);
	await page.getByRole('button', { name: 'キャンセル' }).click();
	await expect(compress).toBeEnabled();
	await expect(result).toHaveCount(0);
	await page.evaluate(() => sessionStorage.removeItem('test-video-reply'));
	await compress.click();
	await expect(status).toHaveText('圧縮が完了しました。');
	const previousUrl = await page
		.getByRole('link', { name: 'MP4をダウンロード', exact: true })
		.getAttribute('href');
	await compress.click();
	await expect(status).toHaveText('圧縮が完了しました。');
	await expect(
		page.getByRole('link', { name: 'MP4をダウンロード', exact: true }),
	).not.toHaveAttribute('href', previousUrl ?? '');
	await expect(result.getByRole('heading')).toHaveText('圧縮結果');
	await page.getByLabel('圧縮方法').selectOption('size');
	await expect(status).toContainText('現在の設定で再圧縮');
	await compress.click();
	await expect(status).toHaveText('圧縮が完了しました。');
	await page.getByLabel('目標容量（MB）').fill('10');
	await expect(status).toContainText('現在の設定で再圧縮');
	expect(pageErrors).toEqual([]);
});
