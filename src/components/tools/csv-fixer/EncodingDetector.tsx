import { AlertTriangle, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import type { DetectionResult, EncodingType } from '@/lib/encoding/types';
import type { FileInfo } from './shared';

interface EncodingDetectorProps {
	detection: DetectionResult;
	fileInfo: FileInfo;
	onEncodingOverride: (enc: EncodingType) => void;
}

const ENCODINGS: { value: EncodingType; label: string }[] = [
	{ value: 'UTF8', label: 'UTF-8' },
	{ value: 'SJIS', label: 'Shift_JIS' },
	{ value: 'EUCJP', label: 'EUC-JP' },
	{ value: 'UTF16LE', label: 'UTF-16 (LE)' },
	{ value: 'UTF16BE', label: 'UTF-16 (BE)' },
	{ value: 'ASCII', label: 'ASCII' },
];

export function EncodingDetector({
	detection,
	fileInfo,
	onEncodingOverride,
}: EncodingDetectorProps) {
	const formatSize = (bytes: number) => {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
	};

	return (
		<Card className="w-full shadow-sm">
			<CardHeader className="pb-3 border-b bg-muted/20">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<FileText className="w-4 h-4 text-primary" />
						<span
							className="font-medium text-sm truncate max-w-[200px] sm:max-w-[300px]"
							title={fileInfo.name}
						>
							{fileInfo.name}
						</span>
					</div>
					<span className="text-xs text-muted-foreground">
						{formatSize(fileInfo.size)}
					</span>
				</div>
			</CardHeader>
			<CardContent className="pt-4 space-y-4">
				{detection.confidence === 'low' && (
					<div className="flex items-start text-xs rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-500 p-3">
						<AlertTriangle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
						<p>
							エンコーディングの自動検出の信頼度が低いです。手動で選択してください。
						</p>
					</div>
				)}

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mt-2">
					<div className="space-y-1.5">
						<p className="text-xs font-medium text-muted-foreground">
							現在のエンコーディング
						</p>
						<Select
							value={detection.encoding}
							onValueChange={(val) => onEncodingOverride(val as EncodingType)}
						>
							<SelectTrigger className="w-full h-8 text-sm">
								<SelectValue placeholder="エンコード" />
							</SelectTrigger>
							<SelectContent>
								{ENCODINGS.map((enc) => (
									<SelectItem key={enc.value} value={enc.value}>
										{enc.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid grid-cols-3 gap-2">
						<div className="space-y-1">
							<span className="text-xs font-medium text-muted-foreground block">
								改行コード
							</span>
							<span className="block truncate font-mono text-xs">
								{fileInfo.lineEnding}
							</span>
						</div>
						<div className="space-y-1">
							<span className="text-xs font-medium text-muted-foreground block">
								BOM
							</span>
							<span className="block truncate">
								{fileInfo.hasBom ? 'あり' : 'なし'}
							</span>
						</div>
						<div className="space-y-1">
							<span className="text-xs font-medium text-muted-foreground block">
								推定行数
							</span>
							<span className="block truncate">
								{fileInfo.lineCount.toLocaleString()}
							</span>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
