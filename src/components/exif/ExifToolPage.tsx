// ExifToolPage — EXIF 表示・削除ツールのオーケストレーター
// 画像の EXIF メタデータを表示し、ワンクリックで除去してダウンロード。
// すべてブラウザ内で処理し、画像はサーバーに送信されない。

import {
	AlertTriangle,
	CheckCircle2,
	Download,
	ExternalLink,
	Loader2,
	MapPin,
	Package,
	ShieldAlert,
	Trash2,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useBatchProcessing } from '@/lib/hooks/useBatchProcessing';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	bakeOrientation,
	type ExifData,
	type ExifTag,
	parseExif,
	stripMetadata,
	validateBatch,
	validateImageFile,
} from '@/lib/tools/exif';
import { createId, downloadBlob } from '@/lib/tools/image-common';
import { buildZip, dedupeZipNames } from '@/lib/tools/zip';

const ACCEPT = 'image/jpeg,image/tiff,image/webp';
const MAX_DISPLAY_FILES = 30;

type ExifItem = {
	id: string;
	status: 'pending' | 'done' | 'error';
	error?: string;
	file: File;
	previewUrl: string;
	format: 'jpeg' | 'tiff' | 'webp';
	exif: ExifData;
	strippedBlob?: Blob;
	strippedFileName?: string;
	warnings?: string[];
};

type StrippedResult = {
	blob: Blob;
	fileName: string;
};

function releaseExifItem(item: ExifItem): void {
	URL.revokeObjectURL(item.previewUrl);
}

function groupTags(tags: ExifTag[]): Record<ExifTag['group'], ExifTag[]> {
	const groups: Record<ExifTag['group'], ExifTag[]> = {
		camera: [],
		datetime: [],
		gps: [],
		other: [],
	};
	for (const tag of tags) {
		groups[tag.group].push(tag);
	}
	return groups;
}

const GROUP_LABELS: Record<ExifTag['group'], string> = {
	camera: 'カメラ情報',
	datetime: '日時',
	gps: '位置情報',
	other: 'その他',
};

const GROUP_ORDER: ExifTag['group'][] = ['gps', 'camera', 'datetime', 'other'];

function buildCleanedFileName(original: string): string {
	const dot = original.lastIndexOf('.');
	if (dot < 0) return `${original}_cleaned`;
	return `${original.slice(0, dot)}_cleaned${original.slice(dot)}`;
}

async function downloadResults(results: StrippedResult[]): Promise<void> {
	if (results.length === 1) {
		downloadBlob(results[0].blob, results[0].fileName);
	} else if (results.length >= 2) {
		const names = dedupeZipNames(results.map((r) => r.fileName));
		const zip = await buildZip(
			results.map((r, i) => ({ name: names[i], data: r.blob })),
		);
		downloadBlob(zip, 'cleaned.zip');
	}
}

