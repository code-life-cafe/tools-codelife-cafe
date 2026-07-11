import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CipherAlgorithm } from '@/lib/cipher';

interface InputPanelProps {
	algorithm: CipherAlgorithm;
	value: string;
	onChange: (value: string) => void;
	onClear: () => void;
}

const placeholders: Record<CipherAlgorithm, string> = {
	caesar: '「こんにちは」や「Hello World」を入力...',
	rot13: '「Hello World」を入力...',
	reverse: '「テキストを反転します」を入力...',
	morse: '「SOS」や「Hello」を入力...（復号する場合は「... --- ...」）',
};

export function InputPanel({
	algorithm,
	value,
	onChange,
	onClear,
}: InputPanelProps) {
	return (
		<div className="relative flex flex-col h-full min-h-[200px]">
			<Textarea
				resize="vertical"
				className="flex-1 font-mono p-4 text-base"
				placeholder={placeholders[algorithm]}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>

			{value && (
				<Button
					variant="ghost"
					size="icon"
					className="absolute top-2 right-2 h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={onClear}
					title="クリア"
				>
					<X className="h-4 w-4" />
				</Button>
			)}

			<div className="absolute bottom-2 right-4 text-xs text-muted-foreground">
				{value.length} 文字
			</div>
		</div>
	);
}
