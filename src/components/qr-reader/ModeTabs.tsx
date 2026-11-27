import { Camera, ImageIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type ScanMode = 'camera' | 'image';

interface ModeTabsProps {
	mode: ScanMode;
	onModeChange: (mode: ScanMode) => void;
	/** 読み取り領域に `tabsSharedPanelProps(panelIdBase, mode)` を付ける側と同じ値（`useId()`） */
	panelIdBase: string;
}

export default function ModeTabs({
	mode,
	onModeChange,
	panelIdBase,
}: ModeTabsProps) {
	return (
		<Tabs
			value={mode}
			onValueChange={(v) => onModeChange(v as ScanMode)}
			panelIdBase={panelIdBase}
			sharedPanel
		>
			<TabsList>
				<TabsTrigger value="camera" className="gap-1.5">
					<Camera className="h-4 w-4" aria-hidden="true" />
					カメラで読み取り
				</TabsTrigger>
				<TabsTrigger value="image" className="gap-1.5">
					<ImageIcon className="h-4 w-4" aria-hidden="true" />
					画像から読み取り
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}