export function ExifToolPage() {
	const { trackRun } = useToolAnalytics('exif');
	const [bakeOri, setBakeOri] = useState(false);
	// 実行中に生成された結果を直接蓄積する（itemsのstate反映を待たずに完了時点でダウンロードするため）
	const resultsRef = useRef<StrippedResult[]>([]);

	const {
		items,
		processing,
		progress,
		error,
		setError,
		hold,
		startHeld,
		clear: clearBatch,
	} = useBatchProcessing<ExifItem>({
		fallbackErrorMessage: 'メタデータの削除に失敗しました。',
		releaseItem: releaseExifItem,
		onRunComplete: () => {
			trackRun();
			const results = resultsRef.current;
			resultsRef.current = [];
			void downloadResults(results);
		},
	});

	const hasNonTrivialOrientation = items.some(
		(it) => it.exif.orientation != null && it.exif.orientation !== 1,
	);
	const hasAnyGps = items.some((it) => it.exif.hasGps);

	const handleFilesSelect = useCallback(
		async (files: File[]) => {
			const batch = validateBatch(files);
			if (!batch.ok) {
				setError(batch.message);
				return;
			}
			const checks = await Promise.all(
				files.map(async (file) => ({
					file,
					v: await validateImageFile(file),
				})),
			);
			const valid: { file: File; format: ExifItem['format'] }[] = [];
			const errors: string[] = [];
			for (const { file, v } of checks) {
				if (v.ok) valid.push({ file, format: v.format });
				else errors.push(v.message);
			}
			setError(errors.length > 0 ? errors.join('\n') : null);
			if (valid.length === 0) return;

			const next: ExifItem[] = await Promise.all(
				valid.map(async ({ file, format }) => {
					const bytes = new Uint8Array(await file.arrayBuffer());
					const exif = parseExif(bytes);
					return {
						id: createId(),
						status: 'pending' as const,
						file,
						previewUrl: URL.createObjectURL(file),
						format,
						exif,
					};
				}),
			);
			// ここでは保持のみ行い、実処理（メタデータ削除）は「メタデータを削除」ボタン押下まで開始しない
			hold(next);
		},
		[hold, setError],
	);

	const handleStripAll = useCallback(() => {
		resultsRef.current = [];
		startHeld(async (item) => {
			let bytes = new Uint8Array(await item.file.arrayBuffer());

			if (
				bakeOri &&
				item.exif.orientation != null &&
				item.exif.orientation !== 1
			) {
				bytes = await bakeOrientation(bytes, item.exif.orientation);
			}

			const result = stripMetadata(bytes, item.format);
			const blob = new Blob([result.data.slice()], {
				type: `image/${item.format}`,
			});
			const strippedFileName = buildCleanedFileName(item.file.name);

			resultsRef.current.push({ blob, fileName: strippedFileName });

			return {
				strippedBlob: blob,
				strippedFileName,
				warnings: result.warnings,
			};
		});
	}, [startHeld, bakeOri]);

	const handleClear = useCallback(() => {
		clearBatch();
		resultsRef.current = [];
		setBakeOri(false);
	}, [clearBatch]);

	const doneCount = items.filter((it) => it.status === 'done').length;
	// 逐次処理は items の並び順どおりに進むため、進捗インデックスの位置にあるアイテムが処理中とみなせる
	const strippingId = processing ? items[progress.done]?.id : undefined;

	return (
		<div className="space-y-6">
			<FileDropzone
				multiple
				onFileSelect={() => {}}
				onFilesSelect={handleFilesSelect}
				accept={ACCEPT}
				disabled={processing}
				label="画像をドラッグ＆ドロップ"
				description={`JPEG / TIFF / WebP（最大${MAX_DISPLAY_FILES}枚・1枚50MBまで）`}
				privacyNote="画像はサーバーに送信されません。すべてブラウザ内で処理されます。"
				inputAriaLabel="EXIF を確認する画像を選択"
				data-testid="exif-input"
			/>

			{error && (
				<div
					className="whitespace-pre-line rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
					role="alert"
				>
					{error}
				</div>
			)}

			{items.length > 0 && (
				<>
					{/* GPS 警告バナー */}
					{hasAnyGps && (
						<div
							className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
							role="alert"
						>
							<ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
							<div>
								<p className="font-medium text-destructive">
									GPS 位置情報が含まれています
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									この画像には撮影場所の座標が記録されています。SNS
									等に投稿する前にメタデータの削除をお勧めします。
								</p>
							</div>
						</div>
					)}

					{/* オプション */}
					{hasNonTrivialOrientation && (
						<div className="flex items-center gap-2 rounded-lg border border-border p-3">
							<Checkbox
								id="bake-orientation"
								checked={bakeOri}
								onCheckedChange={(v) => setBakeOri(v === true)}
							/>
							<label
								htmlFor="bake-orientation"
								className="text-sm text-muted-foreground cursor-pointer"
							>
								回転情報をピクセルに焼き込む（見た目を維持するため再エンコードします）
							</label>
						</div>
					)}

					{/* アクションバー */}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={handleStripAll}
							disabled={processing}
							data-testid="strip-button"
						>
							<Trash2 className="h-4 w-4" />
							<span className="ml-1">
								メタデータを削除
								{items.length >= 2 ? `（${items.length}件）` : ''}
							</span>
						</Button>
						{doneCount >= 2 && (
							<Button
								variant="outline"
								onClick={async () => {
									const done = items.filter(
										(it) => it.status === 'done' && it.strippedBlob,
									);
									const names = dedupeZipNames(
										done.map((it) => it.strippedFileName ?? 'cleaned.jpg'),
									);
									const zip = await buildZip(
										done.map((it, i) => ({
											name: names[i],
											data: it.strippedBlob as Blob,
										})),
									);
									downloadBlob(zip, 'cleaned.zip');
								}}
								disabled={processing}
							>
								<Package className="h-4 w-4" />
								<span className="ml-1">ZIPでまとめてダウンロード</span>
							</Button>
						)}
						<Button variant="ghost" onClick={handleClear} disabled={processing}>
							クリア
						</Button>
					</div>

					<p className="text-xs text-muted-foreground">
						削除は再圧縮せずメタデータ領域のみを除去するため画質は劣化しません（一部形式を除く）。
					</p>

					{/* 処理中プログレス */}
					{processing && (
						<div className="space-y-2" aria-live="polite">
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin text-primary" />
								<span>
									処理中… {progress.done} / {progress.total}
								</span>
							</div>
							<div
								className="h-2 w-full overflow-hidden rounded-full bg-muted"
								role="progressbar"
								aria-valuenow={progress.done}
								aria-valuemin={0}
								aria-valuemax={progress.total}
							>
								<div
									className="h-full rounded-full bg-primary transition-all duration-200"
									style={{
										width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
									}}
								/>
							</div>
						</div>
					)}

					{/* 完了メッセージ */}
					{doneCount > 0 && !processing && (
						<div
							className="flex items-start gap-2 rounded-lg border border-safety/30 bg-safety/10 p-3 text-sm"
							role="status"
							aria-live="polite"
							data-testid="strip-completion"
						>
							<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-safety" />
							<div>
								<p className="font-medium text-foreground">
									{doneCount}件の画像からメタデータを削除しました。
									{items.length === 1
										? 'ダウンロードが自動的に開始されます。'
										: 'ZIPファイルが自動的にダウンロードされます。'}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									処理はブラウザ内で完了しています。
								</p>
							</div>
						</div>
					)}

					{/* 結果一覧 */}
					<div className="space-y-4" data-testid="exif-results">
						{items.map((item) => (
							<ExifCard
								key={item.id}
								item={item}
								isStripping={item.id === strippingId}
								onDownload={() => {
									if (item.strippedBlob) {
										downloadBlob(
											item.strippedBlob,
											item.strippedFileName ?? 'cleaned.jpg',
										);
									}
								}}
							/>
						))}
					</div>
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// ExifCard — 1画像ごとのカード
// ---------------------------------------------------------------------------

function ExifCard({
	item,
	isStripping,
	onDownload,
}: {
	item: ExifItem;
	isStripping: boolean;
	onDownload: () => void;
}) {
	const { exif } = item;
	const groups = groupTags(exif.tags);

	return (
		<div className="rounded-xl border border-border bg-card p-4 space-y-3">
			<div className="flex gap-4">
				{/* サムネイル */}
				<div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-muted">
					<img
						src={item.previewUrl}
						alt={item.file.name}
						className="w-full h-full object-cover"
						loading="lazy"
					/>
				</div>

				{/* ファイル情報 + ステータス */}
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium truncate">{item.file.name}</p>
					<p className="text-xs text-muted-foreground">
						{(item.file.size / 1024).toFixed(0)} KB ・{' '}
						{item.format.toUpperCase()}
					</p>

					<div className="flex flex-wrap gap-1.5 mt-1.5">
						{exif.hasExif ? (
							<Badge variant="secondary" className="text-xs">
								EXIF あり
							</Badge>
						) : (
							<Badge variant="outline" className="text-xs">
								EXIF なし
							</Badge>
						)}

						{exif.hasGps && (
							<Badge
								variant="destructive"
								className="text-xs"
								data-testid="gps-badge"
							>
								<MapPin className="h-3 w-3 mr-0.5" />
								GPS あり
							</Badge>
						)}

						{exif.orientation != null && exif.orientation !== 1 && (
							<Badge variant="outline" className="text-xs">
								回転: {exif.orientation}
							</Badge>
						)}
					</div>

					{isStripping && (
						<p className="mt-2 text-xs text-primary">処理中...</p>
					)}

					{/* 処理完了時のDLボタン */}
					{item.status === 'done' && item.strippedBlob && (
						<Button
							variant="outline"
							size="sm"
							className="mt-2"
							onClick={onDownload}
						>
							<Download className="h-3.5 w-3.5" />
							<span className="ml-1 text-xs">ダウンロード</span>
						</Button>
					)}

					{item.status === 'error' && (
						<div className="mt-2 flex items-center gap-1 text-xs text-destructive">
							<AlertTriangle className="h-3.5 w-3.5" />
							{item.error}
						</div>
					)}

					{item.warnings && item.warnings.length > 0 && (
						<div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
							{item.warnings.map((w) => (
								<p key={w} className="flex items-center gap-1">
									<AlertTriangle
										className="h-3.5 w-3.5 shrink-0"
										aria-hidden="true"
									/>
									{w}
								</p>
							))}
						</div>
					)}
				</div>
			</div>

			{/* タグ一覧 */}
			{exif.hasExif && (
				<div className="space-y-2">
					{GROUP_ORDER.map((groupKey) => {
						const tags = groups[groupKey];
						if (tags.length === 0) return null;
						return (
							<div key={groupKey}>
								<p className="text-xs font-semibold text-muted-foreground mb-1">
									{GROUP_LABELS[groupKey]}
								</p>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
									{tags.map((tag) => (
										<div
											key={tag.tagId}
											className="flex justify-between text-xs py-0.5"
										>
											<span className="text-muted-foreground">{tag.label}</span>
											<span
												className={`font-mono text-right truncate ml-2 ${groupKey === 'gps' ? 'text-destructive font-medium' : ''}`}
											>
												{tag.value}
											</span>
										</div>
									))}
								</div>
							</div>
						);
					})}

					{/* GPS 地図リンク */}
					{exif.gps && (
						<div className="flex items-center gap-2 pt-1 border-t border-border">
							<a
								href={`https://www.google.com/maps?q=${exif.gps.lat},${exif.gps.lng}`}
								target="_blank"
								rel="noreferrer noopener"
								className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
							>
								<ExternalLink className="h-3 w-3" />
								Google Maps で確認
							</a>
							<span className="text-xs text-muted-foreground">
								（外部サイトに座標情報が送信されます）
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
