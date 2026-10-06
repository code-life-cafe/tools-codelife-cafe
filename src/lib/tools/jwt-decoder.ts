export interface JwtDecodedPart {
	json: unknown | null;
	text: string;
	formatted: string;
}

export interface JwtDecodeResult {
	valid: boolean;
	header: JwtDecodedPart | null;
	payload: JwtDecodedPart | null;
	signature: string;
	error: string | null;
	warnings: string[];
}

function decodeBase64Url(segment: string): string {
	const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		'=',
	);

	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
		throw new Error('無効なBase64URL文字が含まれています。');
	}

	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function decodeJwtPart(segment: string): JwtDecodedPart {
	const text = decodeBase64Url(segment);
	const json = JSON.parse(text) as unknown;

	if (typeof json !== 'object' || json === null) {
		throw new Error('JSONオブジェクトではありません。');
	}

	return {
		json,
		text,
		formatted: JSON.stringify(json, null, 2),
	};
}

function readNumericDate(payload: unknown, key: string): number | null {
	if (!payload || typeof payload !== 'object') return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// 秒として解釈すると約5138年以降になる値。ミリ秒・マイクロ秒の取り違えを疑う閾値
const SUSPICIOUS_SECONDS = 1e11;

export function formatUnixSeconds(seconds: number): string | null {
	const date = new Date(seconds * 1000);
	if (!Number.isFinite(date.getTime())) return null;
	return new Intl.DateTimeFormat('ja-JP', {
		dateStyle: 'medium',
		timeStyle: 'medium',
	}).format(date);
}

function buildClaimWarnings(
	key: 'exp' | 'nbf',
	label: string,
	value: number,
	nowSeconds: number,
): string[] {
	const formatted = formatUnixSeconds(value);
	const unitHint =
		'秒ではなくミリ秒・マイクロ秒で指定されていないか確認してください。';
	const warnings: string[] = [];
	// 失効・未来の判定は数値比較のみで行い、日時への変換可否に依存させない
	const shown = formatted ?? `${value}（日時に変換できません）`;
	if (key === 'exp' && value <= nowSeconds) {
		warnings.push(`有効期限（exp）を過ぎています: ${shown}`);
	}
	if (key === 'nbf' && value > nowSeconds) {
		warnings.push(`有効開始時刻（nbf）が未来です: ${shown}`);
	}
	if (formatted === null) {
		warnings.push(
			`${label}（${key}）の値 ${value} は日時に変換できません。${unitHint}`,
		);
		return warnings;
	}
	if (Math.abs(value) >= SUSPICIOUS_SECONDS) {
		warnings.push(
			`${label}（${key}）の値 ${value} は秒として非常に大きい値です。${unitHint}`,
		);
	}
	return warnings;
}

export function decodeJwt(input: string, now = Date.now()): JwtDecodeResult {
	const token = input.trim();
	if (!token) {
		return {
			valid: false,
			header: null,
			payload: null,
			signature: '',
			error: 'JWTを入力してください。',
			warnings: [],
		};
	}

	const parts = token.split('.');
	if (parts.length !== 3 || parts[0].length === 0 || parts[1].length === 0) {
		return {
			valid: false,
			header: null,
			payload: null,
			signature: '',
			error:
				'JWTは「ヘッダー.ペイロード.署名」の3つの部分で構成されている必要があります。',
			warnings: [],
		};
	}

	try {
		const header = decodeJwtPart(parts[0]);
		const payload = decodeJwtPart(parts[1]);
		const warnings: string[] = [];
		const exp = readNumericDate(payload.json, 'exp');
		const nbf = readNumericDate(payload.json, 'nbf');
		const nowSeconds = Math.floor(now / 1000);

		if (exp !== null) {
			warnings.push(...buildClaimWarnings('exp', '有効期限', exp, nowSeconds));
		}
		if (nbf !== null) {
			warnings.push(
				...buildClaimWarnings('nbf', '有効開始時刻', nbf, nowSeconds),
			);
		}

		return {
			valid: true,
			header,
			payload,
			signature: parts[2],
			error: null,
			warnings,
		};
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'JWTのデコードに失敗しました。';
		return {
			valid: false,
			header: null,
			payload: null,
			signature: '',
			error: `デコードエラー: ${message}`,
			warnings: [],
		};
	}
}
