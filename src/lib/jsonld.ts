import type {
	BreadcrumbList,
	SoftwareApplication,
	WithContext,
} from 'schema-dts';

export interface ToolMeta {
	title: string;
	path: string;
	summary: string;
	category?: string;
	howto?: string[];
	faq?: { q: string; a: string }[];
}

const BASE_URL = 'https://tools.codelife.cafe';

/**
 * SoftwareApplication 構造化データを生成します。
 */
export function softwareApplication(
	tool: ToolMeta,
): WithContext<SoftwareApplication> {
	const url = `${BASE_URL}${tool.path}`;
	return {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		'@id': `${url}#app`,
		name: tool.title,
		description: tool.summary,
		url,
		applicationCategory: 'UtilitiesApplication',
		operatingSystem: 'Any',
		inLanguage: 'ja',
		isAccessibleForFree: true,
		offers: {
			'@type': 'Offer',
			price: '0',
			priceCurrency: 'JPY',
			availability: 'https://schema.org/InStock',
			url,
		},
		publisher: {
			'@id': `${BASE_URL}/#org`,
		},
	};
}

/**
 * BreadcrumbList 構造化データを生成します。
 */
export function breadcrumb(
	path: string,
	title: string,
	categoryName?: string,
	categoryHref?: string,
): WithContext<BreadcrumbList> {
	const items = [
		{
			'@type': 'ListItem' as const,
			position: 1,
			name: 'ホーム',
			item: `${BASE_URL}/`,
		},
	];

	if (categoryName && categoryHref) {
		items.push({
			'@type': 'ListItem' as const,
			position: 2,
			name: categoryName,
			item: `${BASE_URL}${categoryHref}`,
		});
		items.push({
			'@type': 'ListItem' as const,
			position: 3,
			name: title,
			item: `${BASE_URL}${path}`,
		});
	} else {
		items.push({
			'@type': 'ListItem' as const,
			position: 2,
			name: title,
			item: `${BASE_URL}${path}`,
		});
	}

	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items,
	};
}

/**
 * ツールページ用の統合 JSON-LD (@graph) を生成します。
 */
export function generateJsonLd(
	tool: ToolMeta,
	categoryHref?: string,
): Record<string, unknown> {
	const url = `${BASE_URL}${tool.path}`;
	const graph: unknown[] = [
		{
			'@type': 'SoftwareApplication',
			'@id': `${url}#app`,
			name: tool.title,
			description: tool.summary,
			url,
			applicationCategory: 'UtilitiesApplication',
			operatingSystem: 'Any',
			inLanguage: 'ja',
			isAccessibleForFree: true,
			offers: {
				'@type': 'Offer',
				price: '0',
				priceCurrency: 'JPY',
				availability: 'https://schema.org/InStock',
				url,
			},
			publisher: {
				'@id': `${BASE_URL}/#org`,
			},
		},
	];

	const items = [
		{
			'@type': 'ListItem',
			position: 1,
			name: 'ホーム',
			item: `${BASE_URL}/`,
		},
	];

	if (tool.category && categoryHref) {
		items.push({
			'@type': 'ListItem',
			position: 2,
			name: tool.category,
			item: `${BASE_URL}${categoryHref}`,
		});
		items.push({
			'@type': 'ListItem',
			position: 3,
			name: tool.title,
			item: `${BASE_URL}${tool.path}`,
		});
	} else {
		items.push({
			'@type': 'ListItem',
			position: 2,
			name: tool.title,
			item: `${BASE_URL}${tool.path}`,
		});
	}

	graph.push({
		'@type': 'BreadcrumbList',
		itemListElement: items,
	});

	if (tool.howto && tool.howto.length > 0) {
		graph.push({
			'@type': 'HowTo',
			'@id': `${url}#howto`,
			name: `${tool.title}の使い方`,
			step: tool.howto.map((stepText, index) => ({
				'@type': 'HowToStep',
				position: index + 1,
				text: stepText,
			})),
		});
	}

	if (tool.faq && tool.faq.length > 0) {
		graph.push({
			'@type': 'FAQPage',
			'@id': `${url}#faq`,
			mainEntity: tool.faq.map((item) => ({
				'@type': 'Question',
				name: item.q,
				acceptedAnswer: {
					'@type': 'Answer',
					text: item.a,
				},
			})),
		});
	}

	return {
		'@context': 'https://schema.org',
		'@graph': graph,
	};
}
