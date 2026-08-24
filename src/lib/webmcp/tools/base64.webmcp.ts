import { base64McpTool } from '../../tools/base64.mcp.ts';
import { generateWebMcpDescriptor } from '../descriptor-generator.ts';

// 単一ソースの定義（src/lib/tools/base64.mcp.ts）からディスクリプタを自動生成する。
// このファイル自体はディスクリプタの手書き実装を持たない。
export const base64McpWebTool = generateWebMcpDescriptor(base64McpTool);
