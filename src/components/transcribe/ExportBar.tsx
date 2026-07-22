// ExportBar — TXT / SRT / VTT のダウンロードと全文コピー
//
// 生成はすべてブラウザ内で完結する（Blob → a[download]）。外部送信は行わない。

import { Check, Clipboard, Download } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TranscriptSegment } from '@/lib/transcribe/protocol';
import { toPlainText } from '@/lib/transcribe/segments';
import { toSrt } from '@/lib/transcribe/srt';
import { toVtt } from '@/lib/transcribe/vtt';

type ExportBarProps = {
	segments: readonly TranscriptSegment[];
	/** 入力ファイル名（拡張子を除いた部分を出力名に使う） */
	baseName: string;
	disabled?: boolean;
};

function download(text: string, filename: string, mime: string): void {
	const blob = new Blob([text], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	// click 直後の revoke はダウンロード失敗の原因になるため遅延させる
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stripExtension(name: string): string {
	const index = name.lastIndexOf('.');
	const base = index > 0 ? name.slice(0, index) : name;
	return base.trim() || 'transcript';
}

export function ExportBar({ segments, baseName, disabled }: ExportBarProps) {
	const [copied, setCopied] = useState(false);
	const base = stripExtension(baseName);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(toPlainText(segments));
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	}, [segments]);

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				disabled={disabled}
				onClick={() =>
					download(
						toPlainText(segments, { withTimestamps: true }),
						`${base}.txt`,
						'text/plain',
					)
				}
			>
				<Download className="h-4 w-4" aria-hidden="true" />
				TXT
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={disabled}
				data-testid="transcribe-download-srt"
				onClick={() => download(toSrt(segments), `${base}.srt`, 'text/plain')}
			>
				<Download className="h-4 w-4" aria-hidden="true" />
				SRT
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={disabled}
				onClick={() => download(toVtt(segments), `${base}.vtt`, 'text/vtt')}
			>
				<Download className="h-4 w-4" aria-hidden="true" />
				VTT
			</Button>
			<Button
				variant="ghost"
				size="sm"
				disabled={disabled}
				onClick={handleCopy}
			>
				{copied ? (
					<Check className="h-4 w-4" aria-hidden="true" />
				) : (
					<Clipboard className="h-4 w-4" aria-hidden="true" />
				)}
				{copied ? 'コピー完了！' : '全文コピー'}
			</Button>
		</div>
	);
}
