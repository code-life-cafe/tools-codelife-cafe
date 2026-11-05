import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface ShiftSliderProps {
	shift: number;
	maxShift: number;
	onChange: (shift: number) => void;
}

export function ShiftSlider({ shift, maxShift, onChange }: ShiftSliderProps) {
	const shiftLabelId = useId();
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		let value = parseInt(e.target.value, 10);
		if (Number.isNaN(value)) return;

		// Clamp between 1 and maxShift
		if (value < 1) value = 1;
		if (value > maxShift) value = maxShift;

		onChange(value);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between">
				<Label
					id={shiftLabelId}
					htmlFor="shift-input"
					className="font-medium whitespace-nowrap mr-4"
				>
					シフト数:
				</Label>
				<Input
					id="shift-input"
					type="number"
					min={1}
					max={maxShift}
					value={shift}
					onChange={handleInputChange}
					className="w-16 h-8 text-center font-mono"
				/>
			</div>
			<Slider
				aria-labelledby={shiftLabelId}
				min={1}
				max={maxShift}
				step={1}
				value={[shift]}
				onValueChange={(val) => onChange(val[0])}
				className="py-1"
			/>
			<div className="flex justify-between text-xs text-muted-foreground">
				<span>1</span>
				<span>{maxShift}</span>
			</div>
		</div>
	);
}
