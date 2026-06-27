// EditPreview — renderEditedCanvas を使ったライブプレビュー
// rAFスロットルで連続操作時のパフォーマンスを確保する。

import { useEffect, useRef } from 'react';
import { type EditOps, renderEditedCanvas } from '@/lib/tools/image-edit';

interface EditPreviewProps {
	source: ImageBitmap | null;
	editOps: EditOps;
}

export function EditPreview({ source, editOps }: EditPreviewProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef<number>(0);

	useEffect(() => {
		if (!source) return;

		cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(() => {
			const target = canvasRef.current;
			if (!target) return;

			const rendered = renderEditedCanvas(source, editOps);
			target.width = rendered.width;
			target.height = rendered.height;
			const ctx = target.getContext('2d');
			if (ctx) {
				ctx.drawImage(rendered, 0, 0);
			}
		});

		return () => cancelAnimationFrame(rafRef.current);
	}, [source, editOps]);

	if (!source) return null;

	return (
		<div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-2">
			<canvas
				ref={canvasRef}
				className="max-h-[200px] max-w-full object-contain"
				aria-label="編集プレビュー"
			/>
		</div>
	);
}
