import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const toolsCollection = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/tools' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		canonical: z.string().optional(),
		category: z.string(),
		summary: z.string(),
		useCases: z.array(z.string()),
		howto: z.array(z.string()),
		faq: z.array(
			z.object({
				q: z.string(),
				a: z.string(),
			})
		),
		related: z.array(z.string()).default([]),
		updated: z.coerce.date(),
		keywords: z.array(z.string()).optional(),
	}),
});

export const collections = {
	tools: toolsCollection,
};
