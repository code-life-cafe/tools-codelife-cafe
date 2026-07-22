// model-manifest.ts — /transcribe のモデル成果物マニフェスト（自動生成・手で編集しない）
//
// 生成: node scripts/generate-transcribe-manifest.mjs
// 正本: https://app.notion.com/p/396dfd36033681cba834ecd64d6167b3 「詳細設計書 4.」
//
// ここに列挙されたファイルだけを R2 / 同一オリジン `/models/transcribe/` から配信する。
// マニフェスト外のパス解決・Hugging Face へのフォールバックは禁止。

export type ModelId = 'tiny' | 'base' | 'small';

/** transformers.js の DATA_TYPES のうち本ツールで使い得るもの */
export type DtypeName =
	| 'fp32'
	| 'fp16'
	| 'int8'
	| 'uint8'
	| 'q8'
	| 'q4'
	| 'bnb4';

export type ArtifactFile = {
	/** repositoryPath からの相対パス */
	path: string;
	bytes: number;
	/** 小文字16進の sha256 */
	sha256: string;
};

export type ModelArtifact = {
	id: ModelId;
	/** transformers.js の pipeline へ渡すモデルID（= 配信ディレクトリ名） */
	modelId: string;
	/** 変換元の正確なモデルID */
	sourceRepository: string;
	/** タグではなくコミットハッシュ */
	revision: string;
	/** /models/transcribe/ 配下の相対パス */
	repositoryPath: string;
	dtype: { webgpu: DtypeName; wasm: DtypeName };
	license: { spdx: string; sourceUrl: string; noticePath?: string };
	files: ArtifactFile[];
	totalBytes: number;
};

export type RuntimeArtifact = {
	transformersVersion: string;
	onnxRuntimeVersion: string;
	files: ArtifactFile[];
};

/** 同一オリジンのモデル配信ルート（Cloudflare 側で R2 へプロキシする） */
export const MODEL_BASE_PATH = '/models/transcribe/';

/** ONNX Runtime Web の WASM 配信ルート（CDN 既定へのフォールバックは禁止） */
export const ONNX_WASM_BASE_PATH = '/vendor/onnx-wasm/';

