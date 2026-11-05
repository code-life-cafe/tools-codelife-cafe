// segments.ts — 文字起こしセグメントの正規化・逐次マージ・プレーンテキスト化（純粋ロジック）
//
// UI・Worker・字幕シリアライザ（srt.ts / vtt.ts）が共有する。DOM 非依存。
// 正本: https://app.notion.com/p/396dfd36033681cba834ecd64d6167b3 「詳細設計書 7. / 8.」

export type TranscriptSegment = {
	id: number;
	/** 秒（小数） */
	start: number;
	/** 秒（小数） */
	end: number;
	/** ユーザー編集後の最新値 */
	text: string;
};

/** 本文を正規化する。CRLF を LF に揃え、各行を trim して空行を落とす。 */
export function normalizeText(text: string): string {
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join('\n');
}

/**
 * セグメント列を表示・書き出し用に整える。
 * - 非有限な時刻のセグメントを除去する
 * - 負の開始時刻を 0 にクランプし、終了が開始以下のセグメントは除去する
 * - 本文を正規化し、空になったセグメントを除去する
 * - 開始時刻（同値なら終了時刻）の昇順に並べ替える
 * - (start, end, text) が完全に一致する重複を除去する
 *
 * 入力配列は破壊しない。
 */
export function normalizeSegments(
	segments: readonly TranscriptSegment[],
): TranscriptSegment[] {
	const cleaned: TranscriptSegment[] = [];
	for (const segment of segments) {
		if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
			continue;
		}
		const text = normalizeText(segment.text ?? '');
		if (text.length === 0) continue;
		const start = Math.max(0, segment.start);
		if (segment.end <= start) continue;
		cleaned.push({
			id: segment.id,
			start,
			end: segment.end,
			text,
		});
	}

	cleaned.sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);

	const seen = new Set<string>();
	return cleaned.filter((segment) => {
		const key = `${segment.start}|${segment.end}|${segment.text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * 逐次到着するセグメントを id と時間範囲で upsert する。
 * 単純 append すると Whisper のチャンク境界で重複・順序逆転が起きるため、
 * 「同じ id」または「同じ時間範囲」の既存要素があれば置き換える。
 *
 * 入力配列は破壊しない。
 */
export function upsertSegment(
	list: readonly TranscriptSegment[],
	incoming: TranscriptSegment,
): TranscriptSegment[] {
	const next = [...list];
	const index = next.findIndex(
		(s) =>
			s.id === incoming.id ||
			(s.start === incoming.start && s.end === incoming.end),
	);
	if (index >= 0) {
		next[index] = incoming;
	} else {
		next.push(incoming);
	}
	next.sort((a, b) => a.start - b.start || a.end - b.end);
	return next;
}

function pad(value: number, length: number): string {
	return String(value).padStart(length, '0');
}

/**
 * 秒を `HH:MM:SS` + 区切り + `mmm` に整形する。
 * 負値・非有限値は 0 として扱う。ミリ秒は四捨五入し、繰り上がりを秒・分・時へ伝播させる。
 */
export function formatTimestamp(seconds: number, msSeparator: string): string {
	const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	const totalMs = Math.round(safe * 1000);
	const ms = totalMs % 1000;
	const totalSec = (totalMs - ms) / 1000;
	const s = totalSec % 60;
	const totalMin = (totalSec - s) / 60;
	const m = totalMin % 60;
	const h = (totalMin - m) / 60;
	return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${msSeparator}${pad(ms, 3)}`;
}

export type PlainTextOptions = {
	/** 各行の先頭に `[開始 --> 終了]` を付ける */
	withTimestamps?: boolean;
};

/** セグメントをプレーンテキスト（TXT 書き出し・全文コピー用）に変換する。 */
export function toPlainText(
	segments: readonly TranscriptSegment[],
	options: PlainTextOptions = {},
): string {
	const normalized = normalizeSegments(segments);
	if (normalized.length === 0) return '';
	const lines = normalized.map((segment) => {
		if (!options.withTimestamps) return segment.text;
		const start = formatTimestamp(segment.start, '.');
		const end = formatTimestamp(segment.end, '.');
		return `[${start} --> ${end}] ${segment.text}`;
	});
	return `${lines.join('\n')}\n`;
}
