import { Button } from '@/components/ui/button';
import type { SheetData } from '@/lib/tools/xlsx-reader';

interface SheetPickerProps {
	sheets: SheetData[];
	activeSheet: number;
	onSelectSheet: (index: number) => void;
}

export function SheetPicker({
	sheets,
	activeSheet,
	onSelectSheet,
}: SheetPickerProps) {
	if (sheets.length <= 1) return null;

	return (
		<div className="flex items-center gap-2 overflow-x-auto pb-2 border-b mb-4">
			<span className="text-xs font-semibold text-muted-foreground whitespace-nowrap mr-2">
				シート選択:
			</span>
			{sheets.map((sheet, idx) => (
				<Button
					// biome-ignore lint/suspicious/noArrayIndexKey: sheet order is stable
					key={`sheet-${idx}`}
					variant={activeSheet === idx ? 'default' : 'outline'}
					size="sm"
					onClick={() => onSelectSheet(idx)}
					className="h-7 text-xs whitespace-nowrap"
				>
					{sheet.name} ({sheet.rows.length}行)
				</Button>
			))}
		</div>
	);
}
