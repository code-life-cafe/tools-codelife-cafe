import {
	computeBoundedDiff,
	safeDiffError,
	serializeDiffOutput,
	type TextDiffInput,
} from '../lib/tools/text-diff-mcp-runtime';

self.onmessage = (event: MessageEvent<TextDiffInput>) => {
	try {
		self.postMessage(serializeDiffOutput(computeBoundedDiff(event.data)));
	} catch (error) {
		self.postMessage(JSON.stringify({ error: safeDiffError(error) }));
	}
};
