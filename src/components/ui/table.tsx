import type * as React from 'react';

import { cn } from '@/lib/utils';

function Table({
	className,
	scrollRegionLabel,
	...props
}: React.ComponentProps<'table'> & {
	/**
	 * 横スクロールしうる表に付ける名前。指定すると枠がTabで止まる名前付きの領域になり、
	 * キーボードの矢印キーで横スクロールできる（axe scrollable-region-focusable、#747）。
	 */
	scrollRegionLabel?: string;
}) {
	return (
		<div
			data-slot="table-container"
			className={cn(
				'relative w-full overflow-x-auto',
				scrollRegionLabel &&
					'rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring',
			)}
			{...(scrollRegionLabel
				? { role: 'region', 'aria-label': scrollRegionLabel, tabIndex: 0 }
				: {})}
		>
			<table
				data-slot="table"
				className={cn('w-full caption-bottom text-sm', className)}
				{...props}
			/>
		</div>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
	return (
		<thead
			data-slot="table-header"
			className={cn('[&_tr]:border-b', className)}
			{...props}
		/>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
	return (
		<tbody
			data-slot="table-body"
			className={cn('[&_tr:last-child]:border-0', className)}
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
	return (
		<tfoot
			data-slot="table-footer"
			className={cn(
				'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
				className,
			)}
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
	return (
		<tr
			data-slot="table-row"
			className={cn(
				'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
				className,
			)}
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
	return (
		<th
			data-slot="table-head"
			className={cn(
				'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
				className,
			)}
			{...props}
		/>
	);
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
	return (
		<td
			data-slot="table-cell"
			className={cn(
				'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
				className,
			)}
			{...props}
		/>
	);
}

function TableCaption({
	className,
	...props
}: React.ComponentProps<'caption'>) {
	return (
		<caption
			data-slot="table-caption"
			className={cn('mt-4 text-sm text-muted-foreground', className)}
			{...props}
		/>
	);
}

export {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
};
