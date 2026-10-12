import { repairMermaidCode } from '../lib/tools/mermaid-repair';

self.onmessage = (event: MessageEvent<string>) => {
	try {
		self.postMessage({ ok: true, result: repairMermaidCode(event.data) });
	} catch {
		self.postMessage({
			ok: false,
			error: 'Mermaidコードを修復できませんでした。入力を確認してください。',
		});
	}
};
