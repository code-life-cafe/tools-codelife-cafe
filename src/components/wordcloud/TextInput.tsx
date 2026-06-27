import { Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MAX_INPUT_CHARS } from '@/lib/tools/wordcloud/index.ts';

interface TextInputProps {
	text: string;
	onTextChange: (text: string) => void;
	onClear: () => void;
	disabled?: boolean;
}

export function TextInput({
	text,
	onTextChange,
	onClear,
	disabled,
}: TextInputProps) {
	const handleFileSelect = (file: File) => {
		// 500,000文字の最大バイト数（UTF-8で約2MB相当）を超えるファイルは読込前に拒否
		if (file.size > 2 * 1024 * 1024) {
			alert('ファイルサイズが大きすぎます（上限2MB）。');
			return;
		}
		const reader = new FileReader();
		reader.onload = (e) => {
			const content = e.target?.result;
			if (typeof content === 'string') {
				onTextChange(content);
			}
		};
		reader.readAsText(file, 'UTF-8');
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<label
					htmlFor="wordcloud-text-input"
					className="text-sm font-medium text-foreground"
				>
					解析対象テキスト
				</label>
				<div className="flex items-center gap-3">
					<span
						className={`text-xs ${text.length > MAX_INPUT_CHARS ? 'text-destructive font-bold' : 'text-muted-foreground'}`}
					>
						{text.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()}{' '}
						文字
					</span>
					{text.length > 0 && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={onClear}
							disabled={disabled}
							className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
						>
							<Trash2 className="mr-1 h-3.5 w-3.5" />
							クリア
						</Button>
					)}
				</div>
			</div>

			<Textarea
				id="wordcloud-text-input"
				value={text}
				onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
					onTextChange(e.target.value)
				}
				placeholder="ここに解析したい日本語テキストを貼り付けてください（例: 問い合わせの自由記述、アンケート結果、議事録、ブログ記事など）"
				rows={8}
				disabled={disabled}
				className="font-mono text-sm leading-relaxed"
			/>

			<div className="pt-2">
				<FileDropzone
					onFileSelect={handleFileSelect}
					accept=".txt,.csv,.md,text/plain,text/csv,text/markdown"
					maxSizeBytes={2 * 1024 * 1024}
					validationMessage="ファイルサイズが上限（2MB）を超えています。"
					label="テキストファイルをドロップして読み込み"
					description=".txt, .csv, .md ファイルに対応（UTF-8, 上限2MB）"
					privacyNote="ファイル内容は外部に送信されません"
					disabled={disabled}
				/>
			</div>
		</div>
	);
}
