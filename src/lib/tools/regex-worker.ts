import { execRegexSync } from './regex-tester';

type WorkerInput = {
	pattern: string;
	flags: string;
	text: string;
	replacement?: string;
};

self.onmessage = (event: MessageEvent<WorkerInput>) => {
	const { pattern, flags, text, replacement } = event.data;
	const result = execRegexSync(pattern, flags, text, replacement);
	self.postMessage(result);
};
