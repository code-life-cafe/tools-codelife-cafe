import { jwtDecoderMcpTool } from '../../tools/jwt-decoder.mcp.ts';
import { generateWebMcpDescriptor } from '../descriptor-generator.ts';

// 単一ソースの定義（src/lib/tools/jwt-decoder.mcp.ts）からディスクリプタを自動生成する。
// このファイル自体はディスクリプタの手書き実装を持たない。
export const jwtDecoderTool = generateWebMcpDescriptor(jwtDecoderMcpTool);
