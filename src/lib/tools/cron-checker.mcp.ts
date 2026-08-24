import { defineMcpTool } from '../webmcp/define-tool.ts';
import {
	describeCronJapanese,
	getNextRunTimes,
	parseCronExpression,
} from './cron-checker.ts';

const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
const MIN_MCP_COUNT = 1;
const MAX_MCP_COUNT = 50;

interface CronCheckerInput {
	expression: string;
	count: number;
}

interface CronCheckerOutput {
	description: string;
	nextRuns: string[];
}

export const cronCheckerMcpTool = defineMcpTool<
	CronCheckerInput,
	CronCheckerOutput
>({
	toolId: 'cron-checker',
	name: 'check_cron',
	description:
		'Explain a cron expression in Japanese and list its next scheduled run times (Asia/Tokyo). Supports standard 5-field and seconds-prefixed 6-field Vixie cron syntax. Runs entirely in the browser; no data is sent externally. / cron式を日本語で解説し、次回実行日時（Asia/Tokyo）を算出する。標準5フィールドおよび秒付き6フィールドのVixie cron構文に対応。処理はブラウザ内で完結し、外部送信は行わない。',
	params: {
		expression: {
			type: 'string',
			description:
				'Cron expression (5 or 6 fields) / cron式文字列（5または6フィールド）',
		},
		count: {
			type: 'number',
			required: false,
			default: 5,
			description: `Number of upcoming run times to return (${MIN_MCP_COUNT}-${MAX_MCP_COUNT}, default: 5) / 次回実行予定の算出件数（${MIN_MCP_COUNT}〜${MAX_MCP_COUNT}件、省略時: 5）`,
		},
	},
	returns: {
		description: {
			type: 'string',
			description: 'Japanese explanation of the schedule / 日本語解説文',
		},
		nextRuns: {
			type: 'array',
			description:
				'Upcoming run times as ISO 8601 UTC strings / 次回実行予定（ISO 8601 UTC文字列の配列）',
		},
	},
	annotations: { readOnlyHint: true },
	handler(input) {
		if (
			!Number.isInteger(input.count) ||
			input.count < MIN_MCP_COUNT ||
			input.count > MAX_MCP_COUNT
		) {
			throw new Error(
				`"count" must be an integer between ${MIN_MCP_COUNT} and ${MAX_MCP_COUNT} / "count" は${MIN_MCP_COUNT}〜${MAX_MCP_COUNT}の整数で指定してください`,
			);
		}
		const schedule = parseCronExpression(input.expression);
		const description = describeCronJapanese(schedule);
		const nextRuns = getNextRunTimes(schedule, {
			count: input.count,
			timeZone: DEFAULT_TIME_ZONE,
		}).map((d) => d.toISOString());
		return { description, nextRuns };
	},
});
