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
	phone: new RegExp(
		`(?:${M_PRE}${H}${D}{4}${H}${D}{4}|${Z}${D}{1,4}${H}${D}{1,4}${H}${D}{4}|${Z}${D}{9,10}(?![0-9０-９]))`,
		'g',
	),
	zipcode: new RegExp(`(?<![0-9０-９])${D}{3}${H}${D}{4}(?![0-9０-９])`, 'g'),
	card: new RegExp(
		`(?<![0-9０-９])(?:${D}{4}(?:[ 　]|${H})?){3}${D}{4}(?![0-9０-９])`,
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

/** 従来のメール正規表現と同じ範囲を、@を起点に線形走査する。 */
function replaceEmails(
	text: string,
	replace: (
		match: string,
		local: string,
		domain: string,
		offset: number,
	) => string,
): string {
	const parts: string[] = [];
	let last = 0;
	let cursor = 0;
	while (cursor < text.length) {
		const at = text.indexOf('@', cursor);
		if (at === -1) break;
		cursor = at + 1;
		let start = at;
		while (start > last && /[a-zA-Z0-9_.+-]/.test(text[start - 1])) start--;
		if (start === at) continue;
		let dot = at + 1;
		while (dot < text.length && /[a-zA-Z0-9-]/.test(text[dot])) dot++;
		if (dot === at + 1 || text[dot] !== '.') continue;
		let end = dot + 1;
		while (end < text.length && /[a-zA-Z0-9-.]/.test(text[end])) end++;
		if (end === dot + 1) continue;
		parts.push(
			text.slice(last, start),
			replace(
				text.slice(start, end),
				text.slice(start, at),
				text.slice(at + 1, end),
				start,
			),
		);
		last = end;
		cursor = end;
	}
	return parts.join('') + text.slice(last);
}

interface Candidate {
	start: number;
	end: number;
	type: MaskTarget;
	replacement: string;
}

/**
 * 重なった検出範囲の解決順。長い範囲を優先し、同じ長さなら機微度の高い種別を優先する。
 * 検出は常に原文に対して行い、置換は範囲を確定してから1回だけ行う（検出順序に依存させない）。
 */
const TYPE_PRIORITY: MaskTarget[] = [
	'mynumber',
	'card',
	'email',
	'phone',
	'zipcode',
	'name',
];

function collectRegex(
	text: string,
	pattern: RegExp,
	type: MaskTarget,
	build: (match: string, groups: (string | undefined)[]) => string,
	out: Candidate[],
): void {
	for (const m of text.matchAll(pattern)) {
		const start = m.index ?? 0;
		out.push({
			start,
			end: start + m[0].length,
			type,
			replacement: build(m[0], m.slice(1)),
		});
	}
}

export function maskText(text: string, options: MaskOptions): MaskResult {
	const counts: Record<MaskTarget, number> = {
		email: 0,
		phone: 0,
		zipcode: 0,
		card: 0,
		mynumber: 0,
		name: 0,
	};
	const { maskChar, strength } = options;
	const candidates: Candidate[] = [];

	if (options.targets.has('email')) {
		replaceEmails(text, (match, local, domain, offset) => {
			let replacement: string;
			if (strength === 'full') {
				replacement = maskChar.repeat(match.length);
			} else if (local.length <= 1) {
				// 1文字のローカル部は先頭を残すと何も伏せられないため、その1文字も伏せる。
				replacement = `${maskChar.repeat(local.length)}@${domain}`;
			} else {
				replacement = `${local.charAt(0)}${maskChar.repeat(local.length - 1)}@${domain}`;
			}
			candidates.push({
				start: offset,
				end: offset + match.length,
				type: 'email',
				replacement,
			});
			return match;
		});
	}

	if (options.targets.has('card')) {
		collectRegex(
			text,
			PATTERNS.card,
			'card',
			(match) => {
				if (strength === 'full') return maskChar.repeat(match.length);
				// 末尾4桁だけを残し、それ以外の数字を伏せる（区切り文字は保持）。
				const head = match.slice(0, -4).replace(/[0-9０-９]/g, maskChar);
				return head + match.slice(-4);
			},
			candidates,
		);
	}

	if (options.targets.has('phone')) {
		collectRegex(
			text,
			PATTERNS.phone,
			'phone',
			(match) => {
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
			},
			candidates,
		);
	}

	if (options.targets.has('zipcode')) {
		collectRegex(
			text,
			PATTERNS.zipcode,
			'zipcode',
			(match) => {
				if (strength === 'full') return maskChar.repeat(match.length);
				const sep = match.includes('－') ? '－' : '-';
				return `${maskChar.repeat(3)}${sep}${maskChar.repeat(4)}`;
			},
			candidates,
		);
	}

	if (options.targets.has('mynumber')) {
		collectRegex(
			text,
			PATTERNS.mynumber,
			'mynumber',
			(match) => maskChar.repeat(match.length),
			candidates,
		);
	}

	if (options.targets.has('name')) {
		collectRegex(
			text,
			PATTERNS.name,
			'name',
			(match, [labeledName, surname]) => {
				if (labeledName) {
					const pfx = match.slice(0, match.indexOf(labeledName));
					if (strength === 'full')
						return pfx + maskChar.repeat(labeledName.length);
					return (
						pfx +
						labeledName.charAt(0) +
						maskChar.repeat(Math.max(0, labeledName.length - 1))
					);
				}
				if (strength === 'full') return maskChar.repeat(match.length);
				return (
					(surname ?? '').charAt(0) +
					maskChar.repeat(Math.max(0, match.length - 1))
				);
			},
			candidates,
		);
	}

	// 重なりを解決する: 長い範囲 → 機微度の高い種別 → 先に現れた範囲 の順で採用する。
	const ordered = [...candidates].sort(
		(a, b) =>
			b.end - b.start - (a.end - a.start) ||
			TYPE_PRIORITY.indexOf(a.type) - TYPE_PRIORITY.indexOf(b.type) ||
			a.start - b.start,
	);
	const accepted: Candidate[] = [];
	for (const c of ordered) {
		if (accepted.some((a) => c.start < a.end && a.start < c.end)) continue;
		accepted.push(c);
	}
	accepted.sort((a, b) => a.start - b.start);

	for (const c of accepted) counts[c.type]++;

	// 置換はすべて文字数を保つため、位置ごとに「どれか1つの候補でも伏せた位置は伏せる」で合成する。
	// 採用しなかった（重なった）候補が伏せる位置も残すことで、検出対象を増やしても
	// 単独選択時より保護が弱くならない。件数・ハイライトは採用した範囲で数える。
	// ただし、より機微度の高い採用範囲に完全に含まれる候補（例: 電話番号の一部に見える郵便番号）は
	// その範囲の一部と解釈し、合成しない。
	const rank = (t: MaskTarget) => TYPE_PRIORITY.indexOf(t);
	const acceptedSet = new Set(accepted);
	const chars = text.split('');
	for (const c of candidates) {
		if (
			!acceptedSet.has(c) &&
			accepted.some(
				(a) =>
					a.start <= c.start && c.end <= a.end && rank(a.type) < rank(c.type),
			)
		) {
			continue;
		}
		for (let k = 0; k < c.replacement.length; k++) {
			const at = c.start + k;
			const r = c.replacement[k];
			if (r === text[at]) continue;
			// 伏字を最優先し、それ以外の変化（区切り文字の統一など）は未変更の位置にだけ適用する。
			if (r === maskChar || chars[at] === text[at]) chars[at] = r;
		}
	}
	const masked = chars.join('');

	return {
		maskedText: masked,
		counts,
		ranges: accepted.map(({ start, end, type }) => ({ start, end, type })),
	};
}
