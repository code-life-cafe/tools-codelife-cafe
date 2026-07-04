import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface BeepToggleProps {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}

/**
 * 読み取り成功時のビープ音トグル。既定OFF。
 * 音声ファイルは使わず Web Audio API（OscillatorNode）で生成するため、
 * ONにした操作（ユーザー操作）を起点に AudioContext を初期化する。
 */
export default function BeepToggle({ enabled, onChange }: BeepToggleProps) {
	return (
		<div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
			<div className="space-y-1">
				<Label
					htmlFor="beep-switch"
					className="text-sm font-medium cursor-pointer"
				>
					読み取り音
				</Label>
				<p className="text-xs text-muted-foreground leading-relaxed">
					ONにすると、QRコードを検出するたびに短いビープ音を鳴らします。
				</p>
			</div>
			<Switch id="beep-switch" checked={enabled} onCheckedChange={onChange} />
		</div>
	);
}
