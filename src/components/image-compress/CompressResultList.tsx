// CompressResultList — ファイルごとの結果行（サムネ / サイズ比較 / 削減率 / DL / before-after比較）

import { AlertTriangle, Download, ImageIcon, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import type { CompressResult } from '@/lib/tools/image-compress';

export type CompressItem = {
	id: string;
	file: File;
	previewUrl: string;
	status: 'pending' | 'done' | 'error';
	result?: CompressResult;
	resultUrl?: string;
	error?: string;
};

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const WARNING_LABELS: Record<NonNullable<CompressResult['warning']>, string> = {
	'target-not-reached':
		'最低品質でも目標サイズに到達できませんでした（最小結果を出力）。',
	'format-fallback':
		'このブラウザは WebP 出力に未対応のため JPEG で出力しました。',
};

interface CompressResultListProps {
	items: CompressItem[];
	onDownload: (item: CompressItem) => void;
	onDownloadOriginal: (item: CompressItem) => void;
}

export function CompressResultList({
	items,
	onDownload,
	onDownloadOriginal,
}: CompressResultListProps) {
	const [preview, setPreview] = useState<CompressItem | null>(null);

	if (items.length === 0) return null;

	return (
		<div className="space-y-2" data-testid="compress-result-list">
			{items.map((item) => {
				const result = item.result;
				const larger =
					result != null && result.compressedSize >= item.file.size;
				const reduction =
					result != null
						? Math.round((1 - result.compressedSize / item.file.size) * 100)
						: 0;

				return (
					<div
						key={item.id}
						className="flex items-center gap-3 rounded-lg border border-border p-3"
					>
						{/* サムネイル */}
						<button
							type="button"
							onClick={() => item.status === 'done' && setPreview(item)}
							className="shrink-0 rounded border border-border overflow-hidden bg-muted/30 disabled:cursor-default"
							disabled={item.status !== 'done'}
							aria-label="拡大して比較"
						>
							<img
								src={item.previewUrl}
								alt={item.file.name}
								className="h-14 w-14 object-cover"
							/>
						</button>

						{/* 情報 */}
						<div className="min-w-0 flex-1">
							<p
								className="truncate text-sm font-medium"
								title={item.file.name}
							>
								{item.file.name}
							</p>

							{item.status === 'pending' && (
								<p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									処理中…
								</p>
							)}

							{item.status === 'error' && (
								<p className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
									<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
									{item.error ?? '処理に失敗しました。'}
								</p>
							)}

							{item.status === 'done' && result && (
								<>
									<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span>{formatBytes(item.file.size)}</span>
										<span>→</span>
										<span className="font-medium text-foreground">
											{formatBytes(result.compressedSize)}
										</span>
										<span className="text-muted-foreground/70">
											({result.width}×{result.height})
										</span>
										{larger ? (
											<Badge variant="outline" className="text-amber-600">
												削減なし
											</Badge>
										) : (
											<Badge className="bg-safety/15 text-safety border-safety/30">
												-{reduction}%
											</Badge>
										)}
									</div>
									{result.warning && (
										<p className="mt-1 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
											<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
											{WARNING_LABELS[result.warning]}
										</p>
									)}
									{larger && (
										<p className="mt-1 text-xs text-muted-foreground">
											圧縮後のほうが大きくなりました。元画像のままがおすすめです。
										</p>
									)}
								</>
							)}
						</div>

						{/* アクション */}
						{item.status === 'done' && result && (
							<div className="flex shrink-0 flex-col gap-1.5">
								<Button
									size="sm"
									variant="outline"
									onClick={() => onDownload(item)}
								>
									<Download className="h-4 w-4" />
									<span className="ml-1 hidden sm:inline">ダウンロード</span>
								</Button>
								{larger && (
									<Button
										size="sm"
										variant="ghost"
										onClick={() => onDownloadOriginal(item)}
									>
										<ImageIcon className="h-4 w-4" />
										<span className="ml-1 hidden sm:inline">元画像</span>
									</Button>
								)}
							</div>
						)}
					</div>
				);
			})}

			{/* before / after 比較モーダル */}
			<Dialog
				open={preview != null}
				onOpenChange={(open) => !open && setPreview(null)}
			>
				<DialogContent className="max-w-3xl">
					<DialogHeader>
						<DialogTitle className="truncate">{preview?.file.name}</DialogTitle>
					</DialogHeader>
					{preview?.result && (
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<figure className="space-y-1">
								<figcaption className="text-xs text-muted-foreground">
									変換前: {formatBytes(preview.file.size)}
								</figcaption>
								<img
									src={preview.previewUrl}
									alt="変換前"
									className="w-full rounded border border-border bg-[repeating-conic-gradient(#0001_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
								/>
							</figure>
							<figure className="space-y-1">
								<figcaption className="text-xs text-muted-foreground">
									変換後: {formatBytes(preview.result.compressedSize)} (
									{preview.result.width}×{preview.result.height})
								</figcaption>
								<img
									src={preview.resultUrl}
									alt="変換後"
									className="w-full rounded border border-border bg-[repeating-conic-gradient(#0001_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
								/>
							</figure>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
