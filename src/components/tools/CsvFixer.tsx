import Encoding from 'encoding-japanese';
import { AlertCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { parsePreview } from '@/lib/csv/preview';
import type { PreviewResult } from '@/lib/csv/types';
import { downloadBlob } from '@/lib/download';
import { convertEncoding } from '@/lib/encoding/convert';
import { detectLineEnding } from '@/lib/encoding/lineEndings';
import type { DetectionResult, EncodingType } from '@/lib/encoding/types';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { loadSettings, saveSettings } from '@/lib/settings/storage';
import type { UserSettings } from '@/lib/settings/types';
import { ConversionOptions } from './csv-fixer/ConversionOptions';
import { CsvPreview } from './csv-fixer/CsvPreview';
import { DownloadButton } from './csv-fixer/DownloadButton';
import { EncodingDetector } from './csv-fixer/EncodingDetector';
import { FileDropZone } from './csv-fixer/FileDropZone';
import { InstantModeToggle } from './csv-fixer/InstantModeToggle';
import {
	type FileLoadedEvent,
	getConversionErrorMessage,
} from './csv-fixer/shared';

export default function CsvFixer() {
	const { trackRun } = useToolAnalytics('csv-fixer');
	const [file, setFile] = useState<File | null>(null);
	const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
	const [detection, setDetection] = useState<DetectionResult | null>(null);
	const [effectiveEncoding, setEffectiveEncoding] =
		useState<EncodingType>('UTF8');
	const [preview, setPreview] = useState<PreviewResult | null>(null);
	const [settings, setSettings] = useState<UserSettings>(loadSettings());
	const [status, setStatus] = useState<
		'idle' | 'detecting' | 'ready' | 'converting' | 'done' | 'error'
	>('idle');
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isPreviewLoading, setIsPreviewLoading] = useState(false);

	const [fileInfo, setFileInfo] = useState<{
		name: string;
		size: number;
		lineEnding: 'CRLF' | 'LF' | 'CR' | 'MIXED' | 'NONE';
		hasBom: boolean;
		lineCount: number;
	} | null>(null);

	const analyzeBuffer = useCallback((buf: ArrayBuffer, enc: EncodingType) => {
		setIsPreviewLoading(true);

		requestAnimationFrame(async () => {
			// 同期解析の前に、処理段階の表示を1フレーム描画する。
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
			try {
				const bytes = new Uint8Array(buf);

				let hasBom = false;
				if (
					bytes.length >= 3 &&
					bytes[0] === 0xef &&
					bytes[1] === 0xbb &&
					bytes[2] === 0xbf
				) {
					hasBom = true;
				} else if (
					bytes.length >= 2 &&
					((bytes[0] === 0xff && bytes[1] === 0xfe) ||
						(bytes[0] === 0xfe && bytes[1] === 0xff))
				) {
					hasBom = true;
				}

				const decodedStringArray = Encoding.convert(bytes, {
					to: 'UNICODE',
					from: enc,
					type: 'array',
				});
				const decodedStr = Encoding.codeToString(decodedStringArray);

				const lineEnding = detectLineEnding(decodedStr);
				const previewResult = parsePreview(decodedStr, 10);

				setPreview(previewResult);
				setFileInfo((prev) =>
					prev
						? {
								...prev,
								lineEnding,
								hasBom,
								lineCount: previewResult.totalRowEstimate,
							}
						: null,
				);
			} catch (e) {
				console.error('Failed to parse preview', e);
				setPreview(null);
			} finally {
				setIsPreviewLoading(false);
			}
		});
	}, []);

	const handleFileLoaded = (event: FileLoadedEvent) => {
		setFile(event.file);
		setBuffer(event.buffer);
		setDetection(event.detection);
		setEffectiveEncoding(event.detection.encoding);
		setStatus('ready');
		setErrorMessage(null);

		setFileInfo({
			name: event.file.name,
			size: event.file.size,
			lineEnding: 'NONE',
			hasBom: false,
			lineCount: 0,
		});

		analyzeBuffer(event.buffer, event.detection.encoding);

		if (
			settings.instantMode &&
			event.detection.encoding &&
			event.detection.confidence !== 'low'
		) {
			setTimeout(() => {
				executeInstantDownload(
					event.buffer,
					event.detection.encoding,
					event.file.name,
				);
			}, 100);
		}
	};

	const handleSettingsChange = (newSettings: UserSettings) => {
		setSettings(newSettings);
		saveSettings(newSettings);
	};

	const handleEncodingOverride = (enc: EncodingType) => {
		setEffectiveEncoding(enc);
		if (buffer) {
			analyzeBuffer(buffer, enc);
		}
	};

	const executeInstantDownload = (
		buf: ArrayBuffer,
		sourceEnc: EncodingType,
		fileName: string,
	) => {
		if (status === 'converting') return;
		setStatus('converting');
		setErrorMessage(null);
		try {
			const { blob, fileName: outName } = convertEncoding(
				buf,
				sourceEnc,
				settings,
				fileName,
			);
			downloadBlob(blob, outName);
			setStatus('done');
			trackRun();
		} catch (e) {
			console.error(e);
			setStatus('error');
			setErrorMessage(getConversionErrorMessage(e));
		}
	};

	const resetState = () => {
		setFile(null);
		setBuffer(null);
		setDetection(null);
		setPreview(null);
		setFileInfo(null);
		setStatus('idle');
		setErrorMessage(null);
	};

	return (
		<div className="w-full max-w-4xl mx-auto space-y-8">
			{!file ? (
				<div className="space-y-6">
					<div className="max-w-md mx-auto">
						<InstantModeToggle
							enabled={settings.instantMode}
							onToggle={(enabled) =>
								handleSettingsChange({ ...settings, instantMode: enabled })
							}
						/>
					</div>
					<FileDropZone
						onFileLoaded={handleFileLoaded}
						disabled={status === 'detecting'}
					/>
				</div>
			) : (
				<div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
					<div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg border">
						<div className="flex items-center space-x-3">
							<div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
								<span className="text-primary text-xl font-bold">1</span>
							</div>
							<div>
								<h3 className="font-semibold leading-none">ファイルの確認</h3>
								<p className="text-xs text-muted-foreground mt-1 text-balance">
									元のエンコーディングとプレビューを確認します。
								</p>
							</div>
						</div>
						<button
							type="button"
							onClick={resetState}
							className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4"
						>
							別のファイルを変換
						</button>
					</div>

					{errorMessage && (
						<div
							role="alert"
							className="flex items-center text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md"
						>
							<AlertCircle className="w-4 h-4 mr-2 shrink-0" />
							<p>{errorMessage}</p>
						</div>
					)}

					{detection && fileInfo && (
						<EncodingDetector
							detection={{ ...detection, encoding: effectiveEncoding }}
							fileInfo={fileInfo}
							onEncodingOverride={handleEncodingOverride}
						/>
					)}

					<CsvPreview preview={preview} isLoading={isPreviewLoading} />

					<div className="bg-muted/30 p-4 rounded-lg border flex items-center space-x-3 mt-8">
						<div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
							<span className="text-primary text-xl font-bold">2</span>
						</div>
						<div>
							<h3 className="font-semibold leading-none">出力とダウンロード</h3>
							<p className="text-xs text-muted-foreground mt-1">
								希望のエンコード形式を選択してダウンロードします。
							</p>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-start">
						<div className="md:col-span-3">
							<ConversionOptions
								settings={settings}
								onSettingsChange={handleSettingsChange}
							/>
						</div>
						<div className="md:col-span-2 flex items-center justify-center h-full min-h-[140px] border rounded-lg bg-card shadow-sm p-4">
							{buffer && (
								<DownloadButton
									buffer={buffer}
									originalFilename={file.name}
									sourceEncoding={effectiveEncoding}
									options={settings}
									disabled={isPreviewLoading || status === 'error'}
									onConverted={trackRun}
									globalStatus={status}
								/>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
