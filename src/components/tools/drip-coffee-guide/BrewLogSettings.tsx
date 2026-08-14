import { Download, Upload, Volume1, Volume2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	type BrewLogStore,
	InvalidBrewLogStoreError,
} from '@/lib/tools/drip-coffee-guide';
import {
	exportStoreJson,
	parseImportJson,
	previewImport,
} from '@/lib/tools/drip-coffee-guide-store';
import { playBeep } from './BrewGuide';

interface BrewLogSettingsProps {
	store: BrewLogStore;
	onImport: (incoming: BrewLogStore, mode: 'replace' | 'merge') => void;
}

interface PendingImport {
	incoming: BrewLogStore;
	previewReplace: { resultRecipeCount: number; resultBrewCount: number };
	previewMerge: { resultRecipeCount: number; resultBrewCount: number };
}

export function BrewLogSettings({ store, onImport }: BrewLogSettingsProps) {
	const [settings, updateSettings] = useToolSettings('drip-coffee-guide', {
		soundEnabled: true,
		soundVolume: 50,
	});
	const [pending, setPending] = useState<PendingImport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleTestSound = () => {
		try {
			const AudioCtx =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext })
					.webkitAudioContext;
			if (!AudioCtx) return;
			const ctx = new AudioCtx();
			const vol = settings.soundVolume ?? 50;
			playBeep(ctx, 'pre', vol);
			setTimeout(() => {
				playBeep(ctx, 'step', vol);
			}, 250);
		} catch {
			// 無視
		}
	};

	const handleExport = () => {
		const json = exportStoreJson(store);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `drip-coffee-guide-${new Date().toISOString().slice(0, 10)}.json`;
		a.dataset.astroReload = 'true';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		setError(null);
		try {
			const text = await file.text();
			const incoming = parseImportJson(text);
			setPending({
				incoming,
				previewReplace: previewImport(store, incoming, 'replace'),
				previewMerge: previewImport(store, incoming, 'merge'),
			});
		} catch (err) {
			setError(
				err instanceof InvalidBrewLogStoreError
					? err.message
					: 'JSONの読み込みに失敗しました。既存のデータは変更されていません。',
			);
		}
	};

	return (
		<div className="space-y-8">
			<section className="space-y-3">
				<h3 className="text-sm font-semibold text-muted-foreground">
					バックアップ
				</h3>
				<div className="flex flex-col sm:flex-row gap-3">
					<Button variant="outline" onClick={handleExport}>
						<Download className="h-4 w-4" />
						JSONを書き出す
					</Button>
					<Button
						variant="outline"
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload className="h-4 w-4" />
						JSONを読み込む
					</Button>
					<input
						ref={fileInputRef}
						type="file"
						accept="application/json"
						className="hidden"
						onChange={handleFileSelect}
					/>
				</div>
				<p className="text-xs text-muted-foreground">
					このデータはブラウザ内だけに保存されています。端末を変える前にJSONを書き出してください。
				</p>
				{error && (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				)}
			</section>

			<section className="space-y-4">
				<h3 className="text-sm font-semibold text-muted-foreground">効果音</h3>
				<div className="space-y-4 rounded-lg border border-border p-4">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<Switch
								id="sound-enabled"
								checked={settings.soundEnabled}
								onCheckedChange={(checked) =>
									updateSettings({ soundEnabled: checked })
								}
							/>
							<Label htmlFor="sound-enabled">
								抽出ガイドの効果音を再生する
							</Label>
						</div>
						{settings.soundEnabled && (
							<Button variant="outline" size="sm" onClick={handleTestSound}>
								<Volume2 className="h-3.5 w-3.5 mr-1" />
								試聴
							</Button>
						)}
					</div>

					{settings.soundEnabled && (
						<div className="space-y-2 pt-3 border-t border-border/60">
							<div className="flex justify-between items-center text-xs">
								<Label htmlFor="sound-volume">音量</Label>
								<span className="font-mono text-muted-foreground font-medium">
									{settings.soundVolume ?? 50}%
								</span>
							</div>
							<div className="flex items-center gap-3">
								<Volume1 className="h-4 w-4 text-muted-foreground shrink-0" />
								<input
									id="sound-volume"
									type="range"
									min="0"
									max="100"
									value={settings.soundVolume ?? 50}
									onChange={(e) =>
										updateSettings({ soundVolume: Number(e.target.value) })
									}
									className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
								/>
								<Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
							</div>
						</div>
					)}
				</div>
			</section>

			<Dialog
				open={pending !== null}
				onOpenChange={(next) => !next && setPending(null)}
			>
				{pending && (
					<DialogContent>
						<DialogHeader>
							<DialogTitle>データの読み込み方法を選択</DialogTitle>
							<DialogDescription>
								置換すると現在のデータはすべて読み込んだ内容に置き換わります。併合すると同じIDの記録は新しい方が残ります。
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-2 text-sm">
							<p>
								置換後: レシピ {pending.previewReplace.resultRecipeCount}件 /
								記録 {pending.previewReplace.resultBrewCount}件
							</p>
							<p>
								併合後: レシピ {pending.previewMerge.resultRecipeCount}件 / 記録{' '}
								{pending.previewMerge.resultBrewCount}件
							</p>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setPending(null)}>
								キャンセル
							</Button>
							<Button
								variant="secondary"
								onClick={() => {
									onImport(pending.incoming, 'merge');
									setPending(null);
								}}
							>
								併合する
							</Button>
							<Button
								variant="destructive"
								onClick={() => {
									onImport(pending.incoming, 'replace');
									setPending(null);
								}}
							>
								置換する
							</Button>
						</DialogFooter>
					</DialogContent>
				)}
			</Dialog>
		</div>
	);
}
