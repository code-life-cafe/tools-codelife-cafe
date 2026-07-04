import { CheckCircle2 } from 'lucide-react';

interface ScanToastProps {
	message: string | null;
	reducedMotion: boolean;
}

/**
 * 読み取り成功を伝える非モーダルなミニトースト。
 * ファインダー付近に一時表示し、連続スキャンをブロックしない。
 */
export default function ScanToast({ message, reducedMotion }: ScanToastProps) {
	if (!message) return null;

	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
			data-testid="scan-toast"
			data-reduced-motion={reducedMotion ? 'true' : 'false'}
		>
			<div
				role="status"
				aria-live="polite"
				className={`flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg ${
					reducedMotion ? '' : 'animate-in fade-in zoom-in-95 duration-150'
				}`}
			>
				<CheckCircle2 className="h-4 w-4" aria-hidden="true" />
				{message}
			</div>
		</div>
	);
}
