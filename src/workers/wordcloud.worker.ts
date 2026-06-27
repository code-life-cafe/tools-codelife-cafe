import { analyze } from '../lib/tools/wordcloud/index.ts';
import type { AnalyzeOptions } from '../lib/tools/wordcloud/types.ts';

export type WorkerInputMessage = {
	type: 'ANALYZE';
	text: string;
	opts: AnalyzeOptions;
};

export type WorkerOutputMessage =
	| {
			type: 'SUCCESS';
			result: Awaited<ReturnType<typeof analyze>>;
	  }
	| {
			type: 'ERROR';
			error: string;
	  }
	| {
			type: 'PROGRESS';
			progress: number;
	  };

self.addEventListener(
	'message',
	async (e: MessageEvent<WorkerInputMessage>) => {
		const { type, text, opts } = e.data;
		if (type === 'ANALYZE') {
			try {
				const result = await analyze(text, opts, (progress) => {
					self.postMessage({ type: 'PROGRESS', progress });
				});
				self.postMessage({ type: 'SUCCESS', result });
			} catch (err: unknown) {
				const errorMessage =
					err instanceof Error ? err.message : '解析中にエラーが発生しました。';
				self.postMessage({ type: 'ERROR', error: errorMessage });
			}
		}
	},
);
