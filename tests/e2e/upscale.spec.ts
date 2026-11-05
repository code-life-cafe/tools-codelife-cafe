import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/base.ts';

// 推論は重く CDN からモデル/ランタイムを取得するため、待機時間を長めに確保する。
const RESULT_TIMEOUT = 120_000;

/**
 * 指定サイズのテスト画像をブラウザ内で生成し、ファイル入力へ流し込む。
 * バイナリフィクスチャを増やさずに済むよう canvas から File を作る
 * （image-compress.spec の手法と同じ）。
 */
async function uploadGeneratedImage(page: Page, w: number, h: number) {
	await page.evaluate(
		async ({ w, h }) => {
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			const ctx = c.getContext('2d');
			if (!ctx) return;
			// 斜めグラデ＋矩形でディテールのある画像にする
			const g = ctx.createLinearGradient(0, 0, w, h);
			g.addColorStop(0, '#ff3030');
			g.addColorStop(1, '#3060ff');
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, w, h);
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(
				Math.floor(w / 4),
				Math.floor(h / 4),
				Math.floor(w / 2),
				Math.floor(h / 2),
			);
			const blob = await new Promise<Blob | null>((res) =>
				c.toBlob(res, 'image/png'),
			);
			if (!blob) return;
			const file = new File([blob], 'tiny.png', { type: 'image/png' });
			const dt = new DataTransfer();
			dt.items.add(file);
			const input = document.querySelector(
				'input[data-testid="upscale-file-input"]',
			) as HTMLInputElement;
			input.files = dt.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		},
		{ w, h },
	);
}

