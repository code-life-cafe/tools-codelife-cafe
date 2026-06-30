import { getNextCodePointIndex } from '../string-utils.ts';

export interface RegexMatch {
	value: string;
	index: number;
	groups: string[];
}

export interface RegexResult {
	matches: RegexMatch[];
	error?: string;
	replacedText?: string;
}

export const COMMON_PATTERNS = [
	{
		label: 'メールアドレス',
		pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
		flags: 'g',
	},
	{ label: '電話番号', pattern: '0\\d{1,3}-\\d{2,4}-\\d{4}', flags: 'g' },
	{ label: '郵便番号', pattern: '\\d{3}-\\d{4}', flags: 'g' },
	{
		label: 'URL',
		pattern: "https?:\\/\\/[\\w\\-._~:/?#[\\]@!$&'()*+,;=]+",
		flags: 'g',
	},
	{
		label: '日本語のみ',
		pattern: '[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF]+',
		flags: 'g',
	},
];

const TIMEOUT_MS = 500;
const MAX_MATCHES = 5000;

/**
 * 正規表現を評価する同期純粋関数（Web Worker内およびテストで共有）
 */
export function execRegexSync(
	pattern: string,
	flags: string,
	text: string,
	replacement?: string,
): RegexResult {
	if (!pattern) return { matches: [] };

	try {
		const regex = new RegExp(pattern, flags);
		const matches: RegexMatch[] = [];

		if (regex.global) {
			let match: RegExpExecArray | null = regex.exec(text);
			while (match !== null) {
				matches.push({
					value: match[0],
					index: match.index,
					groups: match.slice(1),
				});

				if (matches.length >= MAX_MATCHES) {
					break;
				}

				if (match.index === regex.lastIndex) {
					regex.lastIndex = getNextCodePointIndex(text, regex.lastIndex);
				}

				match = regex.exec(text);
			}
		} else {
			const match = regex.exec(text);
			if (match) {
				matches.push({
					value: match[0],
					index: match.index,
					groups: match.slice(1),
				});
			}
		}

		let replacedText: string | undefined;
		if (replacement !== undefined) {
			replacedText = text.replace(regex, replacement);
		}

		return { matches, replacedText };
	} catch (err: unknown) {
		return {
			matches: [],
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function testRegex(
	pattern: string,
	flags: string,
	text: string,
	replacement?: string,
): Promise<RegexResult> {
	if (!pattern) return { matches: [] };

	return new Promise((resolve) => {
		const worker = new Worker(new URL('./regex-worker.ts', import.meta.url), {
			type: 'module',
		});

		const timeoutId = setTimeout(() => {
			worker.terminate();
			resolve({ matches: [], error: 'タイムアウト：正規表現が複雑すぎます' });
		}, TIMEOUT_MS);

		worker.onmessage = (event: MessageEvent<RegexResult>) => {
			clearTimeout(timeoutId);
			worker.terminate();
			resolve(event.data);
		};

		worker.onerror = (event: ErrorEvent) => {
			clearTimeout(timeoutId);
			worker.terminate();
			resolve({ matches: [], error: event.message });
		};

		worker.postMessage({ pattern, flags, text, replacement });
	});
}
