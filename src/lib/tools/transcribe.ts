import {
	normalizeSegments,
	type TranscriptSegment,
} from '../transcribe/segments.ts';

/** 小音量の発話を落とさないよう、しきい値を使わず全サンプルが0かだけを調べる。 */
export function isSilentAudio(audio: Float32Array): boolean {
	return audio.length > 0 && audio.every((sample) => sample === 0);
}

export type WhisperOutput = {
	text: string;
	chunks?: { timestamp: [number, number | null]; text: string }[];
};

/** 推論結果の異常な時刻を除去する。未確定の終了時刻は次の発話か音声末尾で補う。 */
export function finalizeTranscript(
	output: WhisperOutput,
	durationSec: number,
): TranscriptSegment[] {
	const chunks = output.chunks ?? [];
	const segments = normalizeSegments(
		chunks.map((chunk, index) => ({
			id: index + 1,
			start: chunk.timestamp[0] ?? 0,
			end: chunk.timestamp[1] ?? chunks[index + 1]?.timestamp[0] ?? durationSec,
			text: chunk.text.trim(),
		})),
	);
	// 時刻情報自体が無いときだけ全文を使う。不正セグメントを除去した後は復活させない。
	if (chunks.length === 0 && durationSec > 0 && output.text.trim().length > 0) {
		segments.push({
			id: 1,
			start: 0,
			end: durationSec,
			text: output.text.trim(),
		});
	}
	return segments;
}
