// ConvertResultList — ファイルごとの結果行（サムネ / 元形式→出力形式 / サイズ / DL / 警告）

import {
	AlertTriangle,
	Download,
	ImageIcon,
	Loader2,
	MoveRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SourceFormat, TargetFormat } from '@/lib/tools/image-convert';

export type ConvertItem = {
	id: string;
	file: File;
	previewUrl: string;
	sourceFormat: SourceFormat;
	status: 'pending' | 'done' | 'error';
	result?: {
		fileName: string;
		blob: Blob;
		warnings: string[];
	};
	resultUrl?: string;
	error?: string;
};

const SOURCE_LABELS: Record<SourceFormat, string> = {
	png: 'PNG',
	jpeg: 'JPEG',
	webp: 'WebP',
	avif: 'AVIF',
	heic: 'HEIC',
};

const TARGET_LABELS: Record<TargetFormat, string> = {
	jpeg: 'JPEG',
	png: 'PNG',
	webp: 'WebP',
	avif: 'AVIF',
};

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface ConvertResultListProps {
	items: ConvertItem[];
	target: TargetFormat;
	onDownload: (item: ConvertItem) => void;
}

export function ConvertResultList({
	items,
	target,
	onDownload,
}: ConvertResultListProps) {
	if (items.length === 0) return null;

	return (
		<div className="space-y-2" data-testid="convert-result-list">
			{items.map((item) => {
				// 変換完了後は出力後のファイル名（拡張子置換済み）を表示する
				const displayName =
					item.status === 'done' && item.result
						? item.result.fileName
						: item.file.name;
				return (
					<div
						key={item.id}
						className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
					>
						{/* サムネイル（HEIC等は表示できないためフォールバック） */}
						<div className="flex w-fit shrink-0 items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
							<div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#0001_0_25%,transparent_0_50%)] bg-[length:10px_10px]">
								{item.status === 'done' && item.resultUrl ? (
									<img
										src={item.resultUrl}
										alt={`${item.file.name}の変換後プレビュー`}
										className="h-14 w-14 object-cover"
									/>
								) : item.status === 'error' ? (
									<AlertTriangle className="h-4 w-4 text-destructive" />
								) : (
									<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
								)}
							</div>
						</div>

						{/* 情報 */}
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium" title={displayName}>
								{displayName}
							</p>

							<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								<Badge variant="outline">
									{SOURCE_LABELS[item.sourceFormat]}
								</Badge>
								<MoveRight className="h-3.5 w-3.5" />
								<Badge className="bg-primary/15 text-primary border-primary/30">
									{TARGET_LABELS[target]}
								</Badge>
								{item.status === 'done' && item.result && (
									<>
										<span>{formatBytes(item.file.size)}</span>
										<span>→</span>
										<span className="font-medium text-foreground">
											{formatBytes(item.result.blob.size)}
										</span>
									</>
								)}
							</div>

							{item.status === 'pending' && (
								<p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									変換中…
								</p>
							)}

							{item.status === 'error' && (
								<p className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
									<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
									{item.error ?? '変換に失敗しました。'}
								</p>
							)}

							{item.status === 'done' &&
								item.result &&
								item.result.warnings.map((w) => (
									<p
										key={w}
										className="mt-1 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500"
									>
										<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
										{w}
									</p>
								))}
						</div>

						{/* アクション */}
						{item.status === 'done' && item.result && (
							<div className="flex shrink-0 flex-col gap-1.5">
								<Button
									size="sm"
									variant="outline"
									onClick={() => onDownload(item)}
									aria-label="ダウンロード"
								>
									<Download className="h-4 w-4" />
									<span className="ml-1 hidden sm:inline">ダウンロード</span>
								</Button>
							</div>
						)}

						{item.status === 'pending' && (
							<ImageIcon className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
						)}
					</div>
				);
			})}
		</div>
	);
}