test.describe('画像アップスケール', () => {
	test.beforeEach(async ({ createToolPage }) => {
		const toolPage = createToolPage('upscale');
		await toolPage.goto();
	});

	test('ページ表示・SafetyBadge・プライバシー注記', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('upscale');
		await toolPage.expectTitle('画像アップスケール');
		await toolPage.expectSafetyBadge();
		await expect(
			page
				.getByText('画像はサーバーに送信されません', { exact: false })
				.first(),
		).toBeVisible();
	});

	test('推論ランタイム/モデルは初期表示では読み込まれず、実行時に遅延ロードされる', async ({
		page,
	}) => {
		// 初期表示直後は ORT / モデルへのリクエストが発生していないこと
		const requests: string[] = [];
		page.on('request', (r) => requests.push(r.url()));
		await uploadGeneratedImage(page, 64, 64);
		// アップロード処理（解像度検証等の非同期処理）完了後に表示される実行ボタンを
		// 待つことで、モデル/ランタイム未取得の判定を確定させてから検証する
		await expect(page.locator('[data-testid="upscale-run"]')).toBeVisible();
		expect(
			requests.some((u) => /onnxruntime-web|\.onnx/.test(u)),
			'アップロード時点ではモデル/ランタイム未取得',
		).toBe(false);

		// 実行時にモデル(/models/*.onnx)またはランタイム(jsdelivr)を取得する
		const modelReq = page.waitForRequest(
			(r) => /realesr-general-x4v3\.onnx|onnxruntime-web/.test(r.url()),
			{ timeout: RESULT_TIMEOUT },
		);
		await page.locator('[data-testid="upscale-run"]').click();
		await modelReq;
	});

	test('極小画像を4xアップスケールし、出力解像度が4倍になりDLできる', async ({
		page,
	}) => {
		test.slow();
		await uploadGeneratedImage(page, 64, 64);
		// 既定: 高速モデル・4x
		await page.locator('[data-testid="upscale-run"]').click();
		await page
			.locator('[data-testid="upscale-download"]')
			.waitFor({ state: 'visible', timeout: RESULT_TIMEOUT });

		// 出力画像の自然サイズが 256x256（64x4）
		const dims = await page.evaluate(() => {
			const img = document.querySelector(
				'[data-testid="upscale-result"] img',
			) as HTMLImageElement | null;
			return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
		});
		expect(dims).toEqual({ w: 256, h: 256 });

		// ダウンロード（ファイル名＋PNGシグネチャ）
		const dlPromise = page.waitForEvent('download');
		await page.locator('[data-testid="upscale-download"]').click();
		const dl = await dlPromise;
		expect(dl.suggestedFilename()).toBe('tiny_upscaled_4x.png');
	});

	for (const scale of [2, 4]) {
		for (const denoise of [false, true]) {
			test(`透過PNGの透明・半透明・不透明を保持する (${scale}倍、ノイズ除去=${denoise})`, async ({
				page,
			}) => {
				test.slow();
				await page.evaluate(async () => {
					const canvas = document.createElement('canvas');
					canvas.width = 12;
					canvas.height = 4;
					const ctx = canvas.getContext('2d');
					if (!ctx) throw new Error('Canvasを初期化できません');
					// 透明、半透明、不透明の3領域。境界から離れた中心を検査する。
					ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
					ctx.fillRect(4, 0, 4, 4);
					ctx.fillStyle = '#00ff00';
					ctx.fillRect(8, 0, 4, 4);
					const blob = await new Promise<Blob | null>((resolve) =>
						canvas.toBlob(resolve, 'image/png'),
					);
					if (!blob) throw new Error('PNGを生成できません');
					const input = document.querySelector<HTMLInputElement>(
						'[data-testid="upscale-file-input"]',
					);
					if (!input) throw new Error('画像入力がありません');
					const transfer = new DataTransfer();
					transfer.items.add(
						new File([blob], 'alpha.png', { type: 'image/png' }),
					);
					input.files = transfer.files;
					input.dispatchEvent(new Event('change', { bubbles: true }));
				});
				await page
					.getByRole('button', { name: `${scale}倍`, exact: true })
					.click();
				await page
					.getByRole('switch', { name: 'ノイズ除去' })
					.setChecked(denoise);
				await page.getByTestId('upscale-run').click();
				await expect(page.getByTestId('upscale-download')).toBeVisible({
					timeout: RESULT_TIMEOUT,
				});
				const downloadPromise = page.waitForEvent('download');
				await page.getByTestId('upscale-download').click();
				const download = await downloadPromise;
				expect(download.suggestedFilename()).toBe(
					`alpha_upscaled_${scale}x.png`,
				);
				const stream = await download.createReadStream();
				if (!stream) throw new Error('ダウンロードを読み取れません');
				const chunks: Buffer[] = [];
				for await (const chunk of stream) chunks.push(Buffer.from(chunk));
				const pixels = await page.evaluate(
					async ({ bytes, scale }) => {
						const bitmap = await createImageBitmap(
							new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
						);
						const canvas = document.createElement('canvas');
						canvas.width = bitmap.width;
						canvas.height = bitmap.height;
						const ctx = canvas.getContext('2d');
						if (!ctx) throw new Error('Canvasを初期化できません');
						ctx.drawImage(bitmap, 0, 0);
						bitmap.close();
						return {
							width: canvas.width,
							height: canvas.height,
							alpha: [2, 6, 10].map(
								(x) => ctx.getImageData(x * scale, 2 * scale, 1, 1).data[3],
							),
						};
					},
					{ bytes: Array.from(Buffer.concat(chunks)), scale },
				);
				expect(pixels).toEqual({
					width: 12 * scale,
					height: 4 * scale,
					alpha: [0, 128, 255],
				});
			});
		}
	}

	test('解像度上限超過は日本語エラー', async ({ page }) => {
		await uploadGeneratedImage(page, 2001, 100);
		await expect(page.getByRole('alert')).toContainText('2000px');
	});

	test('375px / 1440px でレスポンシブ表示される', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.getByText(/画像をドラッグ/)).toBeVisible();

		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(page.getByText(/画像をドラッグ/)).toBeVisible();
	});
});
