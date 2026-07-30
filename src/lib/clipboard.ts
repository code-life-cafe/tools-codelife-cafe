/**
 * クリップボードへのコピーを試み、成否を返す。
 * Clipboard API が使えない場合（非セキュアコンテキストなど）や書き込みに失敗した場合は
 * `document.execCommand('copy')` にフォールバックし、その戻り値をそのまま返す。
 */
export async function copyText(text: string): Promise<boolean> {
	const clipboard =
		typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

	if (clipboard?.writeText) {
		try {
			await clipboard.writeText(text);
			return true;
		} catch {
			// フォールバックへ
		}
	}

	return copyTextViaExecCommand(text);
}

function copyTextViaExecCommand(text: string): boolean {
	if (typeof document === 'undefined') return false;

	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.style.position = 'fixed';
	textarea.style.opacity = '0';
	document.body.appendChild(textarea);
	textarea.select();

	let succeeded = false;
	try {
		succeeded = document.execCommand('copy');
	} catch {
		succeeded = false;
	}
	document.body.removeChild(textarea);
	return succeeded;
}
