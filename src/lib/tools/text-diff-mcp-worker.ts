import {
	computeBoundedDiff,
	DIFF_MESSAGES,
	DIFF_WORKER_DEADLINE_MS,
	parseDiffReply,
	serializeDiffOutput,
	type TextDiffInput,
	TextDiffMcpError,
	type TextDiffOutput,
} from './text-diff-mcp-runtime.ts';

let comparing = false;

export async function compareTextInWorker(
	input: TextDiffInput,
): Promise<TextDiffOutput> {
	if (typeof window === 'undefined')
		return parseDiffReply(serializeDiffOutput(computeBoundedDiff(input)));
	if (typeof Worker === 'undefined')
		throw new TextDiffMcpError(DIFF_MESSAGES.unavailable);
	if (comparing) throw new TextDiffMcpError(DIFF_MESSAGES.busy);
	comparing = true;
	try {
		return await new Promise((resolve, reject) => {
			const worker = new Worker(
				new URL('../../workers/text-diff.worker.ts', import.meta.url),
				{ type: 'module' },
			);
			let settled = false;
			const finish = (error?: Error, result?: TextDiffOutput) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				worker.onmessage = null;
				worker.onerror = null;
				worker.onmessageerror = null;
				worker.terminate();
				if (error) reject(error);
				else if (result) resolve(result);
				else reject(new TextDiffMcpError(DIFF_MESSAGES.reply));
			};
			const timer = window.setTimeout(
				() => finish(new TextDiffMcpError(DIFF_MESSAGES.timeout)),
				DIFF_WORKER_DEADLINE_MS,
			);
			worker.onmessage = (event: MessageEvent<unknown>) => {
				try {
					const result = parseDiffReply(event.data);
					if (result.mode !== input.mode)
						throw new TextDiffMcpError(DIFF_MESSAGES.reply);
					finish(undefined, result);
				} catch (error) {
					finish(
						error instanceof TextDiffMcpError
							? error
							: new TextDiffMcpError(DIFF_MESSAGES.reply),
					);
				}
			};
			worker.onerror = (event) => {
				event.preventDefault();
				finish(new TextDiffMcpError(DIFF_MESSAGES.worker));
			};
			worker.onmessageerror = () =>
				finish(new TextDiffMcpError(DIFF_MESSAGES.reply));
			try {
				worker.postMessage(input);
			} catch {
				finish(new TextDiffMcpError(DIFF_MESSAGES.worker));
			}
		});
	} catch (error) {
		if (error instanceof TextDiffMcpError) throw error;
		throw new TextDiffMcpError(DIFF_MESSAGES.worker);
	} finally {
		comparing = false;
	}
}
