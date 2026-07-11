import { MoveDiagonal2 } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type TextareaResize = 'none' | 'vertical';

// デスクトップ（md〜）のみ縦方向リサイズを許可する。モバイルは初期高さ＋内部スクロールで操作する。
const resizeClasses: Record<TextareaResize, string> = {
	none: 'resize-none',
	vertical: 'resize-none md:resize-y overflow-auto',
};

function Textarea({
	className,
	resize,
	disabled,
	...props
}: React.ComponentProps<'textarea'> & { resize?: TextareaResize }) {
	const textareaEl = (
		<textarea
			data-slot="textarea"
			data-resize={resize}
			disabled={disabled}
			className={cn(
				'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
				resize && resizeClasses[resize],
				className,
			)}
			{...props}
		/>
	);

	// vertical以外（none／未指定）はグリップ用ラッパーを生成しない
	if (resize !== 'vertical') {
		return textareaEl;
	}

	return (
		<div className="group/textarea relative flex min-h-0 w-full flex-1">
			{textareaEl}
			{!disabled && (
				<span
					aria-hidden="true"
					data-slot="textarea-resize-handle"
					className="pointer-events-none absolute bottom-1 right-1 hidden cursor-ns-resize items-center justify-center text-muted-foreground/50 transition-colors duration-150 motion-reduce:transition-none md:flex md:group-hover/textarea:text-muted-foreground md:group-focus-within/textarea:text-muted-foreground"
				>
					<MoveDiagonal2 className="h-3.5 w-3.5" />
				</span>
			)}
		</div>
	);
}

export { Textarea, type TextareaResize };
