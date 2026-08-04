import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';

export type SettingsValidator<T> = (value: unknown, defaults: T) => T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * validate 省略時の既定検証。既知キーのみ、型（配列判定含む）が一致する値だけを採用する。
 * 数値範囲や列挙値までは検証しないため、範囲・列挙検証が必要な呼び出し元は validate を明示的に渡すこと。
 */
function defaultValidator<T extends Record<string, unknown>>(
	value: unknown,
	defaults: T,
): T {
	if (!isPlainObject(value)) {
		return { ...defaults };
	}
	const result = { ...defaults };
	for (const key of Object.keys(defaults) as Array<keyof T>) {
		const raw = value[key as string];
		if (raw === undefined) continue;
		const defaultValue = defaults[key];
		if (Array.isArray(defaultValue)) {
			if (Array.isArray(raw)) {
				result[key] = raw as T[keyof T];
			}
			continue;
		}
		if (typeof raw === typeof defaultValue) {
			result[key] = raw as T[keyof T];
		}
	}
	return result;
}

// atob/btoa は Latin1 前提のため、TextEncoder/TextDecoder で UTF-8 とバイト列を変換する
// （非推奨の escape/unescape は使用しない）。
function decodeBase64Utf8(value: string): string {
	const binary = atob(value);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function encodeUtf8Base64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

/**
 * ツール固有の設定値を localStorage および URL クエリパラメータと同期するためのカスタムフック。
 * 入力テキストなどの機密データではなく、設定値（数値やトグル状態）のみを対象とする。
 *
 * @param slug ツールの識別子 (例: 'json-formatter')
 * @param defaultSettings 初期設定オブジェクト
 * @param validate 復元値の検証関数。省略時は既知キー・型一致のみを許容する既定検証を使う。
 *   範囲・列挙値の検証が必要な場合は呼び出し元でスキーマ検証関数を渡すこと。
 */
// biome-ignore lint/suspicious/noExplicitAny: settings can contain any basic value types
export function useToolSettings<T extends Record<string, any>>(
	slug: string,
	defaultSettings: T,
	validate: SettingsValidator<T> = defaultValidator,
) {
	const [settings, setSettings] = useState<T>(() => {
		if (typeof window === 'undefined') {
			return defaultSettings;
		}

		// 1. URL クエリパラメータから復元を試みる
		const params = new URLSearchParams(window.location.search);
		const settingsParam = params.get('settings');
		if (settingsParam) {
			try {
				const decoded = decodeBase64Utf8(settingsParam);
				const parsed = JSON.parse(decoded);
				track('settings_restore', { tool: slug, source: 'url' });
				// 検証済みの値のみを採用し、不正値はデフォルトへフォールバックする
				return validate(parsed, defaultSettings);
			} catch (e) {
				console.error('Failed to restore settings from URL:', e);
			}
		}

		// 2. localStorage から復元を試みる
		try {
			const stored = localStorage.getItem(`tool_settings_${slug}`);
			if (stored) {
				const parsed = JSON.parse(stored);
				track('settings_restore', { tool: slug, source: 'localStorage' });
				return validate(parsed, defaultSettings);
			}
		} catch (e) {
			console.error('Failed to restore settings from localStorage:', e);
		}

		return defaultSettings;
	});

	// 設定変更時に localStorage に同期する
	useEffect(() => {
		try {
			localStorage.setItem(`tool_settings_${slug}`, JSON.stringify(settings));
		} catch (e) {
			console.error('Failed to save settings to localStorage:', e);
		}
	}, [slug, settings]);

	// 設定更新用のヘルパー (部分更新対応)
	const updateSettings = (updates: Partial<T> | ((prev: T) => T)) => {
		setSettings((prev) => {
			const next =
				typeof updates === 'function' ? updates(prev) : { ...prev, ...updates };
			return next;
		});
	};

	// 共有用URLを生成する
	const generateShareUrl = () => {
		const encoded = encodeUtf8Base64(JSON.stringify(settings));
		const url = new URL(window.location.href);
		url.searchParams.set('settings', encoded);
		return url.toString();
	};

	return [settings, updateSettings, generateShareUrl] as const;
}
export default useToolSettings;
