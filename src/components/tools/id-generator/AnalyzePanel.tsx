import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
	type DetectedKind,
	detectIdKind,
	extractUlidTimestamp,
	extractUuidV1Timestamp,
	extractUuidV7Timestamp,
} from '@/lib/tools/uuid';

interface AnalyzePanelProps {
	onAnalyzed: () => void;
}

const KIND_LABELS: Record<DetectedKind, string> = {
	'uuid-v1': 'UUID v1',
	'uuid-v4': 'UUID v4',
	'uuid-v7': 'UUID v7',
	'uuid-other': 'UUID（その他のバージョン）',
	ulid: 'ULID',
	unknown: '不明',
};

export function AnalyzePanel({ onAnalyzed }: AnalyzePanelProps) {
	const [input, setInput] = useState('');

	const detection = useMemo(() => {
		if (input.trim() === '') return null;
		return detectIdKind(input);
	}, [input]);

	useEffect(() => {
		if (detection && detection.kind !== 'unknown') onAnalyzed();
	}, [detection, onAnalyzed]);

	const timestamp = useMemo(() => {
		if (!detection) return null;
		if (detection.kind === 'uuid-v1') return extractUuidV1Timestamp(input);
		if (detection.kind === 'uuid-v7') return extractUuidV7Timestamp(input);
		if (detection.kind === 'ulid') return extractUlidTimestamp(input);
		return null;
	}, [detection, input]);

	return (
		<div className="space-y-6">
			<div>
				<Label htmlFor="id-analyze-input" className="mb-2 block font-semibold">
					判定するUUID / ULIDを入力
				</Label>
				<Textarea
					id="id-analyze-input"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="例: 018f4f6a-7b5c-7c3e-8b3e-3a1b2c3d4e5f"
					className="min-h-24 font-mono-tool"
				/>
			</div>

			{detection && (
				<div
					className="rounded-lg border border-border p-4 space-y-3"
					data-testid="id-analyze-result"
				>
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground">種類:</span>
						<span className="font-semibold" data-testid="id-analyze-kind">
							{KIND_LABELS[detection.kind]}
						</span>
					</div>

					{detection.kind === 'unknown' && (
						<p className="text-sm text-muted-foreground">
							UUID・ULIDのいずれとも判定できませんでした。nanoid等の他形式の可能性がありますが、入力だけでは断定できません。
						</p>
					)}

					{timestamp && (
						<div
							className="text-sm space-y-1"
							data-testid="id-analyze-timestamp"
						>
							{timestamp.ok ? (
								<>
									<div>
										<span className="text-muted-foreground">UTC: </span>
										<span className="font-mono-tool">{timestamp.iso}</span>
									</div>
									<div>
										<span className="text-muted-foreground">ローカル: </span>
										<span className="font-mono-tool">
											{timestamp.date.toLocaleString('ja-JP')}
										</span>
									</div>
								</>
							) : (
								<p className="text-destructive" role="alert">
									{timestamp.reason}
								</p>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
