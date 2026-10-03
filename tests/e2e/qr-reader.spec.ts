import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures/base';

const FIXTURES_DIR = path.join(
	process.cwd(),
	'tests',
	'e2e',
	'fixtures',
	'qr-reader',
);
const fixture = (name: string) => path.join(FIXTURES_DIR, name);
const fixtureBase64 = (name: string) =>
	fs.readFileSync(fixture(name)).toString('base64');

test.describe('QRコード読み取りツール', () => {
	test.beforeEach(async ({ page }) => {
		// カメラ映像取得は本テストの対象外（getUserMedia を明示的に拒否させ、
		// 画像アップロードタブへの遷移で操作を継続する）。
		await page.addInitScript(() => {
			// biome-ignore lint/suspicious/noExplicitAny: テスト用モック
			(navigator.mediaDevices as any) ??= {};
			navigator.mediaDevices.getUserMedia = () =>
				Promise.reject(
					new DOMException('Permission denied', 'NotAllowedError'),
				);
		});
	});

	test('ページが正常に読み込まれ、SafetyBadgeが表示される', async ({
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();
		await toolPage.expectSafetyBadge();
	});

	test('カメラ許可拒否時に日本語エラーと画像モードへのリンクが表示される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await expect(
			page.getByText('カメラへのアクセスが許可されませんでした'),
		).toBeVisible();
		const switchButton = page.getByRole('button', {
			name: '画像から読み取りに切り替える',
		});
		await expect(switchButton).toBeVisible();
		await switchButton.click();

		// 画像アップロードUIに切り替わる
		await expect(
			page.getByText('画像をドラッグ＆ドロップ、またはクリックして選択'),
		).toBeVisible();
	});

	test('単一画像アップロードで1件の結果が正しい値で表示される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('single-qr.png'));

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 15000,
		});
		await expect(list).toContainText('https://tools.codelife.cafe/qr-reader');
		await expect(page.getByText('読み取り結果（1件）')).toBeVisible();
	});

	test('1枚に2つのQRを含む画像で2件の結果が同一取得元で表示される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('multi-qr-2codes.png'));

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(2, {
			timeout: 15000,
		});
		await expect(list).toContainText('multi-qr-2codes.png');
	});

	test('複数ファイルを一度にアップロードすると進捗が表示され完了後に消える', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles([
				fixture('single-qr.png'),
				fixture('vcard-qr.png'),
				fixture('wifi-qr.png'),
			]);

		// 進捗表示（処理中テキスト）が一時的に見える
		await expect(page.getByText(/処理中:/)).toBeVisible({ timeout: 5000 });
		// 完了後は消える
		await expect(page.getByText(/処理中:/)).toHaveCount(0, {
			timeout: 15000,
		});

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(3);
	});

	test('QRコードが含まれない画像では0件検出のヒントが表示される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('not-a-qr.png'));

		await expect(page.getByText('QRコードが見つかりませんでした')).toBeVisible({
			timeout: 15000,
		});
	});

	test('同じ値を2回読み取ると2件目に重複バッジが表示される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		const input = page.getByLabel('QRコード画像を選択');
		await input.setInputFiles(fixture('single-qr.png'));

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 15000,
		});

		await input.setInputFiles(fixture('single-qr.png'));
		await expect(list.getByRole('listitem')).toHaveCount(2, {
			timeout: 15000,
		});

		await expect(list.getByRole('listitem').first()).toContainText('重複');
		await expect(list.getByRole('listitem').last()).not.toContainText('重複');
	});

	test('CSVエクスポートでBOM付き・数式インジェクション対策済みのCSVがダウンロードされる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('formula-injection-qr.png'));

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 15000,
		});

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'CSVエクスポート' }).click();
		const download = await downloadPromise;

		const downloadPath = await download.path();
		const fs = await import('node:fs');
		const buffer = fs.readFileSync(downloadPath ?? '');

		// UTF-8 BOM
		expect(buffer[0]).toBe(0xef);
		expect(buffer[1]).toBe(0xbb);
		expect(buffer[2]).toBe(0xbf);

		const text = buffer.toString('utf-8');
		expect(text).toContain('No,日時,値,形式,取得元,重複');
		// 数式インジェクション対策: 先頭に ' が付与される
		expect(text).toMatch(/'=1\+1/);
	});

	test('画像アップロードで読み取り成功トーストが表示され自動的に消える', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('single-qr.png'));

		const toast = page.getByTestId('scan-toast');
		await expect(toast).toContainText('1件検出');
		await expect(toast).toHaveCount(0, { timeout: 3000 });
	});

	test('複数QRを含む画像では検出件数入りトーストが表示される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('multi-qr-2codes.png'));

		await expect(page.getByTestId('scan-toast')).toContainText('2件検出');
	});

	test('prefers-reduced-motion環境でもトーストは表示されるがアニメーションが抑制される', async ({
		page,
		createToolPage,
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('single-qr.png'));

		const toast = page.getByTestId('scan-toast');
		await expect(toast).toContainText('1件検出');
		await expect(toast).toHaveAttribute('data-reduced-motion', 'true');
	});

	test('読み取り音トグルがONの状態をリロード後も保持する', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		const beepSwitch = page.getByRole('switch', { name: '読み取り音' });
		await expect(beepSwitch).not.toBeChecked();
		await beepSwitch.click();
		await expect(beepSwitch).toBeChecked();

		await page.reload();
		await expect(
			page.getByRole('switch', { name: '読み取り音' }),
		).toBeChecked();
	});

	test('キーボード操作でタブ・トグル・ボタンを操作できる', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		const cameraTab = page.getByRole('tab', { name: 'カメラで読み取り' });
		await cameraTab.focus();
		await expect(cameraTab).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(
			page.getByRole('tab', { name: '画像から読み取り' }),
		).toBeFocused();

		const autosaveSwitch = page.getByRole('switch', {
			name: '読み取り結果を自動保存',
		});
		await autosaveSwitch.focus();
		await page.keyboard.press(' ');
		await expect(
			page.getByRole('heading', { name: '自動保存を有効にしますか？' }),
		).toBeVisible();
		await page.keyboard.press('Escape');
	});
});

