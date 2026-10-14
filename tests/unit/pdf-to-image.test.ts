// 実行方法: npm run test:unit（単体: node --test tests/unit/pdf-to-image.test.ts）
//
// PDF→JPG/PNG変換のロジックを、計画のAC（ページ範囲・形式・dpi・品質の厳密な検証、
// 連番ファイル名、16メガピクセル上限、逐次処理・キャンセル、保持容量の上限）から検証する。
// ページ描画は偽の実装に差し替え、実際の描画（回転・透過）は E2E で検証する。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type PageSizePt, PdfToolError } from '../../src/lib/pdf/common.ts';
import {
	allPagesInput,
	convertPdfPages,
	DEFAULT_PDF_TO_IMAGE_SETTINGS,
	imageFileName,
	type PageImageRenderer,
	resolvePageSelection,
	sanitizePdfToImageSettings,
} from '../../src/lib/tools/pdf-to-image.ts';

type RenderCall = {
	pageNumber: number;
	width: number;
	height: number;
	format: string;
	quality: number;
};

function fakeRenderer(
	sizes: PageSizePt[],
	options: { blobSize?: number; onRender?: (call: RenderCall) => void } = {},
): PageImageRenderer & { calls: RenderCall[] } {
	const calls: RenderCall[] = [];
	return {
		calls,
		pageCount: sizes.length,
		async getPageSize(n) {
			return sizes[n - 1];
		},
		async renderImage(pageNumber, size, format, quality) {
			const call = { pageNumber, ...size, format, quality };
			calls.push(call);
			options.onRender?.(call);
			return new Blob([new Uint8Array(options.blobSize ?? 10)], {
				type: format === 'png' ? 'image/png' : 'image/jpeg',
			});
		},
	};
}

const A4 = { widthPt: 595, heightPt: 842 };

async function rejects(
	promise: Promise<unknown>,
	code: string,
	includes?: string,
) {
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof PdfToolError, `PdfToolError expected: ${error}`);
		assert.equal(error.code, code);
		if (includes) assert.ok(error.message.includes(includes), error.message);
		return true;
	});
}

// ---- ページ範囲 ----

test('resolvePageSelection: 範囲・単独・末尾省略を重複なしの昇順にする', () => {
	assert.deepEqual(resolvePageSelection('5,1-3,2', 6), {
		ok: true,
		pages: [1, 2, 3, 5],
	});
	assert.deepEqual(resolvePageSelection('4-', 6), {
		ok: true,
		pages: [4, 5, 6],
	});
	// 全角数字・全角カンマ・空白を許容する
	assert.deepEqual(resolvePageSelection('１－２、 ４', 6), {
		ok: true,
		pages: [1, 2, 4],
	});
});

test('resolvePageSelection: 0・範囲外・逆順・空・不正文字を日本語エラーにする', () => {
	const errorsOf = (input: string) => {
		const result = resolvePageSelection(input, 5);
		assert.equal(result.ok, false, input);
		return result.ok ? '' : result.errors.map((e) => e.message).join('\n');
	};
	assert.match(errorsOf('0'), /1以上/);
	assert.match(errorsOf('6'), /全5ページ/);
	assert.match(errorsOf('4-2'), /終了は開始以上/);
	assert.match(errorsOf(''), /ページ範囲を入力してください/);
	assert.match(errorsOf('1,,2'), /空の指定/);
	assert.match(errorsOf('abc'), /解釈できません/);
	assert.match(errorsOf('1.5'), /解釈できません/);
});

test('allPagesInput: 全ページ指定の初期値', () => {
	assert.equal(allPagesInput(1), '1');
	assert.equal(allPagesInput(12), '1-12');
	assert.deepEqual(resolvePageSelection(allPagesInput(12), 12), {
		ok: true,
		pages: Array.from({ length: 12 }, (_, i) => i + 1),
	});
});

// ---- ファイル名 ----

