import { ChevronDown, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { caesarBruteForce } from '@/lib/cipher';

interface BruteForcePanelProps {
	input: string;
	currentShift: number;
	onSelectShift: (shift: number) => void;
}

export function BruteForcePanel({
	input,
	currentShift,
	onSelectShift,
}: BruteForcePanelProps) {
	const [isOpen, setIsOpen] = useState(false);

	const patterns = useMemo(() => {
		if (!input) return [];
		return caesarBruteForce(input);
	}, [input]);

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="w-full rounded-md border bg-card p-4 shadow-sm"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Unlock className="h-5 w-5 text-primary" />
					<h3 className="font-medium">ブルートフォース（全パターン表示）</h3>
				</div>
				<CollapsibleTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						className="h-auto whitespace-normal text-left"
					>
						鍵がわからないとき：全候補を見る
						<ChevronDown
							className={`h-4 w-4 transition-transform duration-200 ${
								isOpen ? 'rotate-180' : ''
							}`}
						/>
					</Button>
				</CollapsibleTrigger>
			</div>

			<CollapsibleContent className="mt-4 animate-in slide-in-from-top-2 fade-in-0">
				<p className="text-sm text-muted-foreground mb-3">
					シーザー暗号の復号候補をシフト順に表示します。対応するかなを含む入力は45候補、それ以外は25候補です。読める候補を選ぶと、シフト数と方向が「デコード（復号）」になり、結果欄に反映されます。方式の自動判別や正解の判定は行いません。
				</p>
				{!input ? (
					<p className="text-sm text-muted-foreground py-4 text-center">
						テキストを入力すると全パターンが表示されます
					</p>
				) : (
					<div className="max-h-[400px] overflow-y-auto space-y-1 pr-2 mt-2">
						{patterns.map(({ shift, output }) => {
							const _output =
								output.length > 100 ? `${output.slice(0, 100)}...` : output;
							const isSelected = shift === currentShift;

							return (
								<button
									key={shift}
									type="button"
									onClick={() => onSelectShift(shift)}
									className={`w-full text-left px-3 py-2 rounded-sm text-sm font-mono transition-colors border border-transparent flex gap-4 ${
										isSelected
											? 'bg-primary/10 border-primary/20 text-primary font-medium'
											: 'hover:bg-muted'
									}`}
								>
									<span className="shrink-0 w-16 text-muted-foreground">
										シフト {shift}:
									</span>
									<span className="truncate">{_output}</span>
								</button>
							);
						})}
					</div>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
