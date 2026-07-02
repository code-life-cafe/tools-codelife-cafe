import type { APIRoute } from 'astro';
import { toolCatalog } from '../lib/tools/catalog.ts';

export const GET: APIRoute = async () => {
	try {
		const base = 'https://tools.codelife.cafe';

		const lines: string[] = [
			'# tools.codelife.cafe',
			'',
			'仕事で安心して使える、日本語業務特化のWebツール集。全ツールが完全クライアントサイド処理で、入力データを外部送信しない。',
			'',
			'## Tools',
			...toolCatalog
				.filter((t) => t.published !== false)
				.map((t) => `- [${t.title}](${base}${t.href}): ${t.description}`),
		];

		return new Response(lines.join('\n'), {
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	} catch (e) {
		return new Response(
			`# Error\n\nFailed to generate llms.txt: ${
				e instanceof Error ? e.message : 'Unknown error'
			}`,
			{ status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
		);
	}
};
