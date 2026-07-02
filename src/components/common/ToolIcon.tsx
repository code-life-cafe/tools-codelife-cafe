import { type ToolIconName, toolIconMap } from '../../lib/tools/tool-icons';

type Props = {
	name: ToolIconName;
	className?: string;
};

/** catalog.ts のアイコン名を lucide アイコンとして描画する共通コンポーネント */
export function ToolIcon({ name, className }: Props) {
	const Icon = toolIconMap[name];
	return <Icon className={className} aria-hidden="true" />;
}
