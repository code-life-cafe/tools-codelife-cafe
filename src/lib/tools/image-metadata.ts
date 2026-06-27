export const SUPPORTED_METADATA_IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const;

export const MAX_METADATA_FILE_COUNT = 20;

export type MetadataImageType = (typeof SUPPORTED_METADATA_IMAGE_TYPES)[number];

export interface StripMetadataOptions {
	format: 'original' | 'jpeg' | 'png' | 'webp';
	quality: number;
	background: string;
}

export interface StripMetadataResult {
	blob: Blob;
	fileName: string;
	mimeType: MetadataImageType;
	originalSize: number;
	resultSize: number;
	removedBytes: number;
	reductionRate: number;
	width: number;
	height: number;
}

export function validateMetadataImageFile(file: File): string | null {
	if (
		!SUPPORTED_METADATA_IMAGE_TYPES.includes(file.type as MetadataImageType)
	) {
		return 'JPEG・PNG・WebP 形式の画像を選択してください。';
	}
	if (file.size <= 0) {
		return '空のファイルは処理できません。';
	}
	return null;
}

export function validateMetadataFileCount(
	current: number,
	added: number,
): string | null {
	if (current + added > MAX_METADATA_FILE_COUNT) {
		return `一度に処理できる画像は最大${MAX_METADATA_FILE_COUNT}枚です。`;
	}
	return null;
}

export async function stripImageMetadata(
	file: File,
	options: StripMetadataOptions,
): Promise<StripMetadataResult> {
	const validationError = validateMetadataImageFile(file);
	if (validationError) {
		throw new Error(validationError);
	}

	const bitmap = await createImageBitmap(file);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('画像処理の初期化に失敗しました。');
		}

		const outputType = resolveOutputType(file.type, options.format);
		if (outputType === 'image/jpeg') {
			context.fillStyle = options.background;
			context.fillRect(0, 0, canvas.width, canvas.height);
		}
		context.drawImage(bitmap, 0, 0);

		const blob = await canvasToBlob(canvas, outputType, options.quality);
		const removedBytes = Math.max(0, file.size - blob.size);
		return {
			blob,
			fileName: buildOutputFileName(file.name, outputType),
			mimeType: outputType,
			originalSize: file.size,
			resultSize: blob.size,
			removedBytes,
			reductionRate: file.size > 0 ? removedBytes / file.size : 0,
			width: bitmap.width,
			height: bitmap.height,
		};
	} finally {
		bitmap.close();
	}
}

function resolveOutputType(
	inputType: string,
	format: StripMetadataOptions['format'],
): MetadataImageType {
	if (format === 'original') {
		return SUPPORTED_METADATA_IMAGE_TYPES.includes(
			inputType as MetadataImageType,
		)
			? (inputType as MetadataImageType)
			: 'image/jpeg';
	}
	return `image/${format}` as MetadataImageType;
}

function buildOutputFileName(
	name: string,
	mimeType: MetadataImageType,
): string {
	const base = name.replace(/\.[^.]+$/, '') || 'image';
	const extension =
		mimeType === 'image/jpeg' ? 'jpg' : mimeType.replace('image/', '');
	return `${base}-metadata-removed.${extension}`;
}

function canvasToBlob(
	canvas: HTMLCanvasElement,
	type: MetadataImageType,
	quality: number,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error('画像の書き出しに失敗しました。'));
			},
			type,
			type === 'image/png' ? undefined : quality,
		);
	});
}
