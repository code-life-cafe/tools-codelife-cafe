export type FieldType =
	| 'name'
	| 'kana'
	| 'email'
	| 'phone'
	| 'zipcode'
	| 'address'
	| 'company'
	| 'department'
	| 'date'
	| 'number';

export interface FieldConfig {
	id: FieldType;
	label: string;
	selected: boolean;
}

export type ExportFormat = 'json' | 'csv' | 'tsv';

// --- Dictionaries ---
const SURNAMES = [
	{ kanji: '佐藤', kana: 'サトウ', romaji: 'sato' },
	{ kanji: '鈴木', kana: 'スズキ', romaji: 'suzuki' },
	{ kanji: '高橋', kana: 'タカハシ', romaji: 'takahashi' },
	{ kanji: '田中', kana: 'タナカ', romaji: 'tanaka' },
	{ kanji: '伊藤', kana: 'イトウ', romaji: 'ito' },
	{ kanji: '渡辺', kana: 'ワタナベ', romaji: 'watanabe' },
	{ kanji: '山本', kana: 'ヤマモト', romaji: 'yamamoto' },
	{ kanji: '中村', kana: 'ナカムラ', romaji: 'nakamura' },
	{ kanji: '小林', kana: 'コバヤシ', romaji: 'kobayashi' },
	{ kanji: '加藤', kana: 'カトウ', romaji: 'kato' },
	{ kanji: '吉田', kana: 'ヨシダ', romaji: 'yoshida' },
	{ kanji: '山田', kana: 'ヤマダ', romaji: 'yamada' },
	{ kanji: '佐々木', kana: 'ササキ', romaji: 'sasaki' },
	{ kanji: '山口', kana: 'ヤマグチ', romaji: 'yamaguchi' },
	{ kanji: '松本', kana: 'マツモト', romaji: 'matsumoto' },
];

const GIVEN_NAMES = [
	{ kanji: '大翔', kana: 'ヒロト', romaji: 'hiroto' },
	{ kanji: '蓮', kana: 'レン', romaji: 'ren' },
	{ kanji: '悠真', kana: 'ユウマ', romaji: 'yuma' },
	{ kanji: '結那', kana: 'ユイナ', romaji: 'yuina' },
	{ kanji: '陽葵', kana: 'ヒマリ', romaji: 'himari' },
	{ kanji: '紬', kana: 'ツムギ', romaji: 'tsumugi' },
	{ kanji: '凛', kana: 'リン', romaji: 'rin' },
	{ kanji: '太郎', kana: 'タロウ', romaji: 'taro' },
	{ kanji: '一郎', kana: 'イチロウ', romaji: 'ichiro' },
	{ kanji: '花子', kana: 'ハナコ', romaji: 'hanako' },
	{ kanji: 'さくら', kana: 'サクラ', romaji: 'sakura' },
	{ kanji: '健太', kana: 'ケンタ', romaji: 'kenta' },
	{ kanji: '美咲', kana: 'ミサキ', romaji: 'misaki' },
	{ kanji: '拓海', kana: 'タクミ', romaji: 'takumi' },
	{ kanji: '結衣', kana: 'ユイ', romaji: 'yui' },
];

const ADDRESSES = [
	{
		pref: '東京都',
		cities: ['新宿区', '渋谷区', '港区', '世田谷区', '千代田区', '品川区'],
	},
	{
		pref: '大阪府',
		cities: ['大阪市北区', '大阪市中央区', '堺市', '吹田市', '豊中市'],
	},
	{ pref: '神奈川県', cities: ['横浜市中区', '川崎市', '相模原市', '藤沢市'] },
	{
		pref: '愛知県',
		cities: ['名古屋市中区', '名古屋市中村区', '豊田市', '岡崎市'],
	},
	{ pref: '北海道', cities: ['札幌市中央区', '旭川市', '函館市', '苫小牧市'] },
	{
		pref: '福岡県',
		cities: ['福岡市博多区', '福岡市中央区', '北九州市', '久留米市'],
	},
];

const COMPANY_PREFIXES = [
	'情報',
	'建設',
	'商事',
	'テクノロジー',
	'クリエイティブ',
	'ロジスティクス',
	'食品',
	'グローバル',
	'システム',
];
const COMPANY_SUFFIXES = ['株式会社', '有限会社', '合同会社'];

const DEPARTMENTS = [
	'営業部',
	'開発部',
	'人事部',
	'総務部',
	'企画部',
	'マーケティング部',
	'経理部',
	'情報システム部',
];

const DOMAINS = [
	'example.com',
	'example.co.jp',
	'example.net',
	'test.co.jp',
	'dummy.jp',
];

