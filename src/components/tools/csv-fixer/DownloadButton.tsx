import { AlertCircle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/download';
import { convertEncoding } from '@/lib/encoding/convert';
import type {
	ConversionOptions as EncodingConversionOptions,
	EncodingType,
} from '@/lib/encoding/types';
import { cn } from '@/lib/utils';
import { getConversionErrorMessage } from './shared';

interface DownloadButtonProps {
	buffer: ArrayBuffer;
	originalFilename: string;
	sourceEncoding: EncodingType;
	options: EncodingConversionOptions;
	disabled: boolean;
	onConverted?: () => void;
	globalStatus?:
		| 'idle'
		| 'detecting'
		| 'ready'
		| 'converting'
		| 'done'
		| 'error';
}

export function DownloadButton({
	buffer,
	originalFilename,
	sourceEncoding,
	options,
	disabled,
	onConverted,
	globalStatus,
}: DownloadButtonProps) {
	const [status, setStatus] = useState<
		'idle' | 'converting' | 'success' | 'error'
	>('idle');
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useEffect(() => {
		setStatus('idle');
		setErrorMessage(null);
	}, []);

	const handleDownload = async () => {
		if (disabled || status === 'converting') return;

		setStatus('converting');
		setErrorMessage(null);

		try {
			await new Promise((res) =>
				requestAnimationFrame(() => requestAnimationFrame(res)),
			);

			const { blob, fileName } = convertEncoding(
				buffer,
				sourceEncoding,
				options,
				originalFilename,
			);

			downloadBlob(blob, fileName);

			setStatus('success');
			onConverted?.();

			setTimeout(() => {
				setStatus((prev) => (prev === 'success' ? 'idle' : prev));
			}, 3000);
		} catch (e: unknown) {
			console.error('Conversion error:', e);
			setStatus('error');
			setErrorMessage(getConversionErrorMessage(e));
		}
	};

	return (
		<div className="w-full flex flex-col items-center">
			<Button
				onClick={handleDownload}
				disabled={disabled || status === 'converting'}
				size="lg"
				className={cn(
					'w-full max-w-sm h-14 text-base font-semibold shadow-md transition-all',
					status === 'success' && 'bg-green-600 hover:bg-green-700 text-white',
				)}
			>
				{status === 'converting' || globalStatus === 'converting' ? (
					<>
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						変換中...
					</>
				) : status === 'success' || globalStatus === 'done' ? (
					<>
						<CheckCircle2 className="mr-2 h-5 w-5 animate-in zoom-in" />
						ダウンロード完了
					</>
				) : (
					<>
						<Download className="mr-2 h-5 w-5" />
						変換してダウンロード
					</>
				)}
			</Button>

			{status === 'error' && errorMessage && (
				<div className="mt-3 text-sm text-destructive flex items-center bg-destructive/10 px-3 py-2 rounded-md">
					<AlertCircle className="w-4 h-4 mr-2 shrink-0" />
					<p>{errorMessage}</p>
				</div>
			)}
		</div>
	);
}
