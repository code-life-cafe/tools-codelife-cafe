// 固定した現行モデルの配布資産。通常ビルドで期待ハッシュを再生成しない。
// 取得実測: 2026-10-14。同梱fast版は本リポジトリの固定コミットを由来とする。
export type AssetFile = {
	path: string;
	url: string;
	bytes: number;
	sha256: string;
};
export type ModelAsset = {
	name: string;
	tool: 'bg-remove' | 'upscale';
	sourceRepository: string;
	revision: string;
	dtype: string;
	license: string;
	files: readonly AssetFile[];
};
export const MODEL_ASSETS: readonly ModelAsset[] = [
	{
		name: 'modnet',
		sourceRepository: 'onnx-community/modnet-webnn',
		revision: '6af52070d14deafc5e55ce6cc4d752a322cdff76',
		files: [
			{
				path: 'config.json',
				bytes: 191,
				sha256:
					'4ce4cd293c1b83fdcec5da21131b029a6444713eb7041df6d44f4e6a335a01ff',
				url: '/models/bg-remove/modnet/6af52070d14deafc5e55ce6cc4d752a322cdff76/config.json',
			},
			{
				path: 'preprocessor_config.json',
				bytes: 349,
				sha256:
					'2858817d6bb201f333f1c07e4ecbd725f53ae2848543dfde8182d2c16617f0c3',
				url: '/models/bg-remove/modnet/6af52070d14deafc5e55ce6cc4d752a322cdff76/preprocessor_config.json',
			},
			{
				path: 'quantize_config.json',
				bytes: 718,
				sha256:
					'dac6ea29bbe34dfcaddf634b56eaa173020e9324dc8e9e9834ca9167c93cbc89',
				url: '/models/bg-remove/modnet/6af52070d14deafc5e55ce6cc4d752a322cdff76/quantize_config.json',
			},
			{
				path: 'onnx/model.onnx',
				bytes: 25888640,
				sha256:
					'07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9',
				url: '/models/bg-remove/modnet/6af52070d14deafc5e55ce6cc4d752a322cdff76/onnx/model.onnx',
			},
		],
		tool: 'bg-remove',
		dtype: 'fp32',
		license: 'Apache-2.0',
	},
	{
		name: 'birefnet-lite-512',
		sourceRepository: 'studioludens/birefnet-lite-512',
		revision: '962e67969ec6acec9c19fab76acee4f5e22e990c',
		files: [
			{
				path: 'config.json',
				bytes: 81,
				sha256:
					'561965f7aa366c48b95ab1c24220d59a718df4025c2ecb359dd5736ceb49e912',
				url: '/models/bg-remove/birefnet-lite-512/962e67969ec6acec9c19fab76acee4f5e22e990c/config.json',
			},
			{
				path: 'preprocessor_config.json',
				bytes: 389,
				sha256:
					'a79663b311d8404dfb329f7b45bc9f970a0c155aeedae8ac15b6b77d76789613',
				url: '/models/bg-remove/birefnet-lite-512/962e67969ec6acec9c19fab76acee4f5e22e990c/preprocessor_config.json',
			},
			{
				path: 'onnx/model_fp16.onnx',
				bytes: 98484532,
				sha256:
					'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516',
				url: '/models/bg-remove/birefnet-lite-512/962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model_fp16.onnx',
			},
			{
				path: 'LICENSE',
				bytes: 1106,
				sha256:
					'b5cd5faac84a0acb8a6bdb8aeef0919e528891be27216df84eab398d7c8bd2aa',
				url: '/models/bg-remove/birefnet-lite-512/962e67969ec6acec9c19fab76acee4f5e22e990c/LICENSE',
			},
		],
		tool: 'bg-remove',
		dtype: 'fp16',
		license: 'MIT',
	},
	// 旧Workerの固定URL互換用。現行highではロードしない。
	{
		name: 'ben2',
		sourceRepository: 'onnx-community/BEN2-ONNX',
		revision: 'c552aa82688edce09f0ac9d2e31ad53d9d629010',
		files: [
			{
				path: 'config.json',
				bytes: 80,
				sha256:
					'a1955f3bbdd628a0ea0339ec14bc98ba7b09e1a35d267e4ab01e902d2489dfa5',
				url: '/models/bg-remove/ben2/c552aa82688edce09f0ac9d2e31ad53d9d629010/config.json',
			},
			{
				path: 'preprocessor_config.json',
				bytes: 391,
				sha256:
					'447d9ccb2c4129ab0ca045fc293e7d79dbc45e293ac1e94818d865db77f65a54',
				url: '/models/bg-remove/ben2/c552aa82688edce09f0ac9d2e31ad53d9d629010/preprocessor_config.json',
			},
			{
				path: 'onnx/model_fp16.onnx',
				bytes: 219121675,
				sha256:
					'dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1',
				url: '/models/bg-remove/ben2/c552aa82688edce09f0ac9d2e31ad53d9d629010/onnx/model_fp16.onnx',
			},
		],
		tool: 'bg-remove',
		dtype: 'fp16',
		license: 'MIT',
	},
	{
		name: 'realesrgan-x4plus',
		sourceRepository: 'bukuroo/RealESRGAN-ONNX',
		revision: 'a1f365e2ef85ca5d4c66325e76bc7e26374c9642',
		files: [
			{
				path: 'real-esrgan-x4plus-128.onnx',
				bytes: 67160311,
				sha256:
					'6a6f4a3d58553d40fdd443d9e5f4b2deb9b52bef1ec2947700fc2167ac876c7d',
				url: '/models/upscale/realesrgan-x4plus/a1f365e2ef85ca5d4c66325e76bc7e26374c9642/real-esrgan-x4plus-128.onnx',
			},
		],
		tool: 'upscale',
		dtype: 'fp32',
		license: 'BSD-3-Clause',
	},
	{
		name: 'realesr-general-x4v3',
		tool: 'upscale',
		sourceRepository: 'code-life-cafe/tools-codelife-cafe',
		revision: '974a11de21cc53c3eb97a27f03b687b426be5903',
		dtype: 'fp32',
		license: 'BSD-3-Clause',
		files: [
			{
				path: 'realesr-general-x4v3.onnx',
				url: '/models/realesr-general-x4v3.onnx',
				bytes: 4866421,
				sha256:
					'ee28b94a5d06ff32c4920370417e094d1dc7aae4e568e2502afb3371377e41fd',
			},
		],
	},
];
export function modelAsset(name: string): ModelAsset {
	const asset = MODEL_ASSETS.find((item) => item.name === name);
	if (!asset) throw new Error('未登録のモデルです。');
	return asset;
}
export function modelFile(name: string, path: string): AssetFile {
	const file = modelAsset(name).files.find((item) => item.path === path);
	if (!file) throw new Error('未登録のモデル資産です。');
	return file;
}
export const MODEL_FILES = MODEL_ASSETS.flatMap((model) => model.files);
