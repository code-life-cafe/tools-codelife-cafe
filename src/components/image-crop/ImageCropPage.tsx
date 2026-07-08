import { RotateCcw, RotateCw, Scissors } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportBar } from '@/components/common/ExportBar';
import { ImageDropzone } from '@/components/common/ImageDropzone';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	type CropOptions,
	clampCropOptions,
	createInitialCropOptions,
	renderCroppedImage,
} from '@/lib/tools/image-crop';

type LoadedImage = {
	fileName: string;
	url: string;
	image: HTMLImageElement;
};

export function ImageCropPage() {
	const { trackRun } = useToolAnalytics('image-crop');
	const [loaded, setLoaded] = useState<LoadedImage | null>(null);
	const [crop, setCrop] = useState<CropOptions | null>(null);
	const [error, setError] = useState<string | null>(null);
	const previewRef = useRef<HTMLCanvasElement>(null);

	const imageSize = useMemo(
		() =>
			loaded
				? {
						width: loaded.image.naturalWidth,
						height: loaded.image.naturalHeight,
					}
				: null,
		[loaded],
	);

	const updateCrop = useCallback(
		(patch: Partial<CropOptions>) => {
			if (!crop || !imageSize) return;
			setCrop(clampCropOptions({ ...crop, ...patch }, imageSize));
		},
		[crop, imageSize],
	);

	const handleFile = useCallback((file: File) => {
		setError(null);
		if (!file.type.startsWith('image/')) {
			setError('画像ファイルを選択してください');
			return;
		}
		const url = URL.createObjectURL(file);
		const image = new Image();
		image.onload = () => {
			setLoaded((previous) => {
				if (previous) URL.revokeObjectURL(previous.url);
				return { fileName: file.name, url, image };
			});
			setCrop(
				createInitialCropOptions({
					width: image.naturalWidth,
					height: image.naturalHeight,
				}),
			);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			setError('画像を読み込めませんでした');
		};
		image.src = url;
	}, []);

	const renderPreview = useCallback(() => {
		if (!loaded || !crop) return null;
		const canvas = renderCroppedImage(loaded.image, crop);
		const preview = previewRef.current;
		if (preview) {
			preview.width = canvas.width;
			preview.height = canvas.height;
			preview.getContext('2d')?.drawImage(canvas, 0, 0);
		}
		return canvas;
	}, [loaded, crop]);

	useEffect(() => {
		renderPreview();
	}, [renderPreview]);

	return (
		<div className="space-y-6">
			<ImageDropzone onFileAccepted={handleFile} />
			{error && (
				<p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
					{error}
				</p>
			)}
			{loaded && crop && imageSize && (
				<div className="grid gap-6 lg:grid-cols-[320px_1fr]">
					<section className="space-y-4 rounded-xl border border-border p-4">
						<div>
							<h2 className="font-semibold">切り抜き設定</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								元画像: {imageSize.width}×{imageSize.height}px
							</p>
						</div>
						{(
							[
								['x', '左から'],
								['y', '上から'],
								['width', '幅'],
								['height', '高さ'],
							] as const
						).map(([key, label]) => (
							<div key={key} className="space-y-1.5">
								<Label htmlFor={`crop-${key}`}>{label}</Label>
								<Input
									id={`crop-${key}`}
									type="number"
									min={key === 'x' || key === 'y' ? 0 : 1}
									value={crop[key]}
									onChange={(event) =>
										updateCrop({ [key]: Number(event.target.value) })
									}
								/>
							</div>
						))}
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() =>
									updateCrop({
										rotate: ((crop.rotate + 270) %
											360) as CropOptions['rotate'],
									})
								}
							>
								<RotateCcw className="mr-2 h-4 w-4" /> 左90°
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() =>
									updateCrop({
										rotate: ((crop.rotate + 90) % 360) as CropOptions['rotate'],
									})
								}
							>
								<RotateCw className="mr-2 h-4 w-4" /> 右90°
							</Button>
						</div>
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<Checkbox
									id="flip-horizontal"
									checked={crop.flipHorizontal}
									onCheckedChange={(checked) =>
										updateCrop({ flipHorizontal: checked === true })
									}
								/>
								<Label htmlFor="flip-horizontal">左右反転</Label>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<Checkbox
									id="flip-vertical"
									checked={crop.flipVertical}
									onCheckedChange={(checked) =>
										updateCrop({ flipVertical: checked === true })
									}
								/>
								<Label htmlFor="flip-vertical">上下反転</Label>
							</div>
						</div>
						<Button
							type="button"
							onClick={() => setCrop(createInitialCropOptions(imageSize))}
						>
							<Scissors className="mr-2 h-4 w-4" /> 全体に戻す
						</Button>
					</section>
					<section className="space-y-4">
						<div className="rounded-xl border border-border bg-muted/20 p-4">
							<canvas
								ref={previewRef}
								className="mx-auto max-h-[560px] max-w-full rounded-lg bg-white"
							/>
						</div>
						<ExportBar
							getCanvas={() => {
								const canvas = renderPreview();
								// 切り抜き結果をダウンロードした時のみ計測する
								if (canvas) trackRun();
								return canvas;
							}}
							baseName={loaded.fileName}
						/>
					</section>
				</div>
			)}
		</div>
	);
}
