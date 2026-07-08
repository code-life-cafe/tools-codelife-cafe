import { ArrowLeftRight, Calendar } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	type Gengo,
	seirekiToWareki,
	warekiToSeireki,
} from '@/lib/tools/wareki-converter';

type Direction = 'toWareki' | 'toSeireki';

export default function WarekiConverter() {
	const { trackRun } = useToolAnalytics('wareki-converter');
	const currentDate = new Date();

	const [direction, setDirection] = useState<Direction>('toWareki');

	// State for Seireki to Wareki
	const [seirekiYear, setSeirekiYear] = useState<number>(
		currentDate.getFullYear(),
	);
	const [month, setMonth] = useState<number>(currentDate.getMonth() + 1);
	const [day, setDay] = useState<number>(currentDate.getDate());

	// State for Wareki to Seireki
	const [gengo, setGengo] = useState<Gengo>('令和');
	// Just a simple default assumption for current year
	const [warekiYear, setWarekiYear] = useState<number>(
		currentDate.getFullYear() - 2018,
	);

	const result = useMemo(() => {
		if (direction === 'toWareki') {
			return seirekiToWareki(seirekiYear, month, day);
		} else {
			return warekiToSeireki(gengo, warekiYear, month, day);
		}
	}, [direction, seirekiYear, month, day, gengo, warekiYear]);

	const copyText = useMemo(() => {
		if (result.error) return '';
		return `${result.warekiString} / ${result.seirekiYear}年 / ${result.zodiac}年 / ${result.age}歳`;
	}, [result]);

	useEffect(() => {
		if (!result.error) {
			trackRun();
		}
	}, [result, trackRun]);

	return (
		<div className="space-y-6">
			{/* Direction toggle */}
			<div className="flex items-center gap-3">
				<Label className="text-sm font-medium whitespace-nowrap">
					{direction === 'toWareki' ? '西暦 → 和暦' : '和暦 → 西暦'}
				</Label>
				<Switch
					checked={direction === 'toSeireki'}
					onCheckedChange={(checked) =>
						setDirection(checked ? 'toSeireki' : 'toWareki')
					}
				/>
				<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
			</div>

			{/* Inputs */}
			<div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
				{direction === 'toWareki' ? (
					<div className="sm:col-span-4">
						<Label className="text-sm font-medium mb-2 block">西暦（年）</Label>
						<Input
							type="number"
							value={seirekiYear}
							onChange={(e) => setSeirekiYear(Number(e.target.value))}
							className="rounded-xl focus:ring-2 focus:ring-primary"
							min={1868}
							max={2100}
						/>
					</div>
				) : (
					<>
						<div className="sm:col-span-3">
							<Label className="text-sm font-medium mb-2 block">元号</Label>
							<Select value={gengo} onValueChange={(v) => setGengo(v as Gengo)}>
								<SelectTrigger className="rounded-xl">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="令和">令和</SelectItem>
									<SelectItem value="平成">平成</SelectItem>
									<SelectItem value="昭和">昭和</SelectItem>
									<SelectItem value="大正">大正</SelectItem>
									<SelectItem value="明治">明治</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="sm:col-span-3">
							<Label className="text-sm font-medium mb-2 block">
								年 (元年 = 1)
							</Label>
							<Input
								type="number"
								value={warekiYear}
								onChange={(e) => setWarekiYear(Number(e.target.value))}
								className="rounded-xl focus:ring-2 focus:ring-primary"
								min={1}
								max={100}
							/>
						</div>
					</>
				)}

				<div
					className={`sm:col-span-4 ${direction === 'toSeireki' ? 'sm:col-span-3' : ''}`}
				>
					<Label className="text-sm font-medium mb-2 block">月</Label>
					<Select
						value={String(month)}
						onValueChange={(v) => setMonth(Number(v))}
					>
						<SelectTrigger className="rounded-xl">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
								<SelectItem key={m} value={String(m)}>
									{m}月
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div
					className={`sm:col-span-4 ${direction === 'toSeireki' ? 'sm:col-span-3' : ''}`}
				>
					<Label className="text-sm font-medium mb-2 block">日</Label>
					<Select value={String(day)} onValueChange={(v) => setDay(Number(v))}>
						<SelectTrigger className="rounded-xl">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
								<SelectItem key={d} value={String(d)}>
									{d}日
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* Result Card */}
			<Card className="rounded-xl overflow-hidden border-2">
				<div className="bg-muted/50 p-4 border-b flex justify-between items-center">
					<div className="flex items-center gap-2 text-foreground font-medium">
						<Calendar className="h-4 w-4 text-primary" />
						<span>変換結果</span>
					</div>
					{copyText && <CopyButton text={copyText} />}
				</div>
				<CardContent className="p-6 sm:p-8">
					{result.error ? (
						<div className="text-center text-red-500 py-4 font-medium">
							{result.error}
						</div>
					) : (
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
							<div>
								<div className="text-sm text-muted-foreground mb-1">和暦</div>
								<div className="text-xl sm:text-2xl font-bold text-foreground">
									{result.warekiString}
								</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground mb-1">西暦</div>
								<div className="text-xl sm:text-2xl font-bold text-foreground">
									{result.seirekiYear}年
								</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground mb-1">干支</div>
								<div className="text-xl sm:text-2xl font-bold text-foreground">
									{result.zodiac}年
								</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground mb-1">年齢</div>
								<div className="text-xl sm:text-2xl font-bold text-foreground">
									{result.age}歳
								</div>
							</div>
						</div>
					)}
					{!result.error && (
						<div className="mt-8 text-center sm:text-right text-xs text-muted-foreground">
							※年齢は今年の誕生日を迎えた時点での年齢です。
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
