import type { BrowserContext } from '@playwright/test';

// CDPの実メモリdumpから、ブラウザ各プロセスのprivate footprintを1秒間隔で集計。
// 256MiB V8 old-space制限はWASM/全プロセスへの上限ではない。最大観測private footprintと区別する。
export async function startMemoryProfile(context: BrowserContext) {
	const browser = context.browser();
	if (!browser) throw Error('Browser unavailable');
	const cdp = await browser.newBrowserCDPSession();
	const dumps = new Map<string, Map<number, number>>();
	cdp.on('Tracing.dataCollected', ({ value }) => {
		for (const event of value) {
			const row = event as unknown as {
				id?: string;
				pid: number | string;
				args?: unknown;
			};
			let args:
				| { dumps?: { process_totals?: { private_footprint_bytes?: string } } }
				| undefined;
			try {
				args = (
					typeof row.args === 'string' ? JSON.parse(row.args) : row.args
				) as typeof args;
			} catch {
				continue;
			}
			const total = args?.dumps?.process_totals?.private_footprint_bytes;
			if (typeof total !== 'string') continue;
			const key = String(row.id);
			let processes = dumps.get(key);
			if (!processes) {
				processes = new Map();
				dumps.set(key, processes);
			}
			processes.set(Number(row.pid), Number.parseInt(total, 16));
		}
	});
	await cdp.send('Tracing.start', {
		categories: 'disabled-by-default-memory-infra',
		transferMode: 'ReportEvents',
	});
	let pending: Promise<unknown> | null = null;
	const sample = () => {
		if (pending) return;
		pending = cdp
			.send('Tracing.requestMemoryDump', { levelOfDetail: 'light' })
			.finally(() => {
				pending = null;
			});
		void pending.catch(() => {});
	};
	const timer = setInterval(sample, 1000);
	sample();
	return async () => {
		clearInterval(timer);
		await pending?.catch(() => {});
		const completed = new Promise<void>((resolve) =>
			cdp.once('Tracing.tracingComplete', () => resolve()),
		);
		await cdp.send('Tracing.end');
		await completed;
		await cdp.detach();
		const totals = Array.from(dumps.values(), (processes) =>
			Array.from(processes.values()).reduce((sum, value) => sum + value, 0),
		);
		return {
			samples: totals.length,
			maxSampledPrivateFootprintBytes: totals.length
				? Math.max(...totals)
				: null,
			v8OldSpaceLimitMiB: 256,
			v8SemiSpaceLimitMiB: 8,
		};
	};
}
