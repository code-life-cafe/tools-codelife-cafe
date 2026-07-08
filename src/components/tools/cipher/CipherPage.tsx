import { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
	type CipherAlgorithm,
	type CipherDirection,
	caesarCipher,
	getMaxShift,
	morseDecode,
	morseEncode,
	reverseString,
	rot13,
} from '@/lib/cipher';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { AlgorithmInfo } from './AlgorithmInfo';
import { BruteForcePanel } from './BruteForcePanel';
import { DirectionToggle } from './DirectionToggle';
import { InputPanel } from './InputPanel';
import { OutputPanel } from './OutputPanel';
import { ShiftSlider } from './ShiftSlider';

export function CipherPage() {
	const { trackRun } = useToolAnalytics('cipher');
	const [activeTab, setActiveTab] = useState<CipherAlgorithm>('caesar');
	const [input, setInput] = useState('');

	// Caesar specific state
	const [caesarShift, setCaesarShift] = useState(3);
	const [caesarDirection, setCaesarDirection] =
		useState<CipherDirection>('encode');

	// Morse specific state
	const [morseDirection, setMorseDirection] =
		useState<CipherDirection>('encode');

	const handleTabChange = (value: string) => {
		setActiveTab(value as CipherAlgorithm);
		setInput('');
		// Options are not reset per the prompt to keep things simple, or we can reset them:
		setCaesarShift(3);
		setCaesarDirection('encode');
		setMorseDirection('encode');
	};

	const output = useMemo(() => {
		if (!input) return '';

		try {
			switch (activeTab) {
				case 'caesar':
					return caesarCipher(input, {
						shift: caesarShift,
						direction: caesarDirection,
					}).output;
				case 'rot13':
					return rot13(input).output;
				case 'reverse':
					return reverseString(input).output;
				case 'morse':
					return morseDirection === 'encode'
						? morseEncode(input).output
						: morseDecode(input).output;
				default:
					return '';
			}
		} catch (err) {
			console.error(err);
			return 'エラーが発生しました';
		}
	}, [input, activeTab, caesarShift, caesarDirection, morseDirection]);

	useEffect(() => {
		if (input.trim() && output && output !== 'エラーが発生しました') {
			trackRun();
		}
	}, [input, output, trackRun]);

	return (
		<div className="space-y-6">
			<Tabs
				defaultValue="caesar"
				value={activeTab}
				onValueChange={handleTabChange}
				className="w-full"
			>
				<div className="overflow-x-auto pb-2">
					<TabsList className="w-full justify-start md:w-auto h-12">
						<TabsTrigger value="caesar" className="text-base px-6 py-2">
							シーザー暗号
						</TabsTrigger>
						<TabsTrigger value="rot13" className="text-base px-6 py-2">
							ROT13
						</TabsTrigger>
						<TabsTrigger value="reverse" className="text-base px-6 py-2">
							文字列反転
						</TabsTrigger>
						<TabsTrigger value="morse" className="text-base px-6 py-2">
							モールス信号
						</TabsTrigger>
					</TabsList>
				</div>

				{activeTab === 'caesar' && (
					<div className="my-4 p-4 border rounded-md">
						<div className="flex flex-col md:flex-row md:items-center gap-6 justify-between">
							<DirectionToggle
								direction={caesarDirection}
								onChange={setCaesarDirection}
							/>
							<div className="flex-1 max-w-sm">
								<ShiftSlider
									shift={caesarShift}
									maxShift={getMaxShift(input)}
									onChange={setCaesarShift}
								/>
							</div>
						</div>
					</div>
				)}

				{/* We'll also need a direction toggle for Morse */}
				{activeTab === 'morse' && (
					<div className="my-4">
						<div className="flex bg-muted p-1 rounded-md w-fit">
							<button
								type="button"
								className={`px-4 py-1.5 rounded-sm text-sm font-medium transition-colors ${morseDirection === 'encode' ? 'bg-background shadow-sm' : 'hover:bg-muted-foreground/10'}`}
								onClick={() => setMorseDirection('encode')}
							>
								エンコード（暗号化）
							</button>
							<button
								type="button"
								className={`px-4 py-1.5 rounded-sm text-sm font-medium transition-colors ${morseDirection === 'decode' ? 'bg-background shadow-sm' : 'hover:bg-muted-foreground/10'}`}
								onClick={() => setMorseDirection('decode')}
							>
								デコード（復号）
							</button>
						</div>
					</div>
				)}

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
					<InputPanel
						algorithm={activeTab}
						value={input}
						onChange={setInput}
						onClear={() => setInput('')}
					/>
					<OutputPanel value={output} />
				</div>

				{activeTab === 'caesar' && (
					<div className="mt-4">
						<BruteForcePanel
							input={input}
							currentShift={caesarShift}
							onSelectShift={setCaesarShift}
						/>
					</div>
				)}
			</Tabs>

			<AlgorithmInfo algorithm={activeTab} />
		</div>
	);
}