test.describe('QRコード読み取りツール: 自動保存', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			// biome-ignore lint/suspicious/noExplicitAny: テスト用モック
			(navigator.mediaDevices as any) ??= {};
			navigator.mediaDevices.getUserMedia = () =>
				Promise.reject(
					new DOMException('Permission denied', 'NotAllowedError'),
				);
		});
	});

	test('自動保存OFF時はリロードしても空の一覧で復元ダイアログが出ない', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('single-qr.png'));

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 15000,
		});

		await page.reload();
		await expect(
			page.getByRole('heading', { name: '前回の読み取り結果を復元しますか？' }),
		).toHaveCount(0);
		await expect(
			page.getByText('読み取った結果はまだありません'),
		).toBeVisible();
	});

	test('自動保存ON→リロードで復元確認ダイアログが表示され、確認すると復元される', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		// 自動保存ONにして同意する
		await page.getByRole('switch', { name: '読み取り結果を自動保存' }).click();
		await page.getByRole('button', { name: '同意して有効にする' }).click();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('single-qr.png'));

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 15000,
		});

		await page.reload();

		await expect(
			page.getByRole('heading', { name: '前回の読み取り結果を復元しますか？' }),
		).toBeVisible();
		await page.getByRole('button', { name: '復元する' }).click();

		await expect(list.getByRole('listitem')).toHaveCount(1);
	});

	test('自動保存ON→OFFで確認後にストレージが削除され、リロードしても空のまま', async ({
		page,
		createToolPage,
	}) => {
		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await page.getByRole('switch', { name: '読み取り結果を自動保存' }).click();
		await page.getByRole('button', { name: '同意して有効にする' }).click();

		await page.getByRole('tab', { name: '画像から読み取り' }).click();
		await page
			.getByLabel('QRコード画像を選択')
			.setInputFiles(fixture('single-qr.png'));

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 15000,
		});

		await page.getByRole('switch', { name: '読み取り結果を自動保存' }).click();
		await page.getByRole('button', { name: '無効にして削除する' }).click();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: '前回の読み取り結果を復元しますか？' }),
		).toHaveCount(0);
		await expect(
			page.getByText('読み取った結果はまだありません'),
		).toBeVisible();
	});
});

