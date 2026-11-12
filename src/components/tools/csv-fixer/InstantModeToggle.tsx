import { Zap } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface InstantModeToggleProps {
	enabled: boolean;
	onToggle: (enabled: boolean) => void;
}

export function InstantModeToggle({
	enabled,
	onToggle,
}: InstantModeToggleProps) {
	return (
		<div className="flex items-center space-x-4 border rounded-lg p-4 bg-muted/30">
			<div className="bg-primary/10 p-2 rounded-full">
				<Zap className="w-5 h-5 text-primary" />
			</div>
			<div className="flex-1 space-y-1">
				<Label htmlFor="instant-mode" className="text-base font-medium">
					即時変換モード
				</Label>
				{enabled && (
					<p className="text-sm text-muted-foreground">
						D&amp;Dで即座に変換・ダウンロード（信頼度が高い場合のみ）
					</p>
				)}
			</div>
			<Switch id="instant-mode" checked={enabled} onCheckedChange={onToggle} />
		</div>
	);
}
