import { cronCheckerMcpTool } from '../../tools/cron-checker.mcp.ts';
import { generateWebMcpDescriptor } from '../descriptor-generator.ts';

// 単一ソースの定義（src/lib/tools/cron-checker.mcp.ts）からディスクリプタを自動生成する。
// このファイル自体はディスクリプタの手書き実装を持たない。
export const cronCheckerTool = generateWebMcpDescriptor(cronCheckerMcpTool);
