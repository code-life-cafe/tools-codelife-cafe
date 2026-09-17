import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

export const TOOL_CATEGORIES = [
	'テキスト変換',
	'テキスト解析',
	'開発ツール',
	'生成ツール',
	'ユーティリティ',
	'エンコード/デコード',
	'データ処理',
	'AI',
	'画像',
	'PDF',
] as const;

const toolsCollection = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/tools' }),
	schema: z.object({
		title: z.string(),
		/** H1・パンくず表示用の簡潔な名称。未指定時は title を使用（title要素・JSON-LDのSoftwareApplication名はSEO用にtitleを維持） */
		displayTitle: z.string().optional(),
		description: z.string(),
		canonical: z.string().optional(),
		category: z.enum(TOOL_CATEGORIES),
		summary: z.string(),
		useCases: z.array(z.string()),
		howto: z.array(z.string()),
		faq: z.array(
			z.object({
				q: z.string(),
				a: z.string(),
			}),
		),
		related: z.array(z.string()).default([]),
		updated: z.coerce.date(),
		keywords: z.array(z.string()).optional(),
	}),
});

export const collections = {
	tools: toolsCollection,
};
