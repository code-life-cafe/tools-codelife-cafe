import { urlEncoderMcpTool } from '../../tools/url-encoder.mcp.ts';
import { generateWebMcpDescriptor } from '../descriptor-generator.ts';

// 単一ソースの定義（src/lib/tools/url-encoder.mcp.ts）からディスクリプタを自動生成する。
// このファイル自体はディスクリプタの手書き実装を持たない。
export const urlEncoderTool = generateWebMcpDescriptor(urlEncoderMcpTool);
