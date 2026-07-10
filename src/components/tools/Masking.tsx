import { Download, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	type MaskChar,
	type MaskStrength,
	type MaskTarget,
	maskText,
} from '@/lib/tools/masking';

const TARGET_TYPES: { id: MaskTarget; label: string }[] = [
	{ id: 'email', label: 'メールアドレス' },
	{ id: 'phone', label: '電話番号' },
	{ id: 'zipcode', label: '郵便番号' },
	{ id: 'card', label: 'カード番号' },
	{ id: 'mynumber', label: 'マイナンバー' },
	{ id: 'name', label: '氏名 (簡易)' },
];

export default function Masking() {
	const { trackRun } = useToolAnalytics('masking');
	const [text, setText] = useState('');
	const [targets, setTargets] = useState<Set<MaskTarget>>(
		new Set(['email', 'phone', 'zipcode', 'card', 'mynumber']),
	);
	const [maskChar, setMaskChar] = useState<MaskChar>('*');
	const [strength, setStrength] = useState<MaskStrength>('partial');

	const { maskedText, counts, ranges } = useMemo(() => {
		if (!text)
			return {
				maskedText: '',
				counts: {
					email: 0,
					phone: 0,
					zipcode: 0,
					card: 0,
					mynumber: 0,
					name: 0,
				},
				ranges: [],
			};
		return maskText(text, { targets, maskChar, strength });
	}, [text, targets, maskChar, strength]);

	const totalMasked = Object.values(counts).reduce((a, b) => a + b, 0);

	useEffect(() => {
		if (text.trim() && maskedText) {
			trackRun();
		}
	}, [text, maskedText, trackRun]);

	const toggleTarget = (id: MaskTarget) => {
		setTargets((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const handleDownload = () => {
		if (!maskedText) return;
		const blob = new Blob([maskedText], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'masked-text.txt';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
		const overlay = document.getElementById('mask-highlight-overlay');
		if (overlay) {
			overlay.scrollTop = e.currentTarget.scrollTop;
			overlay.scrollLeft = e.currentTarget.scrollLeft;
		}
	};

	const highlightNodes = useMemo(() => {
		if (!text || ranges.length === 0) return <span>{text}</span>;

		const nodes = [];
		let lastIndex = 0;
		// Sort ranges just in case
		const sorted = [...ranges].sort((a, b) => a.start - b.start);

		for (let i = 0; i < sorted.length; i++) {
			const range = sorted[i];
			if (range.start > lastIndex) {
				nodes.push(
					<span key={`t-${i}`}>{text.slice(lastIndex, range.start)}</span>,
				);
			}
			nodes.push(
				<mark
					key={`m-${i}`}
					className="bg-primary/30 dark:bg-primary/50 text-transparent rounded-[2px]"
					title={range.type}
				>
					{text.slice(range.start, range.end)}
				</mark>,
			);
			lastIndex = Math.max(lastIndex, range.end);
		}

		if (lastIndex < text.length) {
			nodes.push(<span key="end">{text.slice(lastIndex)}</span>);
		}

		return nodes;
	}, [text, ranges]);

	return (
		<div className="space-y-6">
			{/* Options */}
			<div className="bg-muted/30 p-4 rounded-xl border space-y-4">
				<div className="flex flex-wrap items-center gap-6">
					<div>
						<Label className="text-xs mb-1 block text-muted-foreground">
							マスク文字
						</Label>
						<Select
							value={maskChar}
							onValueChange={(v) => setMaskChar(v as MaskChar)}
						>
							<SelectTrigger className="w-[100px] h-8 rounded-lg bg-background">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="*">*(アスタリスク)</SelectItem>
								<SelectItem value="●">●(黒丸)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div>
						<Label className="text-xs mb-1 block text-muted-foreground">
							強度
						</Label>
						<Select
							value={strength}
							onValueChange={(v) => setStrength(v as MaskStrength)}
						>
							<SelectTrigger className="w-[140px] h-8 rounded-lg bg-background">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="partial">部分マスク (一部残す)</SelectItem>
								<SelectItem value="full">完全マスク</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>

				<div>
					<Label className="text-xs mb-2 block text-muted-foreground">
						自動検出対象
					</Label>
					<div className="flex flex-wrap gap-3">
						{TARGET_TYPES.map((t) => (
							<div key={t.id} className="flex items-center gap-1.5">
								<Checkbox
									id={`target-${t.id}`}
									checked={targets.has(t.id)}
									onCheckedChange={() => toggleTarget(t.id)}
								/>
								<Label
									htmlFor={`target-${t.id}`}
									className="text-sm cursor-pointer whitespace-nowrap"
								>
									{t.label}{' '}
									<Badge
										variant="secondary"
										className="ml-1 px-1 h-4 text-[10px]"
									>
										{counts[t.id]}
									</Badge>
								</Label>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
				{/* Input */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium">元のテキスト</Label>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setText('')}
							disabled={!text}
							className="h-8 text-muted-foreground hover:text-foreground"
						>
							<Trash2 className="h-4 w-4 mr-1" /> クリア
						</Button>
					</div>
					<div className="relative rounded-xl border border-input shadow-sm focus-within:ring-2 focus-within:ring-primary bg-background overflow-hidden flex">
						<div
							id="mask-highlight-overlay"
							className="absolute inset-0 pointer-events-none p-3 text-sm leading-5 whitespace-pre-wrap break-words font-mono-tool overflow-hidden"
							aria-hidden={true}
						>
							{highlightNodes}
						</div>
						<Textarea
							id="masking-input-textarea"
							value={text}
							onChange={(e) => setText(e.target.value)}
							onScroll={handleScroll}
							placeholder="山田太郎 (yamada@example.com) 090-1234-5678"
							resize="vertical"
							className="flex-1 min-h-[240px] max-h-[80dvh] bg-transparent text-foreground font-mono-tool text-sm leading-5 p-3 border-none ring-0 shadow-none focus-visible:ring-0 rounded-none relative z-10"
							spellCheck={false}
						/>
					</div>
				</div>

				{/* Output */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium flex items-center gap-2">
							マスキング後
							{totalMasked > 0 && (
								<span className="text-xs text-green-600 font-normal">
									({totalMasked}箇所マスク済)
								</span>
							)}
						</Label>
						<div className="flex items-center gap-2">
							{maskedText && (
								<Button
									variant="outline"
									size="sm"
									onClick={handleDownload}
									className="h-8"
								>
									<Download className="h-4 w-4 mr-1" /> 保存
								</Button>
							)}
							<CopyButton text={maskedText} />
						</div>
					</div>
					<Textarea
						id="masking-output-textarea"
						value={maskedText}
						readOnly
						resize="vertical"
						className={`min-h-[240px] max-h-[80dvh] font-mono-tool text-sm leading-5 rounded-xl bg-card border shadow-sm ${
							maskedText ? 'shimmer' : ''
						}`}
						spellCheck={false}
					/>
				</div>
			</div>
		</div>
	);
}
