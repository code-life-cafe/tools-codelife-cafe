import { toolCatalog } from '../tools/catalog.ts';
import { normalizeCanonicalPath } from './url.ts';

// カタログの正規URLを唯一の宛先とし、未知のURLを転送しない。
export const legacyToolRoutes = new Map(
	toolCatalog.map((tool) => [tool.id, tool.href]),
);

export function legacyToolDestination(pathname: string): string | undefined {
	const match = /^\/tools\/([^/]+)\/?$/.exec(pathname);
	const canonical = match ? legacyToolRoutes.get(match[1]) : undefined;
	// Pagesのindex.html配信は末尾slash付きで200を返す。追加308を避ける。
	return canonical ? normalizeCanonicalPath(canonical) : undefined;
}
