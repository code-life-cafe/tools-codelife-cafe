// 固定マニフェストだけを取得・検証。期待hashをネットワークから更新しない。
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MODEL_ASSETS } from '../src/lib/model-assets/manifest.ts';

const root = resolve('public');
const check = process.argv.includes('--check');
for (const model of MODEL_ASSETS)
	for (const file of model.files) {
		const destination = join(root, file.url.slice(1));
		let bytes;
		try {
			bytes = await readFile(destination);
		} catch {}
		const valid = (value) =>
			value &&
			value.length === file.bytes &&
			createHash('sha256').update(value).digest('hex') === file.sha256;
		if (!valid(bytes)) {
			if (check || model.name === 'realesr-general-x4v3')
				throw new Error(
					`モデル資産の検証に失敗しました: ${model.name}/${file.path}`,
				);
			const response = await fetch(
				`https://huggingface.co/${model.sourceRepository}/resolve/${model.revision}/${file.path}`,
			);
			if (!response.ok)
				throw new Error(`固定モデルを取得できません: ${model.name}`);
			bytes = Buffer.from(await response.arrayBuffer());
			if (!valid(bytes))
				throw new Error(
					`固定モデルのサイズまたはハッシュが不一致です: ${model.name}`,
				);
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, bytes);
		}
		console.log(`Verified ${model.name}/${file.path}`);
	}
