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
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function decodeJwtPart(segment: string): JwtDecodedPart {
	const text = decodeBase64Url(segment);

	try {
		const json = JSON.parse(text) as unknown;
		return {
			json,
			text,
			formatted: JSON.stringify(json, null, 2),
		};
	} catch {
		return {
			json: null,
			text,
			formatted: text,
		};
	}
}

function readNumericDate(payload: unknown, key: string): number | null {
	if (!payload || typeof payload !== 'object') return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatUnixSeconds(seconds: number): string {
	return new Intl.DateTimeFormat('ja-JP', {
		dateStyle: 'medium',
		timeStyle: 'medium',
	}).format(new Date(seconds * 1000));
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

		if (exp !== null && exp < nowSeconds) {
			warnings.push(`有効期限（exp）を過ぎています: ${formatUnixSeconds(exp)}`);
		}
		if (nbf !== null && nbf > nowSeconds) {
			warnings.push(`有効開始時刻（nbf）が未来です: ${formatUnixSeconds(nbf)}`);
		}

		return {
			valid: true,
			header,
			payload,
			signature: parts[2],
			error: null,
			warnings,
		};
	} catch {
		return {
			valid: false,
			header: null,
			payload: null,
			signature: '',
			error: 'Base64URLのデコードに失敗しました。JWTの形式を確認してください。',
			warnings: [],
		};
	}
}
