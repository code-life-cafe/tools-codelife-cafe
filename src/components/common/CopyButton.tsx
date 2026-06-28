import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';

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

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}, [text]);

	return (
		<Button
			variant={variant}
			size={size}
			onClick={handleCopy}
			disabled={disabled}
			className={`transition-all ${copied ? 'copy-flash text-safety border-safety/50' : ''} ${className}`}
			aria-label={copied ? 'コピーしました' : label}
		>
			{copied ? (
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