test('imageFileName: 総ページ数の桁で0埋めした連番と形式の拡張子', () => {
	assert.equal(imageFileName('資料', 3, 9, 'jpeg'), '資料_p03.jpg');
	assert.equal(imageFileName('資料', 3, 100, 'png'), '資料_p003.png');
	assert.equal(imageFileName('doc', 100, 100, 'jpeg'), 'doc_p100.jpg');
	// 辞書順に並べてもページ順になる
	const names = [10, 2, 1].map((p) => imageFileName('d', p, 12, 'png'));
	assert.deepEqual([...names].sort(), ['d_p01.png', 'd_p02.png', 'd_p10.png']);
});

// ---- 設定 ----

test('sanitizePdfToImageSettings: 許可値のみ採用し、不正値は既定へ戻す', () => {
	const d = DEFAULT_PDF_TO_IMAGE_SETTINGS;
	assert.deepEqual(
		sanitizePdfToImageSettings({ format: 'png', dpi: 72, jpegQuality: 50 }, d),
		{ format: 'png', dpi: 72, jpegQuality: 50 },
	);
	assert.deepEqual(
		sanitizePdfToImageSettings(
			{ format: 'webp', dpi: '144', jpegQuality: 0.85, pages: '1-3' },
			d,
		),
		d,
	);
	assert.deepEqual(sanitizePdfToImageSettings('x', d), d);
});

// ---- 変換 ----

test('convertPdfPages: 選択ページだけを順に、dpiに応じた画素数・指定形式・品質で描画する', async () => {
	const renderer = fakeRenderer([A4, { widthPt: 842, heightPt: 595 }, A4]);
	const progress: Array<[number, number]> = [];
	const result = await convertPdfPages(
		renderer,
		[2, 3],
		{ format: 'png', dpi: 96, jpegQuality: 70 },
		'sample',
		{ onProgress: (d, t) => progress.push([d, t]) },
	);
	assert.equal(result.stoppedBeforePage, null);
	// 96dpi = 4/3倍、四捨五入
	assert.deepEqual(renderer.calls, [
		{ pageNumber: 2, width: 1123, height: 793, format: 'png', quality: 70 },
		{ pageNumber: 3, width: 793, height: 1123, format: 'png', quality: 70 },
	]);
	assert.deepEqual(
		result.images.map((i) => [i.pageNumber, i.fileName, i.width, i.height]),
		[
			[2, 'sample_p02.png', 1123, 793],
			[3, 'sample_p03.png', 793, 1123],
		],
	);
	assert.deepEqual(progress, [
		[0, 2],
		[1, 2],
		[2, 2],
	]);
});

test('convertPdfPages: 16メガピクセル超のページを含む場合は描画前に拒否する', async () => {
	const renderer = fakeRenderer([A4, { widthPt: 3000, heightPt: 3000 }]);
	await rejects(
		convertPdfPages(renderer, [1, 2], DEFAULT_PDF_TO_IMAGE_SETTINGS, 'd'),
		'too-many-pixels',
		'2ページ目は144dpiで6000×6000px',
	);
	assert.equal(renderer.calls.length, 0);
	// 対象外のページなら上限に関係しない
	const ok = await convertPdfPages(
		renderer,
		[1],
		DEFAULT_PDF_TO_IMAGE_SETTINGS,
		'd',
	);
	assert.equal(ok.images.length, 1);
	// 72dpi なら 3000×3000px（9MP）で処理できる
	const low = await convertPdfPages(
		renderer,
		[2],
		{ ...DEFAULT_PDF_TO_IMAGE_SETTINGS, dpi: 72 },
		'd',
	);
	assert.deepEqual([low.images[0].width, low.images[0].height], [3000, 3000]);
});

test('convertPdfPages: キャンセル後は次のページを描画せず cancelled を投げる', async () => {
	const controller = new AbortController();
	const renderer = fakeRenderer([A4, A4, A4, A4], {
		onRender: (call) => {
			if (call.pageNumber === 2) controller.abort();
		},
	});
	await rejects(
		convertPdfPages(
			renderer,
			[1, 2, 3, 4],
			DEFAULT_PDF_TO_IMAGE_SETTINGS,
			'd',
			{
				signal: controller.signal,
			},
		),
		'cancelled',
	);
	assert.deepEqual(
		renderer.calls.map((c) => c.pageNumber),
		[1, 2],
	);
});

