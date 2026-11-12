import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import type { EncodingType } from '@/lib/encoding/types';
import type { UserSettings } from '@/lib/settings/types';

interface ConversionOptionsProps {
	settings: UserSettings;
	onSettingsChange: (settings: UserSettings) => void;
}

export function ConversionOptions({
	settings,
	onSettingsChange,
}: ConversionOptionsProps) {
	const handleUpdate = (updates: Partial<UserSettings>) => {
		let newAddBom =
			updates.addBom !== undefined ? updates.addBom : settings.addBom;

		if (
			updates.outputEncoding &&
			(updates.outputEncoding === 'SJIS' || updates.outputEncoding === 'EUCJP')
		) {
			newAddBom = false;
		} else if (
			updates.outputEncoding === 'UTF8' &&
			settings.outputEncoding !== 'UTF8'
		) {
			newAddBom = true;
		}

		onSettingsChange({
			...settings,
			...updates,
			addBom: newAddBom,
		});
	};

	return (
		<Card className="w-full shadow-sm">
			<CardHeader className="pb-3 border-b bg-muted/20">
				<CardTitle className="text-sm font-medium">出力オプション</CardTitle>
			</CardHeader>
			<CardContent className="pt-4 space-y-5">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
					<div className="space-y-2">
						<Label
							htmlFor="output-encoding"
							className="text-xs font-medium text-muted-foreground"
						>
							出力エンコーディング
						</Label>
						<Select
							value={settings.outputEncoding}
							onValueChange={(val) =>
								handleUpdate({ outputEncoding: val as EncodingType })
							}
						>
							<SelectTrigger id="output-encoding" className="h-9">
								<SelectValue placeholder="エンコード" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="UTF8">UTF-8 (推奨)</SelectItem>
								<SelectItem value="SJIS">Shift_JIS</SelectItem>
								<SelectItem value="EUCJP">EUC-JP</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-[10px] text-muted-foreground mt-1 text-balance">
							{settings.outputEncoding === 'UTF8'
								? 'Excelで開く場合はBOM付与を推奨します。'
								: 'レガシーシステム向けの形式です。'}
						</p>
					</div>

					<div className="space-y-2">
						<Label
							htmlFor="line-ending"
							className="text-xs font-medium text-muted-foreground"
						>
							改行コード
						</Label>
						<Select
							value={settings.lineEnding}
							onValueChange={(val) =>
								handleUpdate({ lineEnding: val as 'CRLF' | 'LF' | 'CR' })
							}
						>
							<SelectTrigger id="line-ending" className="h-9">
								<SelectValue placeholder="改行コード" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="CRLF">CR+LF (Windows)</SelectItem>
								<SelectItem value="LF">LF (Mac/Linux)</SelectItem>
								<SelectItem value="CR">CR (Classic Mac)</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="flex items-center space-x-2 pt-1">
					<Checkbox
						id="add-bom"
						checked={settings.addBom}
						onCheckedChange={(checked) =>
							handleUpdate({ addBom: checked === true })
						}
						disabled={
							settings.outputEncoding === 'SJIS' ||
							settings.outputEncoding === 'EUCJP'
						}
					/>
					<Label
						htmlFor="add-bom"
						className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${
							settings.outputEncoding === 'SJIS' ||
							settings.outputEncoding === 'EUCJP'
								? 'text-muted-foreground'
								: ''
						}`}
					>
						BOM (バイトオーダーマーク) を付与する
					</Label>
				</div>
			</CardContent>
		</Card>
	);
}
