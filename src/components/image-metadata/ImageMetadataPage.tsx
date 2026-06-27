import { CheckCircle2, Download, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { createId, downloadBlob } from '@/lib/tools/image-common';
import {
	MAX_METADATA_FILE_COUNT,
	type StripMetadataOptions,
	type StripMetadataResult,
	stripImageMetadata,
	validateMetadataFileCount,
	validateMetadataImageFile,
} from '@/lib/tools/image-metadata';
import { buildZip, dedupeZipNames } from '@/lib/tools/zip';

const ACCEPT = 'image/jpeg,image/png,image/webp';

type MetadataItem = {
	id: string;
	file: File;
	previewUrl: string;
	status: 'ready' | 'processing' | 'done' | 'error';
	result?: StripMetadataResult;
	resultUrl?: string;
	error?: string;
};

const DEFAULT_OPTIONS: StripMetadataOptions = {
	format: 'original',
	quality: 0.9,
	background: '#ffffff',
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageMetadataPage() {
	const [items, setItems] = useState<MetadataItem[]>([]);
	const [options, setOptions] = useState<StripMetadataOptions>(DEFAULT_OPTIONS);
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const itemsRef = useRef<MetadataItem[]>([]);
	itemsRef.current = items;

	useEffect(() => {
		return () => {
			for (const item of itemsRef.current) {
				URL.revokeObjectURL(item.previewUrl);
				if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
			}
		};
	}, []);

	const onFiles = useCallback((files: File[]) => {
		setError(null);
		const countError = validateMetadataFileCount(
			itemsRef.current.length,
			files.length,
		);
		if (countError) {
			setError(countError);
			return;
		}
		const next: MetadataItem[] = [];
		for (const file of files) {
			const validationError = validateMetadataImageFile(file);
			if (validationError) {
				setError(`${file.name}: ${validationError}`);
				continue;
			}
			next.push({
				id: createId(),
				file,
				previewUrl: URL.createObjectURL(file),
				status: 'ready',
			});
		}
		if (next.length > 0) setItems((prev) => [...prev, ...next]);
	}, []);

	const removeItem = useCallback((id: string) => {
		setItems((prev) => {
			const target = prev.find((item) => item.id === id);
			if (target) {
				URL.revokeObjectURL(target.previewUrl);
				if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
			}
			return prev.filter((item) => item.id !== id);
		});
	}, []);

	const processAll = useCallback(async () => {
		setError(null);
		setProcessing(true);
		for (const item of itemsRef.current) {
			setItems((prev) =>
				prev.map((it) =>
					it.id === item.id ? { ...it, status: 'processing' } : it,
				),
			);
			try {
				const result = await stripImageMetadata(item.file, options);
				const resultUrl = URL.createObjectURL(result.blob);
				setItems((prev) =>
					prev.map((it) =>
						it.id === item.id
							? { ...it, status: 'done', result, resultUrl, error: undefined }
							: it,
					),
				);
			} catch (err) {
				setItems((prev) =>
					prev.map((it) =>
						it.id === item.id
							? {
									...it,
									status: 'error',
									error:
										err instanceof Error ? err.message : '処理に失敗しました。',
								}
							: it,
					),
				);
			}
		}
		setProcessing(false);
	}, [options]);

	const downloadAll = useCallback(async () => {
		const done = items.filter((item) => item.result);
		if (done.length === 0) return;
		if (done.length === 1 && done[0].result) {
			downloadBlob(done[0].result.blob, done[0].result.fileName);
			return;
		}
		const names = dedupeZipNames(
			done.map((item) => item.result?.fileName ?? item.file.name),
		);
		const files = done.flatMap((item, index) =>
			item.result ? [{ name: names[index], data: item.result.blob }] : [],
		);
		const zip = await buildZip(files);
		downloadBlob(zip, 'metadata-removed-images.zip');
	}, [items]);

	const doneCount = items.filter((item) => item.status === 'done').length;

	return (
		<div className="space-y-6">
			<FileDropzone
				accept={ACCEPT}
				multiple
				onFileSelect={(file) => onFiles([file])}
				onFilesSelect={onFiles}
				onValidationError={setError}
				maxSizeBytes={25 * 1024 * 1024}
				validationMessage="25MB以下の画像を選択してください。"
			/>

			<div className="rounded-xl border border-border bg-card p-4">
				<h2 className="font-semibold">出力設定</h2>
				<div className="mt-4 grid gap-4 md:grid-cols-3">
					<div className="space-y-2">
						<Label>出力形式</Label>
						<Select
							value={options.format}
							onValueChange={(value) =>
								setOptions((prev) => ({
									...prev,
									format: value as StripMetadataOptions['format'],
								}))
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="original">元の形式を維持</SelectItem>
								<SelectItem value="jpeg">JPEG</SelectItem>
								<SelectItem value="png">PNG</SelectItem>
								<SelectItem value="webp">WebP</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label>品質: {Math.round(options.quality * 100)}%</Label>
						<Slider
							value={[Math.round(options.quality * 100)]}
							min={40}
							max={100}
							step={5}
							onValueChange={([value]) =>
								setOptions((prev) => ({ ...prev, quality: value / 100 }))
							}
						/>
					</div>
					<div className="space-y-2">
						<Label>JPEG背景色</Label>
						<Input
							type="color"
							value={options.background}
							onChange={(event) =>
								setOptions((prev) => ({
									...prev,
									background: event.target.value,
								}))
							}
						/>
					</div>
				</div>
				<p className="mt-3 text-sm text-muted-foreground">
					Canvasで再エンコードし、Exif・GPS位置情報・カメラ情報など画像メタデータを削除します。処理はすべてブラウザ内で完結します。
				</p>
			</div>

			{error && (
				<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{error}
				</div>
			)}

			<div className="flex flex-wrap gap-3">
				<Button
					onClick={processAll}
					disabled={processing || items.length === 0}
				>
					{processing ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<CheckCircle2 className="mr-2 h-4 w-4" />
					)}
					メタデータを削除
				</Button>
				<Button
					variant="secondary"
					onClick={downloadAll}
					disabled={doneCount === 0}
				>
					<Download className="mr-2 h-4 w-4" />
					結果をダウンロード{doneCount > 1 ? '（ZIP）' : ''}
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				{items.map((item) => (
					<div
						key={item.id}
						className="rounded-xl border border-border bg-card p-4"
					>
						<div className="flex gap-4">
							<img
								src={item.previewUrl}
								alt="選択した画像のプレビュー"
								className="h-24 w-24 rounded-lg object-cover"
							/>
							<div className="min-w-0 flex-1 space-y-1 text-sm">
								<p className="truncate font-medium">{item.file.name}</p>
								<p className="text-muted-foreground">
									元サイズ: {formatBytes(item.file.size)}
								</p>
								{item.status === 'processing' && (
									<p className="text-primary">処理中...</p>
								)}
								{item.status === 'error' && (
									<p className="text-destructive">{item.error}</p>
								)}
								{item.result && (
									<div className="space-y-1">
										<p>
											出力: {formatBytes(item.result.resultSize)}（削減{' '}
											{formatBytes(item.result.removedBytes)}）
										</p>
										<p className="text-muted-foreground">
											{item.result.width}×{item.result.height}px /{' '}
											{item.result.mimeType}
										</p>
										<a
											className="text-primary underline"
											href={item.resultUrl}
											download={item.result.fileName}
										>
											個別ダウンロード
										</a>
									</div>
								)}
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => removeItem(item.id)}
								aria-label="削除"
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					</div>
				))}
			</div>

			<p className="text-xs text-muted-foreground">
				最大{MAX_METADATA_FILE_COUNT}
				枚まで一括処理できます。ファイルはサーバーへ送信されません。
			</p>
		</div>
	);
}
