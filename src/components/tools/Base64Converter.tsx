import { ArrowLeftRight, Download, Trash2, UploadCloud } from 'lucide-react';
import {
	type DragEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	decodeBase64,
	encodeBase64,
	fileToBase64,
	getBase64ByteSize,
	getByteSize,
} from '@/lib/tools/base64';

export default function Base64Converter() {
	const { trackRun } = useToolAnalytics('base64');
	const [tab, setTab] = useState('text');

	// Text Tab State
	const [textInput, setTextInput] = useState('');
	const [direction, setDirection] = useState<'encode' | 'decode'>('encode');

	// File Tab State
	const [fileOutput, setFileOutput] = useState('');
	const [withDataUri, setWithDataUri] = useState(true);
	const [dragOver, setDragOver] = useState(false);
	const [fileName, setFileName] = useState('');
	const [loading, setLoading] = useState(false);

	// Computed Text Result
	const textResult = useMemo(() => {
		if (!textInput.trim()) return { output: '', error: null, size: 0 };
		try {
			if (direction === 'encode') {
				const out = encodeBase64(textInput);
				return { output: out, error: null, size: getByteSize(textInput) };
			} else {
				const out = decodeBase64(textInput);
				return { output: out, error: null, size: getBase64ByteSize(textInput) };
			}
		} catch (err: unknown) {
			return {
				output: '',
				error: err instanceof Error ? err.message : String(err),
				size: 0,
			};
		}
	}, [textInput, direction]);

	// エンコード/デコードが成功して変換結果が得られた時点で実行を計測（空入力・エラー時は発火しない）
	useEffect(() => {
		if (textResult.output && !textResult.error) {
			trackRun();
		}
	}, [textResult, trackRun]);

	// Handlers for File Drop
	const handleDrop = useCallback(
		async (e: DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			setDragOver(false);
			const file = e.dataTransfer.files[0];
			if (file) {
				setLoading(true);
				try {
					setFileName(file.name);
					const b64 = await fileToBase64(file, withDataUri);
					setFileOutput(b64);
					// ファイルのBase64変換が完了した時点で実行を計測
					trackRun();
				} catch (_err) {
					alert('ファイルの読み込みに失敗しました。');
				} finally {
					setLoading(false);
				}
			}
		},
		[withDataUri, trackRun],
	);

	// Download decoded text
	const downloadDecodedText = useCallback(() => {
		if (direction === 'decode' && !textResult.error && textResult.output) {
			const blob = new Blob([textResult.output], {
				type: 'text/plain;charset=utf-8',
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'decoded.txt';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}
	}, [direction, textResult]);

	return (
		<div className="space-y-6">
			<Tabs value={tab} onValueChange={setTab}>
				<div className="flex justify-center sm:justify-start">
					<TabsList className="mb-4 bg-muted/50 p-1 rounded-xl">
						<TabsTrigger
							value="text"
							className="rounded-lg px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all font-medium"
						>
							テキスト変換
						</TabsTrigger>
						<TabsTrigger
							value="file"
							className="rounded-lg px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all font-medium"
						>
							ファイル変換
						</TabsTrigger>
					</TabsList>
				</div>

				{/* Text Tab */}
				<TabsContent value="text" className="space-y-6 mt-0">
					<div className="flex items-center gap-3 mb-4">
						<Label className="text-sm font-medium whitespace-nowrap">
							{direction === 'encode'
								? 'テキスト → Base64'
								: 'Base64 → テキスト'}
						</Label>
						<Switch
							checked={direction === 'decode'}
							onCheckedChange={(checked) =>
								setDirection(checked ? 'decode' : 'encode')
							}
						/>
						<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<div className="flex justify-between items-center mb-2 min-h-9">
								<Label className="text-sm font-medium block">
									入力 ({direction === 'encode' ? 'プレーンテキスト' : 'Base64'}
									)
								</Label>
								{textResult.size > 0 && (
									<span className="text-xs text-muted-foreground">
										元のサイズ: 約 {textResult.size} bytes
									</span>
								)}
							</div>
							<Textarea
								value={textInput}
								onChange={(e) => setTextInput(e.target.value)}
								placeholder={
									direction === 'encode'
										? 'こんにちは世界'
										: '44GT44KT44Gr44Gh44Gv5LiW55WM'
								}
								className="min-h-[240px] font-mono-tool rounded-xl focus:ring-2 focus:ring-primary"
							/>
						</div>

						<div>
							<div className="flex items-center justify-between mb-2 min-h-9">
								<Label className="text-sm font-medium">変換結果</Label>
								<div className="flex gap-2">
									{direction === 'decode' &&
										textResult.output &&
										!textResult.error && (
											<Button
												variant="outline"
												size="sm"
												onClick={downloadDecodedText}
											>
												<Download className="h-4 w-4 mr-1" />
												DL
											</Button>
										)}
									<CopyButton text={textResult.output} />
									<Button
										variant="outline"
										size="sm"
										onClick={() => setTextInput('')}
										disabled={!textInput}
									>
										<Trash2 className="h-4 w-4 mr-1" />
										クリア
									</Button>
								</div>
							</div>
							<Textarea
								value={textResult.error ? textResult.error : textResult.output}
								readOnly
								className={`min-h-[240px] font-mono-tool rounded-xl bg-muted/50 ${
									textResult.error
										? 'text-red-500 font-bold border-red-200 bg-red-50 dark:bg-red-950/20'
										: ''
								} ${textResult.output ? 'shimmer' : ''}`}
							/>
						</div>
					</div>
				</TabsContent>

				{/* File Tab */}
				<TabsContent value="file" className="space-y-6 mt-0">
					<div className="flex items-center gap-2 mb-4">
						<Checkbox
							id="data-uri"
							checked={withDataUri}
							onCheckedChange={(checked) => setWithDataUri(checked === true)}
						/>
						<Label htmlFor="data-uri" className="text-sm cursor-pointer">
							Data URI 形式を出力する (data:image/png;base64,... など)
						</Label>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<div className="flex items-center mb-2 min-h-9">
								<Label className="text-sm font-medium block">
									ファイル入力
								</Label>
							</div>
							{/* biome-ignore lint/a11y/noStaticElementInteractions: file drop zone */}
							<div
								onDrop={handleDrop}
								onDragOver={(e) => {
									e.preventDefault();
									setDragOver(true);
								}}
								onDragLeave={() => setDragOver(false)}
								className={`flex flex-col items-center justify-center min-h-[240px] rounded-xl border-2 border-dashed transition-colors ${
									dragOver
										? 'border-primary bg-primary/5'
										: 'border-border bg-card hover:bg-muted/50'
								}`}
							>
								{loading ? (
									<div className="text-muted-foreground animate-pulse p-6">
										読み込み中...
									</div>
								) : fileName ? (
									<div className="flex flex-col items-center p-4">
										{fileOutput?.startsWith('data:image/') && (
											<img
												src={fileOutput}
												alt={fileName}
												className="max-h-32 max-w-full rounded-md object-contain mb-3 shadow-sm border border-border"
											/>
										)}
										<div className="font-medium text-primary mb-1 text-center break-all line-clamp-2 px-2">
											{fileName}
										</div>
										<div className="text-xs text-muted-foreground mt-2 text-center">
											別のファイルをドロップして上書き
										</div>
									</div>
								) : (
									<div className="text-center p-6 text-muted-foreground">
										<UploadCloud className="h-10 w-10 mx-auto mb-3 opacity-50" />
										<p className="text-sm mb-1">ファイルをここにドロップ</p>
										<p className="text-xs opacity-70">
											またはクリックして選択（※ブラウザで完結）
										</p>
									</div>
								)}
								<input
									type="file"
									className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
									onChange={async (e) => {
										const file = e.target.files?.[0];
										if (file) {
											setLoading(true);
											try {
												setFileName(file.name);
												const b64 = await fileToBase64(file, withDataUri);
												setFileOutput(b64);
												// ファイルのBase64変換が完了した時点で実行を計測
												trackRun();
											} catch (_err) {
												alert('エラーが発生しました。');
											} finally {
												setLoading(false);
											}
										}
									}}
									title="クリックしてファイルを選択"
								/>
							</div>
						</div>

						<div>
							<div className="flex items-center justify-between mb-2 min-h-9">
								<Label className="text-sm font-medium">Base64 出力</Label>
								<div className="flex gap-2">
									<CopyButton text={fileOutput} />
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setFileOutput('');
											setFileName('');
										}}
										disabled={!fileOutput}
									>
										<Trash2 className="h-4 w-4 mr-1" />
										クリア
									</Button>
								</div>
							</div>
							<Textarea
								value={fileOutput}
								readOnly
								placeholder="ファイルを選択するとBase64文字列が表示されます..."
								className={`min-h-[240px] font-mono-tool rounded-xl bg-muted/50 ${fileOutput ? 'shimmer' : ''}`}
							/>
						</div>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
