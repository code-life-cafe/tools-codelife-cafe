// ImageTextPage — 画像テキスト挿入ツールのオーケストレータ
// 状態: 読み込みフェーズ / テキストレイヤー / 選択レイヤー

import { ImagePlus, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ExportBar } from '@/components/common/ExportBar';
import { ImageDropzone } from '@/components/common/ImageDropzone';
import { Button } from '@/components/ui/button';
import {
	createId,
	DOWNSCALE_EDGE,
	downscaleImage,
	loadImageFile,
	needsDownscale,
	validateImageFile,
} from '@/lib/tools/image-common';
import {
	createTextLayer,
	renderTextLayers,
	type TextLayer,
} from '@/lib/tools/image-text';
import { LayerPanel } from './LayerPanel';
import { TextCanvas } from './TextCanvas';
import { TextControls } from './TextControls';

type Phase =
	| { kind: 'empty' }
	| { kind: 'confirmDownscale'; image: HTMLImageElement; fileName: string }
	| {
			kind: 'editing';
			source: HTMLImageElement | HTMLCanvasElement;
			fileName: string;
	  };

function sourceSize(source: HTMLImageElement | HTMLCanvasElement) {
	return source instanceof HTMLImageElement
		? { width: source.naturalWidth, height: source.naturalHeight }
		: { width: source.width, height: source.height };
}

export default function ImageTextPage() {
	const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
	const [error, setError] = useState<string | null>(null);
	const [layers, setLayers] = useState<TextLayer[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const startEditing = useCallback(
		(source: HTMLImageElement | HTMLCanvasElement, fileName: string) => {
			setPhase({ kind: 'editing', source, fileName });
			setLayers([]);
			setSelectedId(null);
		},
		[],
	);

	const handleFile = useCallback(
		async (file: File) => {
			setError(null);
			const validation = validateImageFile(file);
			if (!validation.ok) {
				setError(validation.message);
				return;
			}
			try {
				const image = await loadImageFile(file);
				if (needsDownscale(image)) {
					setPhase({ kind: 'confirmDownscale', image, fileName: file.name });
					return;
				}
				startEditing(image, file.name);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : '画像の読み込みに失敗しました',
				);
			}
		},
		[startEditing],
	);

	const handleAdd = useCallback(() => {
		if (phase.kind !== 'editing') return;
		const { width, height } = sourceSize(phase.source);
		const layer = createTextLayer(
			Math.round(width / 2 - 64),
			Math.round(height / 2 - 24),
		);
		setLayers((prev) => [...prev, layer]);
		setSelectedId(layer.id);
	}, [phase]);

	const handleDuplicate = useCallback((id: string) => {
		setLayers((prev) => {
			const target = prev.find((l) => l.id === id);
			if (!target) return prev;
			const copy: TextLayer = {
				...target,
				id: createId(),
				x: target.x + 16,
				y: target.y + 16,
			};
			setSelectedId(copy.id);
			return [...prev, copy];
		});
	}, []);

	const handleDelete = useCallback((id: string) => {
		setLayers((prev) => prev.filter((l) => l.id !== id));
		setSelectedId((current) => (current === id ? null : current));
	}, []);

	const handleMoveOrder = useCallback(
		(id: string, direction: 'up' | 'down') => {
			setLayers((prev) => {
				const index = prev.findIndex((l) => l.id === id);
				const target = direction === 'up' ? index - 1 : index + 1;
				if (index < 0 || target < 0 || target >= prev.length) return prev;
				const next = [...prev];
				[next[index], next[target]] = [next[target], next[index]];
				return next;
			});
		},
		[],
	);

	const handlePatch = useCallback((id: string, patch: Partial<TextLayer>) => {
		setLayers((prev) =>
			prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
		);
	}, []);

	const handleMovePosition = useCallback(
		(id: string, x: number, y: number) => {
			handlePatch(id, { x, y });
		},
		[handlePatch],
	);

	const handleClear = useCallback(() => {
		setPhase({ kind: 'empty' });
		setError(null);
		setLayers([]);
		setSelectedId(null);
	}, []);

	const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;

	return (
		<div className="space-y-4">
			{error && (
				<div
					className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					role="alert"
				>
					<X className="h-4 w-4 shrink-0" />
					<span>{error}</span>
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto"
						onClick={() => setError(null)}
					>
						閉じる
					</Button>
				</div>
			)}

			{phase.kind === 'empty' && <ImageDropzone onFileAccepted={handleFile} />}

			{phase.kind === 'confirmDownscale' && (
				<div className="space-y-4 rounded-xl border border-border p-6">
					<p className="text-sm">
						画像サイズが大きいため（{phase.image.naturalWidth}×
						{phase.image.naturalHeight}px）、快適に編集できるよう長辺を
						{DOWNSCALE_EDGE}pxに縮小して読み込みます。
					</p>
					<div className="flex gap-3">
						<Button
							onClick={() =>
								startEditing(downscaleImage(phase.image), phase.fileName)
							}
						>
							縮小して読み込む
						</Button>
						<Button variant="outline" onClick={handleClear}>
							キャンセル
						</Button>
					</div>
				</div>
			)}

			{phase.kind === 'editing' && (
				<>
					<p className="text-xs text-muted-foreground">
						「テキストを追加」でテキストを配置し、キャンバス上のドラッグで位置を調整できます。
					</p>
					<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
						<div className="text-center">
							<TextCanvas
								source={phase.source}
								layers={layers}
								selectedId={selectedId}
								onSelect={setSelectedId}
								onMoveLayer={handleMovePosition}
							/>
						</div>
						<div className="space-y-4">
							<LayerPanel
								layers={layers}
								selectedId={selectedId}
								onSelect={setSelectedId}
								onAdd={handleAdd}
								onDuplicate={handleDuplicate}
								onDelete={handleDelete}
								onMove={handleMoveOrder}
							/>
							{selectedLayer && (
								<TextControls
									layer={selectedLayer}
									onChange={(patch) => handlePatch(selectedLayer.id, patch)}
								/>
							)}
						</div>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Button variant="outline" size="sm" onClick={handleClear}>
							<ImagePlus className="h-4 w-4" />
							別の画像を選ぶ
						</Button>
					</div>
					<ExportBar
						getCanvas={() => renderTextLayers(phase.source, layers)}
						baseName={phase.fileName}
					/>
				</>
			)}
		</div>
	);
}
