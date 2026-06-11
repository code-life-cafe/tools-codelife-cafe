// 同一オリジンの静的JSON（/data/zipcode/{nn}.json）から上2桁チャンクを取得する。
// ユーザー入力は送信せず、URLパスに含まれるのは郵便番号の上2桁のみ。

import type { ZipRecord } from '@/lib/tools/zipcode';

export async function fetchZipChunk(prefix: string): Promise<ZipRecord[]> {
	const res = await fetch(`/data/zipcode/${prefix}.json`);
	// 該当チャンクが存在しない（その上2桁に郵便番号がない）場合は空配列
	if (res.status === 404) return [];
	if (!res.ok) {
		throw new Error(`チャンク取得に失敗しました (${res.status})`);
	}
	return (await res.json()) as ZipRecord[];
}
