import {
	AlertTriangle,
	Download,
	GripVertical,
	ListPlus,
	Loader2,
	RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	type ExportFormat,
	type FieldType,
	generateDummyData,
	validateDummyDataInput,
} from '@/lib/tools/dummy-data';

const PRESETS: Record<string, FieldType[]> = {
	顧客リスト: ['name', 'kana', 'email', 'phone', 'zipcode', 'address'],
	社員名簿: ['name', 'kana', 'department', 'email', 'phone'],
	注文データ: ['date', 'name', 'number', 'address'],
};

interface FieldItem {
	id: FieldType;
	label: string;
}

const ALL_FIELDS: FieldItem[] = [
	{ id: 'name', label: '氏名' },
	{ id: 'kana', label: 'フリガナ' },
	{ id: 'email', label: 'メールアドレス' },
	{ id: 'phone', label: '電話番号' },
	{ id: 'zipcode', label: '郵便番号' },
	{ id: 'address', label: '住所' },
	{ id: 'company', label: '会社名' },
	{ id: 'department', label: '部署名' },
	{ id: 'date', label: '日付' },
	{ id: 'number', label: '数値' },
];

export default function DummyDataGenerator() {
	const { trackRun } = useToolAnalytics('dummy-data');
	const [fields, setFields] = useState<FieldItem[]>(ALL_FIELDS);
	const [selectedFields, setSelectedFields] = useState<Set<FieldType>>(
		new Set(['name', 'kana', 'email', 'phone']),
	);
	const [count, setCount] = useState<number>(10);
	const [format, setFormat] = useState<ExportFormat>('json');

	const [refreshKey, setRefreshKey] = useState(0);

	const activeFields = useMemo(() => {
		return fields.filter((f) => selectedFields.has(f.id)).map((f) => f.id);
	}, [fields, selectedFields]);

	const validationError = useMemo(() => {
		return validateDummyDataInput(count, activeFields);
	}, [count, activeFields]);

	const [outputData, setOutputData] = useState('');
	const [isGenerating, setIsGenerating] = useState(false);

	useEffect(() => {
		void refreshKey;
		if (validationError) {
			setOutputData('');
			return;
		}

		setIsGenerating(true);
		const timer = setTimeout(() => {
			try {
				setOutputData(generateDummyData(activeFields, count, format));
				trackRun();
			} catch (_e) {
				setOutputData('');
			}
			setIsGenerating(false);
		}, 50);
		return () => clearTimeout(timer);
	}, [activeFields, count, format, refreshKey, validationError, trackRun]);

	const previewData = useMemo(() => {
		if (!outputData) return [];
		if (format === 'json') {
			try {
				const parsed = JSON.parse(outputData);
				return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
			} catch {
				return [];
			}
		}
		const lines = outputData.split('\n');
		const head = lines[0];
		const rows = lines.slice(1, 21);
		return [{ __previewText: `${head}\n${rows.join('\n')}` }];
	}, [outputData, format]);

	// Drag and Drop ordering
	const handleDragStart = (e: React.DragEvent, index: number) => {
		e.dataTransfer.setData('fieldIndex', index.toString());
	};

	const handleDrop = (e: React.DragEvent, dropIndex: number) => {
		e.preventDefault();
		const dragIndex = parseInt(e.dataTransfer.getData('fieldIndex'), 10);
		if (dragIndex === dropIndex || Number.isNaN(dragIndex)) return;

		setFields((prev) => {
			const next = [...prev];
			const [draggedItem] = next.splice(dragIndex, 1);
			next.splice(dropIndex, 0, draggedItem);
			return next;
		});
	};

	const toggleField = (id: FieldType) => {
		setSelectedFields((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const applyPreset = (key: string) => {
		const preset = PRESETS[key];
		if (preset) {
			setSelectedFields(new Set(preset));
			const orderedFields = [...ALL_FIELDS].sort((a, b) => {
				const aIdx = preset.indexOf(a.id);
				const bIdx = preset.indexOf(b.id);
				if (aIdx === -1 && bIdx === -1) return 0;
				if (aIdx === -1) return 1;
				if (bIdx === -1) return -1;
				return aIdx - bIdx;
			});
			setFields(orderedFields);
		}
	};

	const handleDownload = () => {
		if (!outputData || validationError) return;
		const blob = new Blob([outputData], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `dummy-data.${format}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-8">
			<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
				{/* Left column: Configuration */}
				<div className="lg:col-span-4 space-y-6">
					<Card className="rounded-xl border-2">
						<CardContent className="p-4 space-y-4">
							<div className="flex items-center justify-between border-b pb-2">
								<Label className="font-semibold text-base flex items-center gap-2">
									<ListPlus className="h-4 w-4" /> フィールド設定
								</Label>
								<Select onValueChange={applyPreset}>
									<SelectTrigger className="w-[120px] h-7 text-xs rounded">
										<SelectValue placeholder="プリセット" />
									</SelectTrigger>
									<SelectContent>
										{Object.keys(PRESETS).map((key) => (
											<SelectItem key={key} value={key}>
												{key}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="text-xs text-muted-foreground mb-2">
								ドラッグ&ドロップで並べ替えできます
							</div>

							<div className="flex flex-col gap-2 border rounded-md p-2 bg-muted/20">
								{fields.map((f, i) => (
									// biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop item
									<div
										key={f.id}
										draggable
										onDragStart={(e) => handleDragStart(e, i)}
										onDragOver={(e) => e.preventDefault()}
										onDrop={(e) => handleDrop(e, i)}
										className="flex items-center gap-2 p-2 bg-card border rounded-md shadow-sm cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors"
									>
										<GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
										<Checkbox
											id={`field-${f.id}`}
											checked={selectedFields.has(f.id)}
											onCheckedChange={() => toggleField(f.id)}
											className="flex-shrink-0"
										/>
										<Label
											htmlFor={`field-${f.id}`}
											className="text-sm cursor-pointer flex-1 whitespace-nowrap overflow-hidden text-ellipsis"
											title={f.label}
										>
											{f.label}
										</Label>
									</div>
								))}
							</div>
						</CardContent>
					</Card>

					<Card className="rounded-xl border-2">
						<CardContent className="p-4 space-y-4">
							<div>
								<Label className="font-semibold text-sm mb-2 block">
									生成件数 (1〜1000)
								</Label>
								<Input
									type="number"
									min={1}
									max={1000}
									value={count}
									onChange={(e) => setCount(Number(e.target.value))}
									className={`rounded-xl ${validationError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
								/>
							</div>

							<div>
								<Label className="font-semibold text-sm mb-2 block">
									出力形式
								</Label>
								<Tabs
									value={format}
									onValueChange={(v) => setFormat(v as ExportFormat)}
								>
									<TabsList className="grid w-full grid-cols-3">
										<TabsTrigger value="json">JSON</TabsTrigger>
										<TabsTrigger value="csv">CSV</TabsTrigger>
										<TabsTrigger value="tsv">TSV</TabsTrigger>
									</TabsList>
								</Tabs>
							</div>

							<Button
								onClick={() => setRefreshKey((k) => k + 1)}
								className="w-full rounded-xl"
								variant="secondary"
								disabled={!!validationError}
							>
								<RefreshCw className="h-4 w-4 mr-2" />
								再生成
							</Button>
						</CardContent>
					</Card>
				</div>

				{/* Right column: Preview & Output */}
				<div className="lg:col-span-8 flex flex-col h-full">
					<div className="flex items-center justify-between mb-4">
						<Label className="text-base font-semibold">
							データプレビュー (最大20件)
						</Label>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={handleDownload}
								disabled={!outputData || !!validationError}
							>
								<Download className="h-4 w-4 mr-1" /> 保存
							</Button>
							<CopyButton
								text={outputData}
								disabled={!outputData || !!validationError}
							/>
						</div>
					</div>

					<div className="flex-1 rounded-xl border border-input shadow-sm bg-card overflow-hidden flex flex-col min-h-[500px] relative">
						{isGenerating && (
							<div className="absolute inset-0 z-10 bg-background/50 backdrop-blur-[1px] flex flex-col items-center justify-center">
								<Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
								<span className="text-primary text-sm font-medium">
									生成中...
								</span>
							</div>
						)}

						{validationError ? (
							<div className="flex-1 flex flex-col items-center justify-center text-destructive p-8 text-center bg-destructive/5">
								<AlertTriangle className="h-10 w-10 mb-2 opacity-80" />
								<p className="font-semibold text-base">{validationError}</p>
							</div>
						) : activeFields.length === 0 ? (
							<div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center">
								左側のパネルから出力したいフィールドを選択してください
							</div>
						) : format === 'json' ? (
							<pre className="p-4 font-mono-tool text-sm text-foreground overflow-auto flex-1 h-full shimmer">
								{JSON.stringify(previewData, null, 2)}
								{count > 20 && '\n\n... (表示のみ20件に制限)'}
							</pre>
						) : previewData[0]?.__previewText ? (
							<pre className="p-4 font-mono-tool text-sm text-foreground overflow-auto flex-1 h-full shimmer">
								{previewData[0].__previewText}
								{count > 20 && '\n... (表示のみ20件に制限)'}
							</pre>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
