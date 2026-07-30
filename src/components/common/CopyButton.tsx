import { Check, Copy, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';

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
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);

	const handleCopy = useCallback(async () => {
		const ok = await copyText(text);
		if (ok) {
			setFailed(false);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} else {
			setCopied(false);
			setFailed(true);
			setTimeout(() => setFailed(false), 2000);
		}
	}, [text]);

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
