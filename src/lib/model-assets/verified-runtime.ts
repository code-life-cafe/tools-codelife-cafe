import type { RuntimeArtifact } from '../transcribe/model-manifest.ts';
import type { AssetCache } from './verified-fetch.ts';
import { fetchVerifiedBytes } from './verified-fetch.ts';

// import/instantiateへ渡すのは、実際に検証した同じbytesから作ったBlobだけ。
// 元URLを再取得させないため、検証後のR2差替えやSW cache汚染にも依存しない。
// URLはWorker内で一度だけ準備し、Worker終了時にブラウザが解放する。
export async function prepareVerifiedRuntime(
	runtime: Pick<RuntimeArtifact, 'onnxRuntimeVersion' | 'files'>,
	base: string,
	cache: AssetCache | null,
): Promise<{ mjs: string; wasm: string }> {
	const files = ['mjs', 'wasm'].map((extension) => {
		const path = `${base}.${extension}`;
		const file = runtime.files.find((item) => item.path === path);
		if (!file) throw Error('未登録の実行資産です。');
		return {
			...file,
			url: `/vendor/onnx-wasm/${runtime.onnxRuntimeVersion}/${path}`,
		};
	});
	const buffers: ArrayBuffer[] = [];
	try {
		for (const file of files)
			buffers.push(
				await fetchVerifiedBytes(file, { origin: location.origin, cache }),
			);
	} catch (error) {
		throw Error(
			`実行資産の検証に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const mjs = URL.createObjectURL(
		new Blob([buffers[0]], { type: 'text/javascript' }),
	);
	try {
		return {
			mjs,
			wasm: URL.createObjectURL(
				new Blob([buffers[1]], { type: 'application/wasm' }),
			),
		};
	} catch (error) {
		URL.revokeObjectURL(mjs);
		throw error;
	}
}
