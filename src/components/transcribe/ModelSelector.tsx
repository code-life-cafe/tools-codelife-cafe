// ModelSelector — モデルサイズ選択と WebGPU バッジ
// 初回体験を壊さないため、選択しただけではダウンロードしない（実行時に取得する）。

import { Cpu, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { listModelChoices } from '@/lib/transcribe/models';
import type {
	ModelId,
	TranscribeDevice,
	TranscribeLanguage,
} from '@/lib/transcribe/protocol';

type ModelSelectorProps = {
	modelId: ModelId;
	onModelChange: (id: ModelId) => void;
	language: TranscribeLanguage;
	onLanguageChange: (language: TranscribeLanguage) => void;
	device: TranscribeDevice | null;
	/** キャッシュ済みで初回ダウンロードが発生しないモデル */
	cachedModelIds: readonly ModelId[];
	disabled?: boolean;
};

export function ModelSelector({
	modelId,
	onModelChange,
	language,
	onLanguageChange,
	device,
	cachedModelIds,
	disabled,
}: ModelSelectorProps) {
	const choices = listModelChoices(device ?? 'wasm');
	const selected = choices.find((c) => c.id === modelId);
	const isCached = cachedModelIds.includes(modelId);
	const smallRecommended = device === 'webgpu';

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				{device === 'webgpu' ? (
					<Badge variant="secondary" className="gap-1">
						<Zap className="h-3 w-3" aria-hidden="true" />
						WebGPU で高速実行
					</Badge>
				) : (
					<Badge variant="outline" className="gap-1">
						<Cpu className="h-3 w-3" aria-hidden="true" />
						{device === null ? '実行環境を確認中…' : 'WebAssembly で実行'}
					</Badge>
				)}
				{isCached && (
					<Badge variant="outline">キャッシュ済み（再ダウンロード不要）</Badge>
				)}
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transcribe-model">モデル</Label>
					<Select
						value={modelId}
						onValueChange={(value) => onModelChange(value as ModelId)}
						disabled={disabled}
					>
						<SelectTrigger id="transcribe-model" className="w-full">
							<SelectValue placeholder="モデルを選択" />
						</SelectTrigger>
						<SelectContent>
							{choices.map((choice) => (
								<SelectItem key={choice.id} value={choice.id}>
									{choice.badge}（{choice.name}） / 約 {choice.sizeLabel}
									{choice.id === 'base' ? ' ・推奨' : ''}
									{choice.id === 'small' && smallRecommended
										? ' ・高精度推奨'
										: ''}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transcribe-language">言語</Label>
					<Select
						value={language}
						onValueChange={(value) =>
							onLanguageChange(value as TranscribeLanguage)
						}
						disabled={disabled}
					>
						<SelectTrigger id="transcribe-language" className="w-full">
							<SelectValue placeholder="言語を選択" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ja">日本語（固定）</SelectItem>
							<SelectItem value="auto">自動判定</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{selected && (
				<p className="text-sm text-muted-foreground">
					{selected.description}
					{isCached
						? 'このモデルは端末にキャッシュ済みのため、すぐに実行できます。'
						: `初回実行時に約 ${selected.sizeLabel} をダウンロードします（2回目以降は不要）。`}
				</p>
			)}
			{modelId === 'small' && device !== 'webgpu' && (
				<p className="text-sm text-muted-foreground">
					この端末では WebGPU が使えないため、high
					精度モデルは処理に時間がかかります。まずは tiny / base
					をおすすめします。
				</p>
			)}
		</div>
	);
}
