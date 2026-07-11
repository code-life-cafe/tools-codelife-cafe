import CopyButton from '@/components/common/CopyButton';
import { Textarea } from '@/components/ui/textarea';

interface OutputPanelProps {
	value: string;
}

export function OutputPanel({ value }: OutputPanelProps) {
	return (
		<div className="relative flex flex-col h-full min-h-[200px]">
			<Textarea
				resize="vertical"
				className="flex-1 font-mono p-4 text-base bg-muted/50 transition-opacity duration-200"
				style={{ opacity: value ? 1 : 0.7 }}
				readOnly
				placeholder="変換結果がここに表示されます"
				value={value}
			/>

			{value && (
				<div className="absolute top-2 right-2">
					<CopyButton text={value} />
				</div>
			)}
		</div>
	);
}
