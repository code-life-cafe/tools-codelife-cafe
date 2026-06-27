export interface CropOptions {
	x: number;
	y: number;
	width: number;
	height: number;
	rotate: 0 | 90 | 180 | 270;
	flipHorizontal: boolean;
	flipVertical: boolean;
}

export interface ImageSize {
	width: number;
	height: number;
}

export const DEFAULT_CROP_OPTIONS: CropOptions = {
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	rotate: 0,
	flipHorizontal: false,
	flipVertical: false,
};

export function createInitialCropOptions(size: ImageSize): CropOptions {
	return {
		...DEFAULT_CROP_OPTIONS,
		width: size.width,
		height: size.height,
	};
}

export function clampCropOptions(
	options: CropOptions,
	size: ImageSize,
): CropOptions {
	const width = Math.max(1, Math.min(Math.round(options.width), size.width));
	const height = Math.max(1, Math.min(Math.round(options.height), size.height));
	const x = Math.max(0, Math.min(Math.round(options.x), size.width - width));
	const y = Math.max(0, Math.min(Math.round(options.y), size.height - height));

	return {
		...options,
		x,
		y,
		width,
		height,
	};
}

export function getRotatedSize(
	crop: Pick<CropOptions, 'width' | 'height' | 'rotate'>,
): ImageSize {
	return crop.rotate === 90 || crop.rotate === 270
		? { width: crop.height, height: crop.width }
		: { width: crop.width, height: crop.height };
}

export function renderCroppedImage(
	image: HTMLImageElement,
	options: CropOptions,
): HTMLCanvasElement {
	const crop = clampCropOptions(options, {
		width: image.naturalWidth,
		height: image.naturalHeight,
	});
	const output = getRotatedSize(crop);
	const canvas = document.createElement('canvas');
	canvas.width = output.width;
	canvas.height = output.height;

	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas を初期化できませんでした');
	}

	ctx.save();
	ctx.translate(output.width / 2, output.height / 2);
	ctx.rotate((crop.rotate * Math.PI) / 180);
	ctx.scale(crop.flipHorizontal ? -1 : 1, crop.flipVertical ? -1 : 1);
	ctx.drawImage(
		image,
		crop.x,
		crop.y,
		crop.width,
		crop.height,
		-crop.width / 2,
		-crop.height / 2,
		crop.width,
		crop.height,
	);
	ctx.restore();

	return canvas;
}
