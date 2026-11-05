/**
 * このrepoの _headers（相対パス・単一splat）をテスト内で評価する。
 * Cloudflare Pages: 一致する全ルールを順に適用し、各ルール内は解除→追加。
 * https://developers.cloudflare.com/pages/configuration/headers/
 * https://github.com/cloudflare/workers-sdk/blob/main/packages/pages-shared/asset-server/handler.ts
 * 本番配信の代替ではなく、unitとastro previewへのヘッダー注入で使用する。
 */
export function pagesHeadersForPath(source: string, pathname: string): Headers {
	const headers = new Headers();
	let rule: { path: string; unset: string[]; set: Headers } | undefined;
	const apply = () => {
		if (!rule) return;
		const parts = rule.path.split('*');
		const matches =
			parts.length === 1
				? pathname === rule.path
				: pathname.startsWith(parts[0]) && pathname.endsWith(parts[1]);
		if (!matches) return;
		for (const name of rule.unset) headers.delete(name);
		for (const [name, value] of rule.set) headers.append(name, value);
	};
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		if (raw.length > 2000)
			throw new Error('_headersの行が2000文字を超えています');
		if (line.startsWith('/')) {
			apply();
			if (line.includes(':') || line.split('*').length > 2) {
				throw new Error(`テスト未対応のパス: ${line}`);
			}
			rule = { path: line, unset: [], set: new Headers() };
		} else if (!rule) {
			throw new Error('ヘッダーの前にパスが必要です');
		} else if (line.startsWith('! ')) {
			rule.unset.push(line.slice(2));
		} else {
			const separator = line.indexOf(':');
			if (separator < 1) throw new Error(`不正なヘッダー: ${line}`);
			rule.set.append(
				line.slice(0, separator),
				line.slice(separator + 1).trim(),
			);
		}
	}
	apply();
	return headers;
}
