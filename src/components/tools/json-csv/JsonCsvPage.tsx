import { Download, FileJson, Sparkles, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob } from '@/lib/download';
import {
	buildCsvBlob,
	type ConvertResult,
	type CsvToJsonOptions,
	csvToJson,
	type JsonToCsvOptions,
	jsonToCsv,
} from '@/lib/tools/json-csv';
import { ConvertOptionsPanel, type Direction } from './ConvertOptionsPanel';

// 1MB以上の入力は自動変換を停止し、手動の「変換」ボタンに切り替える
const MANUAL_MODE_THRESHOLD = 1024 * 1024;
const MAX_INPUT_FILE_SIZE = 10 * 1024 * 1024;

const SAMPLE_JSON = JSON.stringify(
	[
		{
			name: '山田太郎',
			age: 30,
			contact: { email: 'taro@example.com', tel: '03-1234-5678' },
			tags: ['営業', 'リーダー'],
		},
		{
			name: '鈴木花子',
			age: 25,
			contact: { email: 'hanako@example.com', tel: '06-9876-5432' },
			tags: ['開発'],
		},
	],
	null,
	2,
);

const SAMPLE_CSV = [
	'name,age,department,active',
	'山田太郎,30,営業部,true',
	'鈴木花子,25,開発部,false',
	'佐藤次郎,41,人事部,true',
].join('\r\n');

