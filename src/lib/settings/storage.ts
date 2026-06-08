import type { EncodingType } from '../encoding/types';
import type { UserSettings } from './types';

const STORAGE_KEY = 'csv-fixer-settings';

const DEFAULT_SETTINGS: UserSettings = {
	outputEncoding: 'UTF8',
	addBom: true,
	lineEnding: 'CRLF',
	instantMode: false,
};

export function saveSettings(settings: UserSettings): void {
	if (typeof window === 'undefined') return;

	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch (e) {
		console.error('Failed to save settings to localStorage', e);
	}
}

export function loadSettings(): UserSettings {
	if (typeof window === 'undefined') return DEFAULT_SETTINGS;

	try {
		const data = localStorage.getItem(STORAGE_KEY);
		if (!data) return DEFAULT_SETTINGS;

		const parsed = JSON.parse(data);

		// Validate
		const validEncodings: EncodingType[] = [
			'UTF8',
			'SJIS',
			'EUCJP',
			'JIS',
			'UTF16',
			'UTF16BE',
			'UTF16LE',
			'ASCII',
			'BINARY',
			'UNICODE',
		];
		const validLineEndings = ['CRLF', 'LF', 'CR'];

		if (parsed && typeof parsed === 'object') {
			return {
				outputEncoding: validEncodings.includes(parsed.outputEncoding)
					? parsed.outputEncoding
					: DEFAULT_SETTINGS.outputEncoding,
				addBom:
					typeof parsed.addBom === 'boolean'
						? parsed.addBom
						: DEFAULT_SETTINGS.addBom,
				lineEnding: validLineEndings.includes(parsed.lineEnding)
					? parsed.lineEnding
					: DEFAULT_SETTINGS.lineEnding,
				instantMode:
					typeof parsed.instantMode === 'boolean'
						? parsed.instantMode
						: DEFAULT_SETTINGS.instantMode,
			};
		}
	} catch (e) {
		console.error('Failed to load settings from localStorage', e);
	}

	return DEFAULT_SETTINGS;
}