// --- Helpers ---
const randomElement = <T>(arr: T[]): T =>
	arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number) =>
	Math.floor(Math.random() * (max - min + 1)) + min;

export function validateDummyDataInput(
	count: number,
	fields: FieldType[],
): string | null {
	if (fields.length === 0) {
		return '出力するフィールドを1つ以上選択してください。';
	}
	if (!Number.isInteger(count) || count < 1) {
		return '生成件数は 1〜1000 件の範囲で指定してください。';
	}
	if (count > 1000) {
		return '生成件数は 1〜1000 件の範囲で指定してください。';
	}
	return null;
}

// --- Generator ---
export function generateDummyData(
	fields: FieldType[],
	count: number,
	format: ExportFormat,
): string {
	const validationError = validateDummyDataInput(count, fields);
	if (validationError) {
		throw new Error(validationError);
	}

	const rows = [];

	for (let i = 0; i < count; i++) {
		const row: Record<string, string | number> = {};

		// Shared state per row for consistent name-kana-email
		const surname = randomElement(SURNAMES);
		const givenName = randomElement(GIVEN_NAMES);

		for (const field of fields) {
			switch (field) {
				case 'name':
					row[field] = `${surname.kanji} ${givenName.kanji}`;
					break;
				case 'kana':
					row[field] = `${surname.kana} ${givenName.kana}`;
					break;
				case 'email':
					row[field] =
						`${givenName.romaji}.${surname.romaji}@${randomElement(DOMAINS)}`;
					break;
				case 'phone':
					row[field] =
						`0${randomElement([9, 8, 7])}0-${String(randomInt(1000, 9999)).padStart(4, '0')}-${String(randomInt(1000, 9999)).padStart(4, '0')}`;
					break;
				case 'zipcode':
					row[field] =
						`${String(randomInt(100, 999)).padStart(3, '0')}-${String(randomInt(1000, 9999)).padStart(4, '0')}`;
					break;
				case 'address': {
					const addr = randomElement(ADDRESSES);
					row[field] =
						`${addr.pref}${randomElement(addr.cities)}${randomInt(1, 10)}丁目${randomInt(1, 20)}-${randomInt(1, 50)}`;
					break;
				}
				case 'company':
					row[field] =
						Math.random() > 0.5
							? `${surname.kanji}${randomElement(COMPANY_PREFIXES)}${randomElement(COMPANY_SUFFIXES)}`
							: `${randomElement(COMPANY_SUFFIXES)}${surname.kanji}${randomElement(COMPANY_PREFIXES)}`;
					break;
				case 'department':
					row[field] = randomElement(DEPARTMENTS);
					break;
				case 'date': {
					const d = new Date();
					d.setDate(d.getDate() - randomInt(0, 365 * 5));
					row[field] = d.toISOString().split('T')[0];
					break;
				}
				case 'number':
					row[field] = randomInt(1, 100000);
					break;
			}
		}
		rows.push(row);
	}

	// --- Formatting ---
	if (format === 'json') {
		return JSON.stringify(rows, null, 2);
	}

	const separator = format === 'csv' ? ',' : '\t';
	const header = fields.join(separator);

	const body = rows
		.map((r) =>
			fields
				.map((f) => {
					const val = String(r[f] ?? '');
					if (
						format === 'csv' &&
						(val.includes(',') || val.includes('"') || val.includes('\n'))
					) {
						return `"${val.replace(/"/g, '""')}"`;
					}
					return val;
				})
				.join(separator),
		)
		.join('\n');

	return `${header}\n${body}`;
}

// Convert format string back to array of objects for table preview
export function parsePreviewData(
	dataString: string,
	format: ExportFormat,
): Record<string, unknown>[] {
	if (!dataString) return [];
	if (format === 'json') {
		try {
			return JSON.parse(dataString);
		} catch {
			return [];
		}
	}

	const separator = format === 'csv' ? ',' : '\t';
	// Extremely basic CSV/TSV parser for preview only (assumes no newlines in quotes)
	const lines = dataString.split('\n');
	if (lines.length < 2) return [];

	const headers = lines[0].split(separator);
	return lines.slice(1).map((line) => {
		// Handling basic quotes for CSV preview
		const values =
			format === 'csv'
				? line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',')
				: line.split('\t');
		const obj: Record<string, unknown> = {};
		headers.forEach((h, i) => {
			let val = values[i] || '';
			if (val.startsWith('"') && val.endsWith('"')) {
				val = val.slice(1, -1).replace(/""/g, '"');
			}
			obj[h.trim()] = val;
		});
		return obj;
	});
}
