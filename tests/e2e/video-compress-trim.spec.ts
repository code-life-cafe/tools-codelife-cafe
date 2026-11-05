import type { VideoJob } from '../../src/lib/tools/video-compress.ts';
import { expect, test } from './fixtures/base.ts';

declare global {
	interface Window {
		__trimJobs?: VideoJob[];
	}
}

// 長尺メタデータだけを差し替える配線テスト。実エンコードは video-compress.spec.ts の担当。
// ミューテーション対象: VideoTrimRange の bounds を end - step / start + step に戻すと、
// 各入力確定後の値・スライダー・Workerへ渡すjobの検査が失敗する。
for (const duration of [600.5, 3600]) {
	for (const lastField of ['開始秒', '終了秒']) {
		test(`${duration}秒動画で${lastField}から0.5秒の範囲を確定し書き出しへ渡す（#591）`, async ({
			page,
		}) => {
			await page.addInitScript(
				({ duration }) => {
					window.__trimJobs = [];
					class VideoWorker {
						onmessage: ((event: { data: unknown }) => void) | null = null;
						terminated = false;
						thumbnail: boolean;
						constructor(url: string | URL) {
							this.thumbnail = String(url).includes('video-thumbnails.worker');
						}
						postMessage(message: { type?: string; job?: VideoJob }) {
							let data: unknown = null;
							if (!this.thumbnail && message.type === 'load') {
								data = {
									type: 'ready',
									info: {
										width: 640,
										height: 360,
										duration,
										audioTracks: 0,
										frameRate: 30,
									},
								};
							} else if (
								!this.thumbnail &&
								message.type === 'compress' &&
								message.job
							) {
								window.__trimJobs?.push(structuredClone(message.job));
								data = { type: 'done', buffer: new ArrayBuffer(32) };
							}
							queueMicrotask(() => {
								if (!this.terminated) this.onmessage?.({ data });
							});
						}
						terminate() {
							this.terminated = true;
						}
					}
					Object.defineProperty(window, 'Worker', {
						configurable: true,
						value: VideoWorker,
					});
				},
				{ duration },
			);
			await page.goto('/video-compress');
			await page.getByLabel('動画を選択、またはここにドロップ').setInputFiles({
				name: 'long.mp4',
				mimeType: 'video/mp4',
				buffer: Buffer.from('metadata fixture'),
			});
			const compress = page.getByRole('button', {
				name: '圧縮する',
				exact: true,
			});
			const start = page.getByLabel('開始秒', { exact: true });
			const end = page.getByLabel('終了秒', { exact: true });
			await expect(start).toHaveValue('0');
			await expect(end).toHaveValue(String(duration));
			await expect(start).toBeEnabled();
			await expect(end).toBeEnabled();
			// 3600秒の全尺は推定出力128MiBの上限を超えるが、範囲入力は可能。
			const outputLimitError = page.getByRole('alert').filter({
				hasText: '推定出力が128MiBを超えます。',
			});
			if (duration === 3600) {
				await expect(outputLimitError).toBeVisible();
				await expect(compress).toBeDisabled();
			} else {
				await expect(compress).toBeEnabled();
			}
			// 両方向のclampを検出するため、最後に狭める入力を入れ替える。
			const fields =
				lastField === '開始秒'
					? ([
							[end, '100.50'],
							[start, '100.00'],
						] as const)
					: ([
							[start, '100.00'],
							[end, '100.50'],
						] as const);
			for (const [field, value] of fields) {
				await field.fill(value);
				await field.press('Tab');
			}
			await expect(start).toHaveValue('100');
			await expect(end).toHaveValue('100.5');
			await expect(
				page.getByRole('slider', { name: '開始位置' }),
			).toHaveAttribute('aria-valuenow', '100');
			await expect(
				page.getByRole('slider', { name: '終了位置' }),
			).toHaveAttribute('aria-valuenow', '100.5');
			await expect(
				page.getByText('書き出し 0.50秒', { exact: true }),
			).toBeVisible();
			// 数値入力の最小間隔は0.01秒。0.5秒の範囲確定後は圧縮できる。
			await expect(outputLimitError).toHaveCount(0);
			await expect(compress).toBeEnabled();
			await compress.click();
			await expect(page.getByRole('status')).toHaveText('圧縮が完了しました。');
			expect(
				await page.evaluate(() =>
					window.__trimJobs?.map(({ start, end }) => ({ start, end })),
				),
			).toEqual([{ start: 100, end: 100.5 }]);
		});
	}
}
