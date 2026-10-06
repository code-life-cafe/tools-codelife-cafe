import type { ComponentType } from 'react';
import CsvFixerTool from '../tools/CsvFixer';
import LogTimeAnalyzer from '../tools/LogTimeAnalyzer';
import RandomSort from '../tools/RandomSort';
import UrlParser from '../tools/UrlParser';

/**
 * ツールスラッグからツール本体コンポーネント（React Island）への静的マッピングレジストリ
 */
export const toolRegistry: Record<string, ComponentType<unknown>> = {
	'csv-mojibake': CsvFixerTool,
	'csv-fixer': CsvFixerTool,
	'url-parser': UrlParser,
	'random-sort': RandomSort,
	'log-time-analyzer': LogTimeAnalyzer,
};

/**
 * スラッグに対応するツールコンポーネントを取得する
 * @param slug ツールスラッグ
 * @returns Reactコンポーネント、未登録の場合はnull
 */
export function getToolComponent(slug: string): ComponentType<unknown> | null {
	return toolRegistry[slug] || null;
}
