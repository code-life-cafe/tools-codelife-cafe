'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { createContext, useContext, useMemo } from 'react';

import { cn } from '@/lib/utils';

/**
 * タブとパネルの対応づけ（Issue #747）。
 *
 * Radix の TabsTrigger は `aria-controls` に TabsContent の id を入れるが、
 * TabsContent を置かずに切替だけに使うと、存在しない id を指してしまう。
 * `panelIdBase` を渡した Tabs では、タブの id と `aria-controls` をここで決め、
 * 切り替わる領域に `tabsPanelProps` / `tabsSharedPanelProps` を付けて対応させる。
 */
type TabsPanelLink = { idBase: string; sharedPanel: boolean };

const TabsPanelLinkContext = createContext<TabsPanelLink | null>(null);

/** `panelIdBase` を渡した Tabs のタブの id */
function tabsTriggerId(idBase: string, value: string): string {
	return `${idBase}-tab-${value}`;
}

function tabsPanelId(link: TabsPanelLink, value: string): string {
	return link.sharedPanel
		? `${link.idBase}-panel`
		: `${link.idBase}-panel-${value}`;
}

/**
 * タブごとに別の領域を切り替える場合（`sharedPanel` なし）の、値 `value` のパネルに付ける属性。
 * 非選択のパネルも DOM に残す（表示だけ隠す）こと。
 */
function tabsPanelProps(panelIdBase: string, value: string) {
	return {
		role: 'tabpanel',
		id: tabsPanelId({ idBase: panelIdBase, sharedPanel: false }, value),
		'aria-labelledby': tabsTriggerId(panelIdBase, value),
	} as const;
}

/**
 * 同じ領域の内容をタブで切り替える場合（`sharedPanel`）の、その領域に付ける属性。
 * 領域は常に描画し、選択中のタブ `activeValue` で名前を付ける。
 */
function tabsSharedPanelProps(panelIdBase: string, activeValue: string) {
	return {
		role: 'tabpanel',
		id: tabsPanelId({ idBase: panelIdBase, sharedPanel: true }, activeValue),
		'aria-labelledby': tabsTriggerId(panelIdBase, activeValue),
	} as const;
}

type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root> & {
	/** 指定すると、タブの id と `aria-controls` をこの値から決める（`useId()` の値を渡す） */
	panelIdBase?: string;
	/** すべてのタブが同じ領域を切り替える（`tabsSharedPanelProps` を使う） */
	sharedPanel?: boolean;
};

function Tabs({
	className,
	orientation = 'horizontal',
	panelIdBase,
	sharedPanel = false,
	...props
}: TabsProps) {
	const link = useMemo<TabsPanelLink | null>(
		() => (panelIdBase ? { idBase: panelIdBase, sharedPanel } : null),
		[panelIdBase, sharedPanel],
	);
	return (
		// 入れ子の Tabs が外側の対応づけを引き継がないよう、指定がなくても null を渡す
		<TabsPanelLinkContext.Provider value={link}>
			<TabsPrimitive.Root
				data-slot="tabs"
				data-orientation={orientation}
				orientation={orientation}
				className={cn(
					'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col',
					className,
				)}
				{...props}
			/>
		</TabsPanelLinkContext.Provider>
	);
}

const tabsListVariants = cva(
	'rounded-lg p-[3px] group-data-[orientation=horizontal]/tabs:h-9 data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
	{
		variants: {
			variant: {
				default: 'bg-muted',
				line: 'gap-1 bg-transparent',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
);

function TabsList({
	className,
	variant = 'default',
	...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
	VariantProps<typeof tabsListVariants>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn(tabsListVariants({ variant }), className)}
			{...props}
		/>
	);
}

function TabsTrigger({
	className,
	value,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
	const link = useContext(TabsPanelLinkContext);
	const linkProps = link
		? {
				id: tabsTriggerId(link.idBase, value),
				'aria-controls': tabsPanelId(link, value),
			}
		: undefined;
	return (
		<TabsPrimitive.Trigger
			value={value}
			{...linkProps}
			data-slot="tabs-trigger"
			className={cn(
				"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-muted-foreground hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent',
				'data-[state=active]:bg-background dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 data-[state=active]:text-foreground',
				'after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100',
				className,
			)}
			{...props}
		/>
	);
}

function TabsContent({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content
			data-slot="tabs-content"
			className={cn('flex-1 outline-none', className)}
			{...props}
		/>
	);
}

export {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	tabsListVariants,
	tabsPanelProps,
	tabsSharedPanelProps,
};
