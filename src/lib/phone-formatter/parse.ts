/**
 * 電話番号パーサー & バリデーター
 */
import { parsePhoneNumber as awpParse } from 'awesome-phonenumber';
import { classifyNumber } from './classify.ts';
import { preprocessInput } from './preprocess.ts';
import { getRegionName } from './regions.ts';
import type { ParseResult } from './types.ts';

/**
 * 電話番号文字列をパースしてフォーマット変換・種別判定・地域名取得を行う
 *
 * @param input - ユーザーの入力文字列（全角可）
 * @param defaultCountry - デフォルト国コード（デフォルト: 'JP'）
 * @returns ParseResult
 *
 * @example
 * parsePhoneNumber('03-1234-5678') // valid result with e164: '+81312345678'
 * parsePhoneNumber('０９０−１２３４−５６７８') // fullwidth → parsed correctly
 * parsePhoneNumber('abc') // { valid: false, error: '...' }
 */
export function parsePhoneNumber(
	input: string,
	defaultCountry: string = 'JP',
): ParseResult {
	// 空入力チェック
	if (!input || input.trim() === '') {
		return {
			valid: false,
			input,
			cleaned: '',
			formats: null,
			numberType: 'unknown',
			regionName: null,
			countryCode: defaultCountry,
			error: undefined,
		};
	}

	let cleaned: string;
	try {
		cleaned = preprocessInput(input);
	} catch {
		cleaned = input;
	}

	try {
		const parsed = awpParse(cleaned, { regionCode: defaultCountry });

		// パースできたが無効な番号の場合
		if (!parsed.valid) {
			return {
				valid: false,
				input,
				cleaned,
				formats: null,
				numberType: 'unknown',
				regionName: null,
				countryCode: defaultCountry,
				error: '有効な電話番号ではありません。正しい形式で入力してください。',
			};
		}

		const numberType = classifyNumber(parsed);

		// 国内表記の数字のみ版（地域名検索用）
		const nationalDigits = (parsed.number?.national ?? '').replace(/\D/g, '');
		const regionName =
			numberType === 'fixed' ? getRegionName(nationalDigits) : null;

		return {
			valid: true,
			input,
			cleaned,
			formats: {
				e164: parsed.number?.e164 ?? '',
				international: parsed.number?.international ?? '',
				national: parsed.number?.national ?? '',
				rfc3966: parsed.number?.rfc3966 ?? '',
			},
			numberType,
			regionName,
			countryCode: parsed.regionCode ?? defaultCountry,
		};
	} catch (_err) {
		return {
			valid: false,
			input,
			cleaned,
			formats: null,
			numberType: 'unknown',
			regionName: null,
			countryCode: defaultCountry,
			error: '電話番号のパース中にエラーが発生しました。',
		};
	}
}
