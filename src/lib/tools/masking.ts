export type MaskTarget =
	| 'email'
	| 'phone'
	| 'zipcode'
	| 'card'
	| 'mynumber'
	| 'name';
export type MaskChar = '*' | '●';
export type MaskStrength = 'partial' | 'full';

export interface MaskOptions {
	targets: Set<MaskTarget>;
	maskChar: MaskChar;
	strength: MaskStrength;
}

export interface MaskResult {
	maskedText: string;
	counts: Record<MaskTarget, number>;
	ranges: { start: number; end: number; type: MaskTarget }[];
}

// Common Surnames for simplistic name detection (簡易版)
const SURNAMES =
	'佐藤|鈴木|高橋|田中|伊藤|渡辺|山本|中村|小林|加藤|吉田|山田|佐々木|山口|松本|井上|木村|林|斎藤|清水|山崎|森|池田|橋本|阿部|石川|山下|中島|石井|小川';

const D = '[0-9０-９]';
const H = '[-－]';
const Z = '[0０]';
const M_PRE = '[0０][7７8８9９][0０]';

const PATTERNS = {
	email: /([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g,
	phone: new RegExp(
		`(?:${M_PRE}${H}${D}{4}${H}${D}{4}|${Z}${D}{1,4}${H}${D}{1,4}${H}${D}{4}|${Z}${D}{9,10}(?![0-9０-９]))`,
		'g',
	),
	zipcode: new RegExp(`(?<![0-9０-９])${D}{3}${H}${D}{4}(?![0-9０-９])`, 'g'),
	card: new RegExp(
		`(?<![0-9０-９])(?:${D}{4}[ ${H}]?){3}${D}{4}(?![0-9０-９])`,
		'g',
	),
	mynumber: new RegExp(`(?<![0-9０-９])${D}{12}(?![0-9０-９])`, 'g'),
	// 氏名は「漢字ラン」または「かな/カナラン」のどちらか一方として捉える（スクリプトを跨いだ連続マッチを禁止）。
	// これにより、漢字の名（例: 太郎）の直後に続く助詞（「です」等のひらがな）を
	// 名の一部として誤って取り込むことを防ぎつつ、ひらがな・カタカナの名（さくら、サクラ等）も検出できる。
	// 助詞と名がどちらも同じスクリプト（ひらがな）で連続する場合（例: 2文字のひらがな名+助詞）は
	// 正規表現のみでは完全に判別できないため、検出漏れを防ぐ側に倒している（既知の制約）。
	name: new RegExp(
		`(?<![A-Za-z0-9_])(?:氏名|名前)[:：\\s]*([一-龯]{2,10}|[ぁ-んァ-ン]{2,10})|(?<![A-Za-z0-9_])(${SURNAMES})([一-龯]{1,3}|[ぁ-んァ-ン]{1,3})`,
		'g',
	),
};

export function maskText(text: string, options: MaskOptions): MaskResult {
	let masked = text;
	const counts: Record<MaskTarget, number> = {
		email: 0,
		phone: 0,
		zipcode: 0,
		card: 0,
		mynumber: 0,
		name: 0,
	};
	const ranges: { start: number; end: number; type: MaskTarget }[] = [];

	const { maskChar, strength } = options;

	if (options.targets.has('email')) {
		masked = masked.replace(PATTERNS.email, (match, local, domain, offset) => {
			counts.email++;
			ranges.push({ start: offset, end: offset + match.length, type: 'email' });
			if (strength === 'full') return maskChar.repeat(match.length);
			const mLocal =
				local.charAt(0) + maskChar.repeat(Math.max(0, local.length - 1));
			return `${mLocal}@${domain}`;
		});
	}

	if (options.targets.has('card')) {
		masked = masked.replace(PATTERNS.card, (match, offset) => {
			counts.card++;
			ranges.push({ start: offset, end: offset + match.length, type: 'card' });
			if (strength === 'full') return maskChar.repeat(match.length);
			const digits = match.replace(/[ -－]/g, '');
			const last4 = digits.slice(-4);
			return match.replace(/[0-9０-９]/g, () => maskChar).slice(0, -4) + last4;
		});
	}

	if (options.targets.has('phone')) {
		masked = masked.replace(PATTERNS.phone, (match, offset) => {
			counts.phone++;
			ranges.push({ start: offset, end: offset + match.length, type: 'phone' });
			if (strength === 'full') return maskChar.repeat(match.length);
			const parts = match.split(/[-－]/);
			if (parts.length === 3) {
				const sep = match.includes('－') ? '－' : '-';
				return `${parts[0]}${sep}${maskChar.repeat(parts[1].length)}${sep}${parts[2]}`;
			}
			return (
				match.slice(0, 3) +
				maskChar.repeat(Math.max(0, match.length - 7)) +
				match.slice(-4)
			);
		});
	}

	if (options.targets.has('zipcode')) {
		masked = masked.replace(PATTERNS.zipcode, (match, offset) => {
			counts.zipcode++;
			ranges.push({
				start: offset,
				end: offset + match.length,
				type: 'zipcode',
			});
			if (strength === 'full') return maskChar.repeat(match.length);
			const sep = match.includes('－') ? '－' : '-';
			return `${maskChar.repeat(3)}${sep}${maskChar.repeat(4)}`;
		});
	}

	if (options.targets.has('mynumber')) {
		masked = masked.replace(PATTERNS.mynumber, (match, offset) => {
			counts.mynumber++;
			ranges.push({
				start: offset,
				end: offset + match.length,
				type: 'mynumber',
			});
			return maskChar.repeat(match.length);
		});
	}

	if (options.targets.has('name')) {
		masked = masked.replace(
			PATTERNS.name,
			(match, labeledName, surname, _givenName, offset) => {
				counts.name++;
				ranges.push({
					start: offset,
					end: offset + match.length,
					type: 'name',
				});
				if (labeledName) {
					const pfx = match.slice(0, match.indexOf(labeledName));
					if (strength === 'full')
						return pfx + maskChar.repeat(labeledName.length);
					return (
						pfx +
						labeledName.charAt(0) +
						maskChar.repeat(Math.max(0, labeledName.length - 1))
					);
				} else {
					if (strength === 'full') return maskChar.repeat(match.length);
					return (
						surname.charAt(0) + maskChar.repeat(Math.max(0, match.length - 1))
					);
				}
			},
		);
	}

	return { maskedText: masked, counts, ranges };
}
