import { Check, Copy, X } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useCopyFeedback } from '@/lib/hooks/useCopyFeedback';

interface CopyButtonProps {
	text: string;
	label?: string;
	variant?: 'default' | 'outline' | 'ghost' | 'secondary';
	size?: 'default' | 'sm' | 'lg' | 'icon';
	className?: string;
	disabled?: boolean;
}

export default function CopyButton({
	text,
	label = 'コピー',
	variant = 'outline',
	size = 'sm',
	className = '',
	disabled = false,
}: CopyButtonProps) {
	const { state, copy } = useCopyFeedback();
	const copied = state === 'copied';
	const failed = state === 'failed';

	const handleCopy = useCallback(() => {
		void copy(text);
	}, [copy, text]);

	return (
		<Button
			variant={variant}
			size={size}
			onClick={handleCopy}
			disabled={disabled}
			className={`transition-all ${copied ? 'copy-flash text-safety border-safety/50' : ''} ${failed ? 'text-destructive border-destructive/50' : ''} ${className}`}
			aria-label={
				failed ? 'コピーに失敗しました' : copied ? 'コピーしました' : label
			}
		>
			{failed ? (
				<>
					<X className="h-4 w-4" />
					<span className="ml-1">コピー失敗</span>
				</>
			) : copied ? (
				<>
					<Check className="h-4 w-4" />
					<span className="ml-1">コピー済み</span>
				</>
			) : (
				<>
					<Copy className="h-4 w-4" />
					<span className="ml-1">{label}</span>
				</>
			)}
		</Button>
	);
}
