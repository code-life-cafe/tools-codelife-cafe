import { base64McpTool } from '../tools/base64.mcp.ts';
import { charCountMcpTool } from '../tools/char-count.mcp.ts';
import { cronCheckerMcpTool } from '../tools/cron-checker.mcp.ts';
import { hashMcpTool } from '../tools/hash.mcp.ts';
import { jsonFormatterMcpTool } from '../tools/json-formatter.mcp.ts';
import { jwtDecoderMcpTool } from '../tools/jwt-decoder.mcp.ts';
import { urlEncoderMcpTool } from '../tools/url-encoder.mcp.ts';
import { uuidMcpTool } from '../tools/uuid.mcp.ts';
import { zenkakuHankakuMcpTool } from '../tools/zenkaku-hankaku.mcp.ts';
import type { McpToolDefinition } from './define-tool.ts';

/**
 * 単一ソースの `McpToolDefinition` を宣言しているツール一覧。
 * `scripts/generate-webmcp-manifest.ts`（ビルド時のディスクリプタ生成・検証）と
 * 将来のディスクリプタ集約処理はここを起点に走査する。
 *
 * 新規ツールにWebMCP対応を追加する場合、`src/lib/tools/[name].mcp.ts` に
 * `defineMcpTool()` で定義を宣言し、ここに1行追加するだけでよい
 * （inputSchema/outputSchema/validate の手書きは不要）。
 */
// biome-ignore lint/suspicious/noExplicitAny: 各ツールの McpToolDefinition<TParams, TOutput> はツールごとに型引数が異なるため、配列としてまとめる際は unknown 化する
export const mcpToolDefinitions: readonly McpToolDefinition<any, unknown>[] = [
	hashMcpTool,
	zenkakuHankakuMcpTool,
	jsonFormatterMcpTool,
	charCountMcpTool,
	base64McpTool,
	urlEncoderMcpTool,
	uuidMcpTool,
	cronCheckerMcpTool,
	jwtDecoderMcpTool,
];
