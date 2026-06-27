import { AlertCircle, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
	AnalyzeOptions,
	PlacedWord,
	WordCloudLayoutOptions,
	WordFrequency,
} from '@/lib/tools/wordcloud/index.ts';
import { computeLayout } from '@/lib/tools/wordcloud/index.ts';
import type {
	WorkerInputMessage,
	WorkerOutputMessage,
} from '@/workers/wordcloud.worker.ts';
import { AnalysisOptions } from './AnalysisOptions';
import { ExportButtons } from './ExportButtons';
import { FrequencyTable } from './FrequencyTable';
import { TextInput } from './TextInput';
import { WordCloudCanvas } from './WordCloudCanvas';

const INITIAL_OPTIONS: AnalyzeOptions = {
	analyzer: 'tiny-segmenter',
	posFilter: ['noun', 'proper-noun', 'adjective'],
	useBaseForm: true,
	useStopwords: true,
	customStopwords: [],
	minCount: 2,
	maxWords: 100,
};

const INITIAL_LAYOUT_OPTIONS: WordCloudLayoutOptions = {
	width: 800,
	height: 450,
	fontFamily: 'Noto Sans JP',
	scale: 'sqrt',
	rotation: 'orthogonal',
	palette: 'tableau10',
};

export function WordCloudPage() {
	const [text, setText] = useState<string>('');
	const [options, setOptions] = useState<AnalyzeOptions>(INITIAL_OPTIONS);
	const [layoutOptions, setLayoutOptions] = useState<WordCloudLayoutOptions>(
		INITIAL_LAYOUT_OPTIONS,
	);

	const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
	const [frequencies, setFrequencies] = useState<WordFrequency[]>([]);
	const [placedWords, setPlacedWords] = useState<PlacedWord[]>([]);
	const [error, setError] = useState<string | null>(null);

	const workerRef = useRef<Worker | null>(null);
	const runIdRef = useRef<number>(0);

	const runAnalysis = useCallback(
		(
			inputText: string,
			currentOpts: AnalyzeOptions,
			currentLayoutOpts: WordCloudLayoutOptions,
		) => {
			const currentRunId = ++runIdRef.current;

			if (!inputText || inputText.trim().length === 0) {
				setFrequencies([]);
				setPlacedWords([]);
				setError(null);
				setIsAnalyzing(false);
				return;
			}

			setIsAnalyzing(true);
			setError(null);

			if (workerRef.current) {
				workerRef.current.terminate();
			}

			const worker = new Worker(
				new URL('../../workers/wordcloud.worker.ts', import.meta.url),
				{
					type: 'module',
				},
			);
			workerRef.current = worker;

			worker.onmessage = async (e: MessageEvent<WorkerOutputMessage>) => {
				if (currentRunId !== runIdRef.current) return;
				const data = e.data;
				if (data.type === 'SUCCESS') {
					setFrequencies(data.result.frequencies);
					try {
						const placed = await computeLayout(
							data.result.frequencies,
							currentLayoutOpts,
						);
						if (currentRunId !== runIdRef.current) return;
						setPlacedWords(placed);
					} catch (_err: unknown) {
						if (currentRunId !== runIdRef.current) return;
						setError('ワードクラウドの描画配置計算中にエラーが発生しました。');
					} finally {
						if (currentRunId === runIdRef.current) {
							setIsAnalyzing(false);
						}
					}
				} else if (data.type === 'ERROR') {
					setFrequencies([]);
					setPlacedWords([]);
					setError(data.error);
					setIsAnalyzing(false);
				}
			};

			worker.onerror = () => {
				if (currentRunId !== runIdRef.current) return;
				setFrequencies([]);
				setPlacedWords([]);
				setError('解析処理中に予測せぬエラーが発生しました。');
				setIsAnalyzing(false);
			};

			const msg: WorkerInputMessage = {
				type: 'ANALYZE',
				text: inputText,
				opts: currentOpts,
			};
			worker.postMessage(msg);
		},
		[],
	);

	useEffect(() => {
		const timer = setTimeout(() => {
			runAnalysis(text, options, layoutOptions);
		}, 300);

		return () => clearTimeout(timer);
	}, [text, options, layoutOptions, runAnalysis]);

	useEffect(() => {
		return () => {
			if (workerRef.current) {
				workerRef.current.terminate();
			}
		};
	}, []);

	return (
		<div className="space-y-8">
			{/* セキュリティ・安心バナー */}
			<div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-700 dark:text-emerald-300">
				<ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
				<span>
					<strong>安心のブラウザ内完結処理:</strong>{' '}
					入力テキストやファイルデータは一切外部サーバーに送信されません。機密文書や社内アンケートデータも安全に解析できます。
				</span>
			</div>

			{/* 入力エリア */}
			<TextInput
				text={text}
				onTextChange={setText}
				onClear={() => setText('')}
				disabled={isAnalyzing}
			/>

			{/* オプションエリア */}
			<AnalysisOptions
				options={options}
				layoutOptions={layoutOptions}
				onOptionsChange={setOptions}
				onLayoutOptionsChange={setLayoutOptions}
				disabled={isAnalyzing}
			/>

			{/* エラー表示 */}
			{error && (
				<div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
					<AlertCircle className="h-4 w-4 shrink-0" />
					<span>{error}</span>
				</div>
			)}

			{/* ワードクラウド描画キャンバス */}
			<WordCloudCanvas
				placedWords={placedWords}
				layoutOptions={layoutOptions}
				isLoading={isAnalyzing}
			/>

			{/* エクスポートボタン */}
			<ExportButtons
				frequencies={frequencies}
				placedWords={placedWords}
				layoutOptions={layoutOptions}
				disabled={isAnalyzing}
			/>

			{/* 頻度表 */}
			<FrequencyTable frequencies={frequencies} />
		</div>
	);
}
