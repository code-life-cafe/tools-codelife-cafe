import type { DetectionResult } from '@/lib/encoding/types';

export interface FileInfo {
	name: string;
	size: number;
	lineEnding: 'CRLF' | 'LF' | 'CR' | 'MIXED' | 'NONE';
	hasBom: boolean;
	lineCount: number;
}

export interface FileLoadedEvent {
	file: File;
	buffer: ArrayBuffer;
	detection: DetectionResult;
}

export function getConversionErrorMessage(e: unknown): string {
	if (
		e instanceof RangeError ||
		e instanceof TypeError ||
		String(e).includes('memory')
	) {
		return 'ファイルが大きすぎます。より小さいファイルでお試しください。';
	}
	return '変換中にエラーが発生しました。エンコーディングを変更して再度お試しください。';
}
