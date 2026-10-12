import { repairMermaidCode } from '../lib/tools/mermaid-repair';
import { serializeRepairOutput } from '../lib/tools/mermaid-repair-output';

self.onmessage = (event: MessageEvent<string>) => {
	try {
		self.postMessage(serializeRepairOutput(repairMermaidCode(event.data)));
	} catch (error) {
		self.postMessage(
			JSON.stringify({
				error:
					error instanceof Error
						? error.message
						: 'Mermaidコードを修復できませんでした。入力を確認してください。',
			}),
		);
	}
};
