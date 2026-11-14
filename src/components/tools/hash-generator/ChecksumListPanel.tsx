import { CheckCircle2, HelpCircle, Loader2, XCircle } from 'lucide-react';
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
	buildChecksumReport,
	CHECKSUM_LINE_ERROR_MESSAGES,
	type ChecksumEntryStatus,
	type ChecksumFileState,
	MAX_CHECKSUM_FILES,
	parseChecksumList,
	requiredAlgorithmsForFile,
} from '@/lib/tools/checksum-list';
import {
	HASH_ALGORITHM_LABELS,
	type HashResults,
	hashFile,
	MAX_FILE_SIZE,
} from '@/lib/tools/hash';

const MB = 1024 * 1024;

const STATUS_LABELS: Record<ChecksumEntryStatus, string> = {
	match: '一致',
	mismatch: '不一致',
	missing: 'ファイル未選択',
	'duplicate-file': '同名ファイルが複数',
	pending: '計算中',
	failed: '計算できません',
};

const STATUS_CLASSES: Record<ChecksumEntryStatus, string> = {
	match: 'bg-green-500/10 text-green-600 dark:text-green-500',
	mismatch: 'bg-destructive/10 text-destructive',
	missing: 'bg-muted text-muted-foreground',
	'duplicate-file': 'bg-amber-500/10 text-amber-600 dark:text-amber-500',
	pending: 'bg-muted text-muted-foreground',
	failed: 'bg-destructive/10 text-destructive',
};

function StatusIcon({ status }: { status: ChecksumEntryStatus }) {
	if (status === 'match') return <CheckCircle2 className="h-3.5 w-3.5" />;
	if (status === 'mismatch' || status === 'failed') {
		return <XCircle className="h-3.5 w-3.5" />;
	}
	if (status === 'pending') {
		return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
	}
	return <HelpCircle className="h-3.5 w-3.5" />;
}

type CacheValue = { kind: 'done'; results: HashResults } | { kind: 'failed' };

/**
 * チェックサムリスト（SHA256SUMS など）で複数ファイルを一括照合する欄。
 * リストとファイルはブラウザ内だけで扱い、保存（localStorage・URL）も計測もしない。
 */