export function JsonCsvPage() {
	const [direction, setDirection] = useState<Direction>('json-to-csv');
	const [input, setInput] = useState('');
	const [result, setResult] = useState<ConvertResult | null>(null);
	const [jsonOpts, setJsonOpts] = useState<JsonToCsvOptions>({
		delimiter: ',',
		includeHeader: true,
		flattenNested: true,
		newline: '\r\n',
	});
	const [csvOpts, setCsvOpts] = useState<CsvToJsonOptions>({
		delimiter: 'auto',
		hasHeader: true,
		inferTypes: true,
		unflattenDotKeys: false,
	});
	const [withBom, setWithBom] = useState(true);

	const isManualMode = input.length >= MANUAL_MODE_THRESHOLD;

	const convert = useCallback(() => {
		if (!input.trim()) {
			setResult(null);
			return;
		}
		setResult(
			direction === 'json-to-csv'
				? jsonToCsv(input, jsonOpts)
				: csvToJson(input, csvOpts),
		);
	}, [input, direction, jsonOpts, csvOpts]);

	// 自動変換（300ms debounce）。1MB以上は手動実行に切り替え
	useEffect(() => {
		if (isManualMode) return;
		const timer = setTimeout(convert, 300);
		return () => clearTimeout(timer);
	}, [convert, isManualMode]);

	const handleDirectionChange = useCallback((value: string) => {
		setDirection(value as Direction);
		setResult(null);
	}, []);

	const handleFileSelect = useCallback(
		async (file: File) => {
			try {
				const text = await file.text();
				setInput(text);
				setResult(
					direction === 'json-to-csv'
						? jsonToCsv(text, jsonOpts)
						: csvToJson(text, csvOpts),
				);
			} catch (_error) {
				setResult({ ok: false, error: 'ファイルの読み込みに失敗しました。' });
			}
		},
		[direction, jsonOpts, csvOpts],
	);

	const handleSample = useCallback(() => {
		const sampleText = direction === 'json-to-csv' ? SAMPLE_JSON : SAMPLE_CSV;
		setInput(sampleText);
		setResult(
			direction === 'json-to-csv'
				? jsonToCsv(sampleText, jsonOpts)
				: csvToJson(sampleText, csvOpts),
		);
	}, [direction, jsonOpts, csvOpts]);

	const handleDownload = useCallback(() => {
		if (!result?.ok || !result.output) return;
		if (direction === 'json-to-csv') {
			// Preview = Export: 画面表示と同じ output からBlobを生成する
			downloadBlob(buildCsvBlob(result.output, withBom), 'converted.csv');
		} else {
			downloadBlob(
				new Blob([result.output], { type: 'application/json;charset=utf-8' }),
				'converted.json',
			);
		}
	}, [result, direction, withBom]);

	const output = result?.ok ? result.output : '';
	const inputLabel = direction === 'json-to-csv' ? 'JSON' : 'CSV';
	const outputLabel = direction === 'json-to-csv' ? 'CSV' : 'JSON';

	return (
		<Tabs
			value={direction}
			onValueChange={handleDirectionChange}
			className="gap-4"
		>
			{/* 変換方向トグル */}
			<TabsList className="w-full grid grid-cols-2">
				<TabsTrigger value="json-to-csv">JSON → CSV</TabsTrigger>
				<TabsTrigger value="csv-to-json">CSV → JSON</TabsTrigger>
			</TabsList>

			<TabsContent value={direction} className="space-y-4">
				{/* オプション */}
				<ConvertOptionsPanel
					direction={direction}
					jsonOpts={jsonOpts}
					csvOpts={csvOpts}
					withBom={withBom}
					onJsonOptsChange={setJsonOpts}
					onCsvOptsChange={setCsvOpts}
					onWithBomChange={setWithBom}
				/>

				{/* 入力 / 出力 2ペイン（モバイルは縦積み） */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{/* 入力ペイン */}
					<div className="space-y-2">
						<div className="flex items-center justify-between min-h-8">
							<span className="text-sm font-semibold">{inputLabel} 入力</span>
							<Button
								variant="outline"
								size="sm"
								onClick={handleSample}
								className="gap-1.5"
							>
								<Sparkles className="h-3.5 w-3.5" />
								サンプルデータ
							</Button>
						</div>
						<Textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={
								direction === 'json-to-csv'
									? '[{"name":"山田太郎","age":30}] のようなJSON配列を入力'
									: 'name,age\n山田太郎,30 のようなCSVを入力'
							}
							className="min-h-64 font-mono text-sm"
							aria-label={`${inputLabel}入力`}
						/>
						<FileDropzone
							onFileSelect={handleFileSelect}
							onValidationError={(message) =>
								setResult({ ok: false, error: message })
							}
							accept=".json,.csv,.txt"
							maxSizeBytes={MAX_INPUT_FILE_SIZE}
							validationMessage="ファイルサイズは10MB以下にしてください。"
							label="ファイルから読み込み"
							description="JSON / CSV / テキストファイル（.json .csv .txt）"
							inputAriaLabel="変換するファイルを選択"
							data-testid="json-csv-file-input"
						/>
						{isManualMode && (
							<div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
								<Zap className="h-4 w-4 shrink-0 text-amber-500" />
								<span className="text-muted-foreground">
									1MB以上の入力のため自動変換を停止しています。
								</span>
								<Button
									size="sm"
									className="ml-auto shrink-0"
									onClick={convert}
								>
									変換
								</Button>
							</div>
						)}
					</div>

					{/* 出力ペイン */}
					<div className="space-y-2">
						<div className="flex items-center justify-between min-h-8 gap-2">
							<span className="text-sm font-semibold">{outputLabel} 出力</span>
							<div className="flex items-center gap-2">
								{result?.ok && result.output && (
									<>
										<Badge variant="outline" className="text-xs">
											{result.rowCount}行を変換しました
										</Badge>
										<CopyButton text={output} size="sm" />
										<Button
											variant="outline"
											size="sm"
											onClick={handleDownload}
											className="gap-1.5"
										>
											<Download className="h-3.5 w-3.5" />
											ダウンロード
										</Button>
									</>
								)}
							</div>
						</div>
						{result && !result.ok ? (
							<div
								className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive min-h-64"
								role="alert"
								data-testid="json-csv-error"
							>
								<p className="font-medium">変換エラー</p>
								<p className="mt-1">{result.error}</p>
							</div>
						) : (
							<Textarea
								value={output}
								readOnly
								placeholder={`変換結果（${outputLabel}）がここに表示されます`}
								className="min-h-64 font-mono text-sm bg-muted/30"
								aria-label={`${outputLabel}出力`}
							/>
						)}
						{direction === 'json-to-csv' && result?.ok && result.output && (
							<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<FileJson className="h-3.5 w-3.5 shrink-0" />
								ダウンロード時は
								{withBom
									? 'BOM付きUTF-8で保存されます（Excelで文字化けしません）'
									: 'BOMなしUTF-8で保存されます'}
								。
							</p>
						)}
					</div>
				</div>
			</TabsContent>
		</Tabs>
	);
}
