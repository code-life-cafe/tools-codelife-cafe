// @ts-check

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://tools.codelife.cafe',
	integrations: [
		react(),
		sitemap({
			changefreq: 'weekly',
			priority: 0.7,
			lastmod: new Date(),
		}),
	],
	vite: {
		plugins: [tailwindcss()],
		// @jsquash/avif のマルチスレッド版 worker（avif_enc_mt.worker）は code-splitting を
		// 伴うため、既定の iife worker 形式ではビルドできない。既存 worker（bg-remove /
		// regex）はいずれも { type: 'module' } のため、ES 形式へ統一しても整合する。
		worker: {
			format: 'es',
		},
	},
});
