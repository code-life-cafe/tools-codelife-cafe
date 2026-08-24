import { zenkakuHankakuMcpTool } from '../../tools/zenkaku-hankaku.mcp.ts';
import { generateWebMcpDescriptor } from '../descriptor-generator.ts';

// 単一ソースの定義（src/lib/tools/zenkaku-hankaku.mcp.ts）からディスクリプタを自動生成する。
// このファイル自体はディスクリプタの手書き実装を持たない。
export const zenkakuHankakuTool = generateWebMcpDescriptor(
	zenkakuHankakuMcpTool,
);