test.describe('QRコード読み取りツール: カメラ計測（tool_run連射抑止）', () => {
	// 本番回帰の再現: カメラのデコードループは200ms間隔で毎フレームデコードを試みるため、
	// 同一QRをカメラに映し続けるだけで大量のtool_runが発火していた（3 visitsで587件）。
	// canvas.captureStream() で固定QR画像を映し続ける擬似カメラを作り、実際の
	// CameraScanner統合（video→canvas→Worker decode→計測）を通して回帰を検証する。
	test.beforeEach(async ({ page }) => {
		const singleQr = fixtureBase64('single-qr.png');
		const vcardQr = fixtureBase64('vcard-qr.png');
		await page.addInitScript(
			({ singleQr, vcardQr }) => {
				const loadImage = (base64: string) =>
					new Promise<HTMLImageElement>((resolve, reject) => {
						const img = new Image();
						img.onload = () => resolve(img);
						img.onerror = reject;
						img.src = `data:image/png;base64,${base64}`;
					});

				// biome-ignore lint/suspicious/noExplicitAny: テスト用モック
				(navigator.mediaDevices as any) ??= {};
				navigator.mediaDevices.getUserMedia = async () => {
					const canvas = document.createElement('canvas');
					canvas.width = 300;
					canvas.height = 300;
					const ctx = canvas.getContext('2d');
					if (!ctx) throw new Error('2d context unavailable');
					const img = await loadImage(singleQr);
					ctx.drawImage(img, 0, 0, 300, 300);

					// biome-ignore lint/suspicious/noExplicitAny: テスト用グローバルフック
					(window as any).__qrTestSwitchToVcard = async () => {
						const img2 = await loadImage(vcardQr);
						ctx.clearRect(0, 0, 300, 300);
						ctx.drawImage(img2, 0, 0, 300, 300);
					};

					return canvas.captureStream(10) as unknown as MediaStream;
				};
			},
			{ singleQr, vcardQr },
		);
	});

	test('同一QRをカメラに映し続けても新規スキャンのtool_runは1回だけ発火する', async ({
		page,
		createToolPage,
	}) => {
		const runEvents: unknown[] = [];
		await page.route('**/api/event', async (route) => {
			const body = route.request().postDataJSON() as {
				event: string;
				props: { tool: string };
			};
			if (body.event === 'tool_run' && body.props.tool === 'qr-reader') {
				runEvents.push(body);
			}
			await route.fulfill({ status: 204, body: '' });
		});

		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		// カメラアクティブ（＝デコードループ開始）を待つ
		await expect(page.getByTestId('qr-viewfinder')).toBeVisible({
			timeout: 10000,
		});

		// 同一QRを検出結果一覧に反映させ、デコードループが数回まわるまで待つ
		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 10000,
		});

		// 数十フレーム相当（200ms間隔のデコードループを十分な回数）映し続けても
		// 新規スキャンとしての計測は1回のまま増えないことを確認する
		await page.waitForTimeout(3000);
		expect(runEvents.length).toBe(1);
		await expect(list.getByRole('listitem')).toHaveCount(1);
	});

	test('異なるQRを提示すると2件目のtool_runが発火する', async ({
		page,
		createToolPage,
	}) => {
		const runEvents: unknown[] = [];
		await page.route('**/api/event', async (route) => {
			const body = route.request().postDataJSON() as {
				event: string;
				props: { tool: string };
			};
			if (body.event === 'tool_run' && body.props.tool === 'qr-reader') {
				runEvents.push(body);
			}
			await route.fulfill({ status: 204, body: '' });
		});

		const toolPage = createToolPage('qr-reader');
		await toolPage.goto();

		await expect(page.getByTestId('qr-viewfinder')).toBeVisible({
			timeout: 10000,
		});

		const list = page.getByRole('list', { name: 'QRコード読み取り結果一覧' });
		await expect(list.getByRole('listitem')).toHaveCount(1, {
			timeout: 10000,
		});
		await expect.poll(() => runEvents.length, { timeout: 5000 }).toBe(1);

		// 異なるQRをカメラに提示する（＝明示的に別コードへ切り替える操作）
		await page.evaluate(async () => {
			// biome-ignore lint/suspicious/noExplicitAny: テスト用グローバルフック
			await (window as any).__qrTestSwitchToVcard();
		});

		await expect(list.getByRole('listitem')).toHaveCount(2, {
			timeout: 10000,
		});
		await expect.poll(() => runEvents.length, { timeout: 5000 }).toBe(2);
	});
});
