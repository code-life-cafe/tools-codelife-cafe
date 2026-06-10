// ImageMosaicPage — 画像モザイク・ぼかしツールのオーケストレータ
// 状態: 読み込みフェーズ / マスク領域（undo/redo履歴付き） / 選択 / モード / 強度

import { ImagePlus, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ExportBar } from '@/components/common/ExportBar';
import { ImageDropzone } from '@/components/common/ImageDropzone';
import { useHistoryState } from '@/components/common/useHistoryState';
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
	BLUR_RADIUS,
	type MaskMode,
	type MaskRegion,
	MOSAIC_BLOCK,
	type Rect,
	renderMasked,
} from '@/lib/tools/image-mosaic';
import { CanvasEditor } from './CanvasEditor';
import { MaskToolbar } from './MaskToolbar';

type Phase =
	| { kind: 'empty' }
	| { kind: 'confirmDownscale'; image: HTMLImageElement; fileName: string }
	| {
			kind: 'editing';
			source: HTMLImageElement | HTMLCanvasElement;
			fileName: string;
	  };

export default function ImageMosaicPage() {
	const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [mode, setMode] = useState<MaskMode>('mosaic');
	const [strengths, setStrengths] = useState<Record<MaskMode, number>>({
		mosaic: MOSAIC_BLOCK.default,
		blur: BLUR_RADIUS.default,
	});
	const regions = useHistoryState<MaskRegion[]>([]);

	const startEditing = useCallback(
		(source: HTMLImageElement | HTMLCanvasElement, fileName: string) => {
			setPhase({ kind: 'editing', source, fileName });
			setSelectedId(null);
			regions.reset([]);
		},
		[regions],
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

	const selectedRegion =
		selectedId !== null
			? (regions.state.find((r) => r.id === selectedId) ?? null)
			: null;

	// ツールバーに表示するモード/強度（領域選択中はその領域の値）
	const activeMode = selectedRegion?.mode ?? mode;
	const activeStrength = selectedRegion?.strength ?? strengths[activeMode];

	const handleAddRegion = useCallback(
		(rect: Rect) => {
			const region: MaskRegion = {
				id: createId(),
				rect,
				mode,
				strength: strengths[mode],
			};
			regions.set([...regions.state, region]);
		},
		[mode, strengths, regions],
	);

	const handleDeleteRegion = useCallback(
		(id: string) => {
			regions.set(regions.state.filter((r) => r.id !== id));
			setSelectedId((current) => (current === id ? null : current));
		},
		[regions],
	);

	const handleModeChange = useCallback(
		(next: MaskMode) => {
			if (selectedRegion) {
				const range = next === 'mosaic' ? MOSAIC_BLOCK : BLUR_RADIUS;
				const strength = Math.min(
					range.max,
					Math.max(range.min, selectedRegion.strength),
				);
				regions.set(
					regions.state.map((r) =>
						r.id === selectedRegion.id ? { ...r, mode: next, strength } : r,
					),
				);
			}
			setMode(next);
		},
		[selectedRegion, regions],
	);

	const handleStrengthChange = useCallback(
		(value: number, commit: boolean) => {
			if (selectedRegion) {
				const next = regions.state.map((r) =>
					r.id === selectedRegion.id ? { ...r, strength: value } : r,
				);
				if (commit) {
					regions.set(next);
				} else {
					regions.setTransient(next);
				}
			} else {
				setStrengths((s) => ({ ...s, [activeMode]: value }));
			}
		},
		[selectedRegion, regions, activeMode],
	);

	const handleReset = useCallback(() => {
		regions.reset([]);
		setSelectedId(null);
	}, [regions]);

	const handleClear = useCallback(() => {
		setPhase({ kind: 'empty' });
		setError(null);
		regions.reset([]);
		setSelectedId(null);
	}, [regions]);

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
					<MaskToolbar
						mode={activeMode}
						strength={activeStrength}
						onModeChange={handleModeChange}
						onStrengthChange={handleStrengthChange}
						canUndo={regions.canUndo}
						canRedo={regions.canRedo}
						onUndo={regions.undo}
						onRedo={regions.redo}
						onReset={handleReset}
						editingRegion={selectedRegion !== null}
					/>
					<p className="text-xs text-muted-foreground">
						キャンバス上をドラッグして、モザイク・ぼかしをかける範囲を選択してください。領域をクリックすると選択でき、Deleteキーまたは✕ボタンで削除できます。
					</p>
					<div className="text-center">
						<CanvasEditor
							source={phase.source}
							regions={regions.state}
							selectedId={selectedId}
							onAddRegion={handleAddRegion}
							onSelectRegion={setSelectedId}
							onDeleteRegion={handleDeleteRegion}
						/>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Button variant="outline" size="sm" onClick={handleClear}>
							<ImagePlus className="h-4 w-4" />
							別の画像を選ぶ
						</Button>
					</div>
					<ExportBar
						getCanvas={() => renderMasked(phase.source, regions.state)}
						baseName={phase.fileName}
					/>
				</>
			)}
		</div>
	);
}
