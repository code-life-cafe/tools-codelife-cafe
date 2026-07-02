import type { APIRoute } from 'astro';
import { toolCatalog } from '../lib/tools/catalog.ts';

export const GET: APIRoute = async () => {
	try {
		const base = 'https://tools.codelife.cafe';

		const lines: string[] = [
			'# tools.codelife.cafe — Full Reference',
			'',
			'仕事で安心して使える、日本語業務特化のWebツール集（詳細リファレンス）。全ツールが完全クライアントサイド処理で、入力データを外部送信しない。',
			'',
		];

		const activeTools = toolCatalog.filter((t) => t.published !== false);

		for (const t of activeTools) {
			lines.push(`## ${t.title}`);
			lines.push(`- URL: ${base}${t.href}`);
			if (t.llmsFull) {
				lines.push(`- 用途: ${t.llmsFull.useCase}`);
				lines.push(`- 入力: ${t.llmsFull.inputs}`);
				lines.push(`- 出力: ${t.llmsFull.outputs}`);
				if (t.llmsFull.options) {
					lines.push(`- オプション: ${t.llmsFull.options}`);
				}
			} else {
				lines.push(`- 用途: ${t.description}`);
			}
			lines.push('');
		}

		return new Response(lines.join('\n'), {
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	} catch (e) {
		return new Response(
			`# Error\n\nFailed to generate llms-full.txt: ${
				e instanceof Error ? e.message : 'Unknown error'
			}`,
			{ status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
		);
	}
};
