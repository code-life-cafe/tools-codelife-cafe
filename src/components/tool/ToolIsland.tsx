import { getToolComponent } from './registry';

interface ToolIslandProps {
	slug: string;
}

/**
 * ツールスラッグに基づいてregistry.tsから動的にコンポーネントを取得し描画するReact Islandラッパー
 */
export default function ToolIsland({ slug }: ToolIslandProps) {
	const Component = getToolComponent(slug);
	if (!Component) {
		return null;
	}
	return <Component />;
}
