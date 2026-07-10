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
	...props
}: React.ComponentProps<'textarea'> & { resize?: TextareaResize }) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
				resize && resizeClasses[resize],
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea, type TextareaResize };
