// SegmentList — タイムスタンプ付きセグメントの表示・編集
//
// 推論完了前は編集を許可しない（暫定結果は upsert で置き換わるため）。
// 各 textarea にはタイムスタンプを含む識別可能なラベルを付ける（スクリーンリーダー対応）。

import { Textarea } from '@/components/ui/textarea';
import type { TranscriptSegment } from '@/lib/transcribe/protocol';
import { formatTimestamp } from '@/lib/transcribe/segments';

type SegmentListProps = {
	segments: readonly TranscriptSegment[];
	/** 完了前は false。暫定結果は読み取り専用で表示する */
	editable: boolean;
	onChange?: (id: number, text: string) => void;
};

export function SegmentList({
	segments,
	editable,
	onChange,
}: SegmentListProps) {
	if (segments.length === 0) return null;

	return (
		<ul className="flex flex-col gap-2" data-testid="transcribe-segments">
			{segments.map((segment) => {
				const start = formatTimestamp(segment.start, '.');
				const end = formatTimestamp(segment.end, '.');
				const label = `${start} から ${end} のセグメント`;
				return (
					<li
						key={segment.id}
						className="grid gap-2 rounded-lg border border-border/70 p-2 sm:grid-cols-[9rem_1fr] sm:items-start"
					>
						<span className="font-mono text-xs text-muted-foreground sm:pt-2">
							{start} → {end}
						</span>
						{editable ? (
							<Textarea
								aria-label={label}
								value={segment.text}
								rows={Math.min(6, segment.text.split('\n').length + 1)}
								resize="vertical"
								onChange={(event) => onChange?.(segment.id, event.target.value)}
							/>
						) : (
							// 暫定表示。タイムスタンプは同じ li 内に並置されているため
							// 読み上げ順で対応が伝わる（aria-label は p では無効）
							<p className="whitespace-pre-wrap text-sm">{segment.text}</p>
						)}
					</li>
				);
			})}
		</ul>
	);
}