export function ChecksumListPanel() {
	const id = useId();
	const [listText, setListText] = useState('');
	const [debouncedList, setDebouncedList] = useState('');
	const [files, setFiles] = useState<File[]>([]);
	const [fileError, setFileError] = useState<string | null>(null);
	const [cache, setCache] = useState<ReadonlyMap<File, CacheValue>>(new Map());
	const cacheRef = useRef(cache);
	cacheRef.current = cache;
	const runIdRef = useRef(0);

	// 貼り付け・入力の途中で解析し直さないよう 300ms 待つ
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedList(listText), 300);
		return () => clearTimeout(timer);
	}, [listText]);

	const parsed = useMemo(
		() => parseChecksumList(debouncedList),
		[debouncedList],
	);

	// 同名ファイルは判定しないため計算もしない
	const uniqueFiles = useMemo(() => {
		const counts = new Map<string, number>();
		for (const f of files) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
		return files.filter((f) => counts.get(f.name) === 1);
	}, [files]);

	// リストが必要とするアルゴリズムのうち、未計算のものだけを1ファイルずつ計算する
	useEffect(() => {
		const runId = ++runIdRef.current;
		const jobs = uniqueFiles
			.map((file) => {
				const needed = requiredAlgorithmsForFile(parsed.entries, file.name);
				const cached = cacheRef.current.get(file);
				if (cached?.kind === 'failed') return null;
				const missing = needed.filter(
					(a) => cached?.kind !== 'done' || cached.results[a] == null,
				);
				return missing.length > 0 ? { file, missing } : null;
			})
			.filter((job) => job != null);
		if (jobs.length === 0) return;

		(async () => {
			for (const { file, missing } of jobs) {
				if (runIdRef.current !== runId) return;
				let value: CacheValue;
				if (file.size > MAX_FILE_SIZE) {
					value = { kind: 'failed' };
				} else {
					try {
						const results = await hashFile(file, missing);
						const cached = cacheRef.current.get(file);
						value = {
							kind: 'done',
							results: {
								...(cached?.kind === 'done' ? cached.results : {}),
								...results,
							},
						};
					} catch {
						value = { kind: 'failed' };
					}
				}
				if (runIdRef.current !== runId) return;
				setCache((prev) => new Map(prev).set(file, value));
			}
		})();
	}, [uniqueFiles, parsed.entries]);

	const fileStates = useMemo(() => {
		const states = new Map<string, ChecksumFileState>();
		for (const file of uniqueFiles) {
			states.set(file.name, cache.get(file) ?? { kind: 'pending' });
		}
		return states;
	}, [uniqueFiles, cache]);

	const report = useMemo(
		() =>
			buildChecksumReport(
				parsed.entries,
				files.map((f) => f.name),
				fileStates,
			),
		[parsed.entries, files, fileStates],
	);

	const handleFilesSelect = useCallback((selected: File[]) => {
		if (selected.length > MAX_CHECKSUM_FILES) {
			setFileError(
				`一度に照合できるのは${MAX_CHECKSUM_FILES}ファイルまでです（選択: ${selected.length}ファイル）。`,
			);
			return;
		}
		setFileError(null);
		setFiles(selected);
		setCache(new Map());
	}, []);

	const handleClear = useCallback(() => {
		runIdRef.current++;
		setFiles([]);
		setCache(new Map());
		setFileError(null);
	}, []);

	const listId = `${id}-list`;
	const hasRows = report.rows.length > 0;
	const { counts } = report;

	return (
		<section
			className="rounded-lg border border-border p-4 space-y-4"
			aria-labelledby={`${id}-heading`}
			data-testid="checksum-list-panel"
		>
			<div className="space-y-1">
				<h2 id={`${id}-heading`} className="text-sm font-semibold">
					チェックサムリストで複数ファイルを一括照合
				</h2>
				<p className="text-xs text-muted-foreground">
					配布元の SHA256SUMS
					などを貼り付け、ファイルをまとめて選ぶと、ファイル名ごとに一致・不一致を確認します。ファイルはブラウザ内だけで処理し、保存・送信しません。
				</p>
			</div>

			<div className="space-y-2">
				<Label htmlFor={listId} className="text-sm">
					チェックサムリスト
				</Label>
				<Textarea
					id={listId}
					value={listText}
					onChange={(e) => setListText(e.target.value)}
					placeholder={
						'例:\ne3b0c442...b855  app-1.0.zip\nSHA256 (app-1.0.tar.gz) = 9f86d081...0f00a08'
					}
					className="min-h-28 font-mono text-xs"
					spellCheck={false}
				/>
				<p className="text-xs text-muted-foreground">
					「ハッシュ値＋空白2個＋ファイル名」（sha256sum 形式）と「SHA256
					(ファイル名) = ハッシュ値」（BSD 形式）に対応。空行と #
					で始まる行は無視します。
				</p>
			</div>

			{parsed.errors.length > 0 && (
				<div
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive space-y-1"
					data-testid="checksum-list-errors"
				>
					<p className="font-medium">
						読み取れない行が{parsed.errors.length}行あります（照合の対象外）
					</p>
					<ul className="space-y-1">
						{parsed.errors.slice(0, 20).map((error) => (
							<li key={error.lineNumber} className="break-all">
								{error.lineNumber}行目:{' '}
								{CHECKSUM_LINE_ERROR_MESSAGES[error.reason]}
								<span className="block font-mono text-destructive/80">
									{error.line}
								</span>
							</li>
						))}
					</ul>
					{parsed.errors.length > 20 && (
						<p>ほか{parsed.errors.length - 20}行</p>
					)}
				</div>
			)}

			<FileDropzone
				multiple
				onFileSelect={() => {}}
				onFilesSelect={handleFilesSelect}
				label="照合するファイルをまとめてドラッグ＆ドロップ"
				description={`複数選択できます（${MAX_CHECKSUM_FILES}ファイルまで、1ファイル最大${MAX_FILE_SIZE / MB}MB）`}
				selectedFileName={
					files.length > 0 ? `${files.length}ファイルを選択中` : null
				}
				onClear={handleClear}
				inputAriaLabel="一括照合するファイルを選択"
				data-testid="checksum-list-file-input"
			/>
			{fileError && (
				<p className="text-sm text-destructive" role="alert">
					{fileError}
				</p>
			)}

			<p
				className="text-sm"
				aria-live="polite"
				data-testid="checksum-list-summary"
			>
				{hasRows ? (
					<>
						一致 {counts.match}件・不一致 {counts.mismatch}件
						{counts.missing > 0 && `・ファイル未選択 ${counts.missing}件`}
						{counts['duplicate-file'] > 0 &&
							`・同名ファイルが複数 ${counts['duplicate-file']}件`}
						{counts.failed > 0 && `・計算できません ${counts.failed}件`}
						{counts.pending > 0 && `（計算中 ${counts.pending}件）`}
					</>
				) : (
					<span className="text-muted-foreground">
						チェックサムリストを貼り付けると、ここに照合結果が表示されます。
					</span>
				)}
			</p>

			{hasRows && (
				<ul className="space-y-2" data-testid="checksum-list-results">
					{report.rows.map((row) => (
						<li
							key={row.lineNumber}
							className="rounded-lg border border-border p-3 space-y-1"
							data-status={row.status}
						>
							<div className="flex flex-wrap items-center gap-2">
								<span
									className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.status]}`}
								>
									<StatusIcon status={row.status} />
									{STATUS_LABELS[row.status]}
								</span>
								<span className="min-w-0 break-all font-mono text-sm">
									{row.listedName}
								</span>
							</div>
							<p className="text-xs text-muted-foreground">
								{HASH_ALGORITHM_LABELS[row.algorithm]}・{row.lineNumber}行目
							</p>
							{row.status === 'mismatch' && row.computed != null && (
								<dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
									<dt className="text-muted-foreground">リストの値</dt>
									<dd className="break-all font-mono">{row.hash}</dd>
									<dt className="text-muted-foreground">計算した値</dt>
									<dd className="break-all font-mono">{row.computed}</dd>
								</dl>
							)}
							{row.status === 'failed' && (
								<p className="text-xs text-destructive">
									ファイルが{MAX_FILE_SIZE / MB}
									MBを超えているか、読み込みに失敗しました。
								</p>
							)}
						</li>
					))}
				</ul>
			)}

			{report.unlistedFiles.length > 0 && (
				<p
					className="text-xs text-muted-foreground break-all"
					data-testid="checksum-list-unlisted"
				>
					リストに記載なし（照合していないファイル）:{' '}
					{report.unlistedFiles.join('、')}
				</p>
			)}
		</section>
	);
}