export const MODEL_ARTIFACTS: readonly ModelArtifact[] = [
	{
		id: 'tiny',
		modelId: 'whisper-tiny',
		sourceRepository: 'onnx-community/whisper-tiny',
		revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
		repositoryPath: 'whisper-tiny/',
		dtype: {
			wasm: 'bnb4',
			webgpu: 'q8',
		},
		license: {
			spdx: 'MIT',
			sourceUrl: 'https://huggingface.co/onnx-community/whisper-tiny',
			noticePath: 'THIRD-PARTY-NOTICES.md',
		},
		files: [
			{
				path: 'config.json',
				bytes: 2243,
				sha256:
					'46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d',
			},
			{
				path: 'generation_config.json',
				bytes: 3772,
				sha256:
					'f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1',
			},
			{
				path: 'onnx/decoder_model_merged_bnb4.onnx',
				bytes: 86124414,
				sha256:
					'fd66992a760913909e01c151ea4b42de738ab7a5c6268ed4399fda545cb8dfbf',
			},
			{
				path: 'onnx/decoder_model_merged_quantized.onnx',
				bytes: 30719241,
				sha256:
					'25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3',
			},
			{
				path: 'onnx/encoder_model_bnb4.onnx',
				bytes: 8578451,
				sha256:
					'c8596d911d020092caa4d80bf06929f4a0c5f573701a6882bc37dd761dc383bf',
			},
			{
				path: 'onnx/encoder_model_quantized.onnx',
				bytes: 10124990,
				sha256:
					'2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19',
			},
			{
				path: 'preprocessor_config.json',
				bytes: 339,
				sha256:
					'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
			},
			{
				path: 'tokenizer_config.json',
				bytes: 282683,
				sha256:
					'2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
			},
			{
				path: 'tokenizer.json',
				bytes: 2480466,
				sha256:
					'27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
			},
		],
		totalBytes: 138316599,
	},
	{
		id: 'base',
		modelId: 'whisper-base',
		sourceRepository: 'onnx-community/whisper-base',
		revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
		repositoryPath: 'whisper-base/',
		dtype: {
			wasm: 'bnb4',
			webgpu: 'q8',
		},
		license: {
			spdx: 'MIT',
			sourceUrl: 'https://huggingface.co/onnx-community/whisper-base',
			noticePath: 'THIRD-PARTY-NOTICES.md',
		},
		files: [
			{
				path: 'config.json',
				bytes: 2243,
				sha256:
					'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b',
			},
			{
				path: 'generation_config.json',
				bytes: 3832,
				sha256:
					'61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0',
			},
			{
				path: 'onnx/decoder_model_merged_bnb4.onnx',
				bytes: 122030467,
				sha256:
					'c89adc212fe988bec3013348e6e78c0b9d587177ae67de583f24d751924cb613',
			},
			{
				path: 'onnx/decoder_model_merged_quantized.onnx',
				bytes: 53693315,
				sha256:
					'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b',
			},
			{
				path: 'onnx/encoder_model_bnb4.onnx',
				bytes: 17593091,
				sha256:
					'e85d47267b8a146e3d7b8fdceae5cf8081e3e9b1e5e66afb7de50e40481096b8',
			},
			{
				path: 'onnx/encoder_model_quantized.onnx',
				bytes: 23201314,
				sha256:
					'5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46',
			},
			{
				path: 'preprocessor_config.json',
				bytes: 339,
				sha256:
					'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
			},
			{
				path: 'tokenizer_config.json',
				bytes: 282682,
				sha256:
					'2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573',
			},
			{
				path: 'tokenizer.json',
				bytes: 2480466,
				sha256:
					'27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
			},
		],
		totalBytes: 219287749,
	},
	{
		id: 'small',
		modelId: 'whisper-small',
		sourceRepository: 'onnx-community/whisper-small',
		revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
		repositoryPath: 'whisper-small/',
		dtype: {
			wasm: 'bnb4',
			webgpu: 'q8',
		},
		license: {
			spdx: 'MIT',
			sourceUrl: 'https://huggingface.co/onnx-community/whisper-small',
			noticePath: 'THIRD-PARTY-NOTICES.md',
		},
		files: [
			{
				path: 'config.json',
				bytes: 2227,
				sha256:
					'457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18',
			},
			{
				path: 'generation_config.json',
				bytes: 3893,
				sha256:
					'f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0',
			},
			{
				path: 'onnx/decoder_model_merged_bnb4.onnx',
				bytes: 226073167,
				sha256:
					'783b50b5a9f30f6c1f45e7d695ed40af55c14f6a6b395c7a30002598ac4217fd',
			},
			{
				path: 'onnx/decoder_model_merged_quantized.onnx',
				bytes: 156750845,
				sha256:
					'ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9',
			},
			{
				path: 'onnx/encoder_model_bnb4.onnx',
				bytes: 60874216,
				sha256:
					'5ed12f343f004e5060719d2cf892b5c5e801e89919c1649f55bea78227c84040',
			},
			{
				path: 'onnx/encoder_model_quantized.onnx',
				bytes: 92326160,
				sha256:
					'a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92',
			},
			{
				path: 'preprocessor_config.json',
				bytes: 339,
				sha256:
					'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
			},
			{
				path: 'tokenizer_config.json',
				bytes: 282683,
				sha256:
					'2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
			},
			{
				path: 'tokenizer.json',
				bytes: 2480466,
				sha256:
					'27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
			},
		],
		totalBytes: 538793996,
	},
];

export const RUNTIME_ARTIFACT: RuntimeArtifact = {
	transformersVersion: '4.2.0',
	onnxRuntimeVersion: '1.26.0-dev.20260416-b7804b056c',
	files: [
		{
			path: 'ort-wasm-simd-threaded.asyncify.mjs',
			bytes: 47389,
			sha256:
				'5959c6733039619c9af710d8e1bae8d6e84402787990637be987c2b1bd6c5fa9',
		},
		{
			path: 'ort-wasm-simd-threaded.asyncify.wasm',
			bytes: 23567050,
			sha256:
				'e0c0c6d3e73d43b8a249972f8358f845b08cc16fec3c80efafdf8bed40366786',
		},
		{
			path: 'ort-wasm-simd-threaded.mjs',
			bytes: 24180,
			sha256:
				'5f2cd914554830762579c372d0211614c1e3f40ab3f6c0cfcf0900343229071d',
		},
		{
			path: 'ort-wasm-simd-threaded.wasm',
			bytes: 12942611,
			sha256:
				'f4f290847a4df02d0b93cdbf39b4b0e71acefbe80573e7e6b9342a7abd7b290a',
		},
	],
};

export const MODEL_IDS: readonly ModelId[] = MODEL_ARTIFACTS.map((m) => m.id);

export function getModelArtifact(id: ModelId): ModelArtifact {
	const artifact = MODEL_ARTIFACTS.find((m) => m.id === id);
	if (!artifact) throw new Error(`未知のモデルIDです: ${id}`);
	return artifact;
}

/**
 * 同一オリジン配信で許可するパス一覧（先頭スラッシュ付き）。
 * Pages Function / テストの許可リストはこれを正本とする。
 */
export function listAllowedModelPaths(): string[] {
	return MODEL_ARTIFACTS.flatMap((m) =>
		m.files.map((f) => `${MODEL_BASE_PATH}${m.repositoryPath}${f.path}`),
	);
}

export function listAllowedRuntimePaths(): string[] {
	return RUNTIME_ARTIFACT.files.map((f) => `${ONNX_WASM_BASE_PATH}${f.path}`);
}
