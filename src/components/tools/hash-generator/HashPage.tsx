import { AlertTriangle, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
	HASH_ALGORITHM_LABELS,
	HASH_ALGORITHMS,
	type HashAlgorithm,
	type HashResults,
	hashFile,
	hashText,
	isShaAlgorithm,
	MAX_FILE_SIZE,
	validateHashFile,
} from '@/lib/tools/hash';
import { HashResultTable } from './HashResultTable';
import { HashVerifier } from './HashVerifier';

type InputMode = 'text' | 'file';

const MB = 1024 * 1024;
const FILE_TOO_LARGE_MESSAGE = `ファイルサイズが上限（${MAX_FILE_SIZE / MB}MB）を超えています。`;

export function HashPage() {
	const [inputMode, setInputMode] = useState<InputMode>('text');
	const [text, setText] = useState('');
	const [file, setFile] = useState<File | null>(null);
	const [algorithms, setAlgorithms] = useState<HashAlgorithm[]>([
		'md5',
		'sha1',
		'sha256',
	]);
	const [results, setResults] = useState<HashResults>({});
	const [computing, setComputing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [uppercase, setUppercase] = useState(false);
	const [confirmHugeFile, setConfirmHugeFile] = useState<File | null>(null);
	const runIdRef = useRef(0);

	// --- テキスト入力の自動計算（300ms debounce + 古い結果の破棄） ---
	useEffect(() => {
		if (inputMode !== 'text') return;
		const runId = ++runIdRef.current;
		const timer = setTimeout(async () => {
			if (algorithms.length === 0 || text === '') {
				setResults({});
				return;
			}
			setComputing(true);
			try {
				const computed = await hashText(text, algorithms);
				if (runIdRef.current === runId) {
					setResults(computed);
					setError(null);
				}
			} catch (err) {
				if (runIdRef.current === runId) {
					setError(
						err instanceof Error
							? err.message
							: 'ハッシュの計算に失敗しました。',
					);
				}
			} finally {
				if (runIdRef.current === runId) setComputing(false);
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [inputMode, text, algorithms]);

	// --- ファイル計算 ---
	const runFileHash = useCallback(
		async (target: File, selected: readonly HashAlgorithm[]) => {
			const runId = ++runIdRef.current;
			setComputing(true);
			setProgress(0);
			setError(null);
			try {
				const computed = await hashFile(target, selected, (percent) => {
					if (runIdRef.current === runId) setProgress(percent);
				});
				if (runIdRef.current === runId) setResults(computed);
			} catch (err) {
				if (runIdRef.current === runId) {
					setError(
						err instanceof Error
							? err.message
							: 'ハッシュの計算に失敗しました。ファイルが大きすぎる可能性があります。',
					);
					setResults({});
				}
			} finally {
				if (runIdRef.current === runId) setComputing(false);
			}
		},
		[],
	);

	// warnLevel は validateHashFile を単一のソースとして使用する
	const startFileHash = useCallback(
		(target: File, selected: readonly HashAlgorithm[]) => {
			const validation = validateHashFile(target);
			if (!validation.ok) {
				setError(FILE_TOO_LARGE_MESSAGE);
				return;
			}
			if (validation.warnLevel === 'huge' && selected.some(isShaAlgorithm)) {
				setConfirmHugeFile(target);
				return;
			}
			runFileHash(target, selected);
		},
		[runFileHash],
	);

	const handleFileSelect = useCallback(
		(selected: File) => {
			// ファイル差し替え時は前回結果をクリア
			setResults({});
			setError(null);
			setFile(selected);
			if (algorithms.length > 0) startFileHash(selected, algorithms);
		},
		[algorithms, startFileHash],
	);

	const handleAlgorithmToggle = useCallback(
		(algorithm: HashAlgorithm, checked: boolean) => {
			const next = checked
				? [...algorithms, algorithm]
				: algorithms.filter((a) => a !== algorithm);
			setAlgorithms(next);
			if (inputMode === 'file' && file) {
				setResults({});
				if (next.length > 0) startFileHash(file, next);
			}
		},
		[algorithms, inputMode, file, startFileHash],
	);

	const handleClearFile = useCallback(() => {
		runIdRef.current++;
		setFile(null);
		setResults({});
		setError(null);
		setComputing(false);
	}, []);

	const handleModeChange = useCallback((mode: string) => {
		runIdRef.current++;
		setInputMode(mode as InputMode);
		setResults({});
		setError(null);
		setComputing(false);
	}, []);

	const fileWarnLevel =
		file && inputMode === 'file'
			? (() => {
					const v = validateHashFile(file);
					return v.ok ? v.warnLevel : null;
				})()
			: null;

	return (
		<div className="space-y-6">
			{/* 入力切替 */}
			<Tabs value={inputMode} onValueChange={handleModeChange}>
				<TabsList className="w-full grid grid-cols-2">
					<TabsTrigger value="text">テキスト</TabsTrigger>
					<TabsTrigger value="file">ファイル</TabsTrigger>
				</TabsList>
				<TabsContent value="text" className="mt-3">
					<Textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="ハッシュ値を計算するテキストを入力（入力すると自動で計算されます）"
						className="min-h-32 font-mono"
						aria-label="ハッシュ計算するテキスト"
					/>
				</TabsContent>
				<TabsContent value="file" className="mt-3">
					<FileDropzone
						onFileSelect={handleFileSelect}
						onValidationError={setError}
						maxSizeBytes={MAX_FILE_SIZE}
						validationMessage={FILE_TOO_LARGE_MESSAGE}
						description={`任意のファイルに対応（最大${MAX_FILE_SIZE / MB}MB）`}
						selectedFileName={file?.name ?? null}
						onClear={handleClearFile}
						inputAriaLabel="ハッシュ計算するファイルを選択"
						data-testid="hash-file-input"
					/>
					{fileWarnLevel === 'large' && (
						<p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
							<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
							100MBを超えるファイルのため、処理に時間がかかる場合があります。
						</p>
					)}
				</TabsContent>
			</Tabs>

			{/* アルゴリズム選択 */}
			<div className="rounded-lg border border-border p-4">
				<p className="text-sm font-semibold mb-3">計算するアルゴリズム</p>
				<div className="flex flex-wrap gap-x-6 gap-y-3">
					{HASH_ALGORITHMS.map((algorithm) => (
						<div key={algorithm} className="flex items-center gap-2">
							<Checkbox
								id={`algo-${algorithm}`}
								checked={algorithms.includes(algorithm)}
								onCheckedChange={(checked) =>
									handleAlgorithmToggle(algorithm, checked === true)
								}
							/>
							<Label
								htmlFor={`algo-${algorithm}`}
								className="text-sm cursor-pointer"
							>
								{HASH_ALGORITHM_LABELS[algorithm]}
							</Label>
						</div>
					))}
				</div>
			</div>

			{/* エラー表示 */}
			{error && (
				<div
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
					role="alert"
				>
					{error}
				</div>
			)}

			{/* ファイル計算の進捗バー */}
			{computing && inputMode === 'file' && (
				<div className="space-y-2">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						<span>計算中… {Math.round(progress)}%</span>
					</div>
					<div
						className="h-2 w-full rounded-full bg-muted overflow-hidden"
						role="progressbar"
						aria-valuenow={Math.round(progress)}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<div
							className="h-full rounded-full bg-primary transition-all duration-200"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>
			)}

			{/* 結果 */}
			<HashResultTable
				selectedAlgorithms={algorithms}
				results={results}
				computing={computing}
				uppercase={uppercase}
				onUppercaseChange={setUppercase}
			/>

			{/* 期待値照合 */}
			<HashVerifier results={results} selectedAlgorithms={algorithms} />

			{/* 200MB超 + SHA系選択時の確認モーダル */}
			<Dialog
				open={confirmHugeFile != null}
				onOpenChange={(open) => {
					if (!open) setConfirmHugeFile(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>大容量ファイルの確認</DialogTitle>
						<DialogDescription>
							200MBを超えるファイルでSHA系アルゴリズムを計算するには、ファイル全体をメモリに読み込む必要があります。環境によっては処理に失敗したり、時間がかかる場合があります。続行しますか？
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmHugeFile(null)}>
							キャンセル
						</Button>
						<Button
							onClick={() => {
								const target = confirmHugeFile;
								setConfirmHugeFile(null);
								if (target) runFileHash(target, algorithms);
							}}
						>
							計算する
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
