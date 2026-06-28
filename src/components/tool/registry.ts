import type { ComponentType } from 'react';
import CsvFixerTool from '../tools/CsvFixer';

/**
 * ツールスラッグからツール本体コンポーネント（React Island）への静的マッピングレジストリ
 */
export const toolRegistry: Record<string, ComponentType<unknown>> = {
	'csv-mojibake': CsvFixerTool,
	'csv-fixer': CsvFixerTool,
};

/**
 * スラッグに対応するツールコンポーネントを取得する
 * @param slug ツールスラッグ
 * @returns Reactコンポーネント、未登録の場合はnull
 */
export function getToolComponent(slug: string): ComponentType<unknown> | null {
	return toolRegistry[slug] || null;
}