test('convertPdfPages: 保持容量の上限に達したら、それ以降を変換せず停止ページを返す', async () => {
	const renderer = fakeRenderer([A4, A4, A4, A4], { blobSize: 40 });
	const result = await convertPdfPages(
		renderer,
		[1, 2, 3, 4],
		DEFAULT_PDF_TO_IMAGE_SETTINGS,
		'd',
		{ maxResultBytes: 100 },
	);
	// 40+40=80 は保持、3ページ目で120になるため破棄して停止
	assert.deepEqual(
		result.images.map((i) => i.pageNumber),
		[1, 2],
	);
	assert.equal(result.stoppedBeforePage, 3);
	assert.equal(renderer.calls.length, 3);
});

test('convertPdfPages: 不正なページ・空のページ指定・不正な設定・ページ数上限を拒否する', async () => {
	const renderer = fakeRenderer([A4, A4]);
	const settings = DEFAULT_PDF_TO_IMAGE_SETTINGS;
	await rejects(convertPdfPages(renderer, [], settings, 'd'), 'invalid-option');
	await rejects(
		convertPdfPages(renderer, [3], settings, 'd'),
		'invalid-option',
		'範囲外',
	);
	await rejects(
		convertPdfPages(renderer, [0], settings, 'd'),
		'invalid-option',
	);
	await rejects(
		convertPdfPages(renderer, [1.5], settings, 'd'),
		'invalid-option',
	);
	await rejects(
		convertPdfPages(
			renderer,
			[1],
			{ ...settings, format: 'gif' as never },
			'd',
		),
		'invalid-option',
		'JPGまたはPNG',
	);
	await rejects(
		convertPdfPages(renderer, [1], { ...settings, dpi: 300 as never }, 'd'),
		'invalid-option',
		'72 / 96 / 144dpi',
	);
	await rejects(
		convertPdfPages(
			renderer,
			[1],
			{ ...settings, jpegQuality: 0.9 as never },
			'd',
		),
		'invalid-option',
	);
	await rejects(
		convertPdfPages(
			fakeRenderer(Array.from({ length: 101 }, () => A4)),
			[1],
			settings,
			'd',
		),
		'too-many-pages',
	);
	assert.equal(renderer.calls.length, 0);
});

test('convertPdfPages: 100ページと16MPちょうどを許可し、16MP超は描画前に拒否する', async () => {
	const hundred = fakeRenderer(Array.from({ length: 100 }, () => A4));
	const result = await convertPdfPages(
		hundred,
		[100],
		DEFAULT_PDF_TO_IMAGE_SETTINGS,
		'd',
	);
	assert.equal(result.images[0].pageNumber, 100);
	const settings = { ...DEFAULT_PDF_TO_IMAGE_SETTINGS, dpi: 72 } as const;
	const exact = fakeRenderer([{ widthPt: 4000, heightPt: 4000 }]);
	assert.equal(
		(await convertPdfPages(exact, [1], settings, 'd')).images.length,
		1,
	);
	const over = fakeRenderer([{ widthPt: 4000, heightPt: 4001 }]);
	await rejects(convertPdfPages(over, [1], settings, 'd'), 'too-many-pixels');
	assert.equal(over.calls.length, 0);
});

test('convertPdfPages: 開始前のキャンセルでは1ページも描画しない', async () => {
	const renderer = fakeRenderer([A4]);
	await rejects(
		convertPdfPages(renderer, [1], DEFAULT_PDF_TO_IMAGE_SETTINGS, 'd', {
			signal: AbortSignal.abort(),
		}),
		'cancelled',
	);
	assert.equal(renderer.calls.length, 0);
});
