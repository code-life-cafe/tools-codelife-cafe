import { hashMcpTool } from '../../tools/hash.mcp.ts';
import { generateWebMcpDescriptor } from '../descriptor-generator.ts';

// 単一ソースの定義（src/lib/tools/hash.mcp.ts）からディスクリプタを自動生成する。
// このファイル自体はディスクリプタの手書き実装を持たない。
export const hashTool = generateWebMcpDescriptor(hashMcpTool);
