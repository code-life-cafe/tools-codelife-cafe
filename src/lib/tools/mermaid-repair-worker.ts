import { repairMermaidCode } from './mermaid-repair.ts';
import {
	MAX_REPAIR_RESPONSE_BYTES,
	type MermaidRepairOutput,
	serializeRepairOutput,
} from './mermaid-repair-output.ts';

let repairing = false;
type Reply = MermaidRepairOutput | { error: string };

/** 公開ブラウザの100k修復はUIスレッドから分離し、終了時/期限超過時にWorkerを破棄する。 */
export async function repairMermaidInWorker(
	text: string,
): Promise<MermaidRepairOutput> {
	// 純粋関数のNodeテスト/SSRではページスレッドが存在しない。
	if (typeof window === 'undefined')
		return JSON.parse(
			serializeRepairOutput(repairMermaidCode(text)),
		) as MermaidRepairOutput;
	if (typeof Worker === 'undefined')
		throw new Error(
			'このブラウザではWeb Workerを利用できません。通常画面をご利用ください。',
		);
	if (repairing)
		throw new Error('修復処理が実行中です。完了後に再試行してください。');
	repairing = true;
	try {
		return await new Promise((resolve, reject) => {
			const worker = new Worker(
				new URL('../../workers/mermaid-repair.worker.ts', import.meta.url),
				{ type: 'module' },
			);
			let settled = false;
			const finish = (error?: Error, result?: MermaidRepairOutput) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				worker.terminate();
				if (error) reject(error);
				else if (result) resolve(result);
				else reject(new Error('修復結果の形式が不正です。'));
			};
			const timer = window.setTimeout(
				() =>
					finish(
						new Error(
							'修復処理が5秒の上限を超えたため中止しました。入力を短くして再試行してください。',
						),
					),
				5000,
			);
			worker.onmessage = (event: MessageEvent<string>) => {
				try {
					if (
						typeof event.data !== 'string' ||
						event.data.length > MAX_REPAIR_RESPONSE_BYTES
					)
						throw new Error();
					const reply = JSON.parse(event.data) as Reply;
					if ('error' in reply) finish(new Error(reply.error));
					else finish(undefined, reply);
				} catch {
					finish(new Error('修復結果の形式が不正です。'));
				}
			};
			worker.onerror = (event) => {
				event.preventDefault();
				finish(
					new Error('修復Workerを実行できませんでした。再試行してください。'),
				);
			};
			worker.onmessageerror = () =>
				finish(new Error('修復結果を受信できませんでした。'));
			try {
				worker.postMessage(text);
			} catch {
				finish(new Error('修復入力をWorkerに渡せませんでした。'));
			}
		});
	} finally {
		repairing = false;
	}
}
