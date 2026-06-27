export interface ToolMeta {
	title: string;
	path: string;
	summary: string;
	category?: string;
	hasHowTo?: boolean;
	hasFaq?: boolean;
	faqItems?: Array<{
		question: string;
		answer: string;
	}>;
}

export function generateJsonLd(meta: ToolMeta): Record<string, unknown> {
	const baseUrl = 'https://tools.codelife.cafe';
	const url = `${baseUrl}${meta.path}`;

	const graph: Record<string, unknown>[] = [
		{
			'@type': 'SoftwareApplication',
			'@id': `${url}#software`,
			name: meta.title,
			url,
			applicationCategory: meta.category ?? 'DeveloperApplication',
			operatingSystem: 'Web',
			offers: { '@type': 'Offer', price: '0', priceCurrency: 'JPY' },
			description: meta.summary,
			isAccessibleForFree: true,
		},
	];

	if (meta.hasHowTo) {
		graph.push({
			'@type': 'HowTo',
			'@id': `${url}#howto`,
			name: `${meta.title}の使い方`,
			description: meta.summary,
		});
	}

	if (meta.hasFaq && meta.faqItems?.length) {
		graph.push({
			'@type': 'FAQPage',
			'@id': `${url}#faq`,
			mainEntity: meta.faqItems.map((item) => ({
				'@type': 'Question',
				name: item.question,
				acceptedAnswer: {
					'@type': 'Answer',
					text: item.answer,
				},
			})),
		});
	}

	return {
		'@context': 'https://schema.org',
		'@graph': graph,
	};
}
