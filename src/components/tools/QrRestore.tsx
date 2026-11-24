import {
	AlertTriangle,
	CheckCircle2,
	ExternalLink,
	Loader2,
	XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { ImageDropzone } from '@/components/common/ImageDropzone';
import { Button } from '@/components/ui/button';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { isOpenableUrl } from '@/lib/tools/qr-reader';
import {
	type RestoreAttempt,
	validateRestoreFile,
} from '@/lib/tools/qr-restore';
import type {
	RestorePreview,
	RestoreWorkerRequest,
	RestoreWorkerResponse,
} from '@/workers/qr-restore.worker';

type State =
	| { status: 'idle' }
	| {
			status: 'running';
			fileName: string;
			index: number;
			total: number;
			label: string;
	  }
	| {
			status: 'success';
			fileName: string;
			texts: string[];
			stepLabel: string;
			attempts: RestoreAttempt[];
			preview: RestorePreview;
	  }
	| { status: 'failed'; fileName: string; attempts: RestoreAttempt[] }
	| { status: 'error'; message: string };

function PreviewCanvas({ preview }: { preview: RestorePreview }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext('2d');
		if (!canvas || !ctx) return;
		canvas.width = preview.width;
		canvas.height = preview.height;
		ctx.putImageData(
			new ImageData(
				new Uint8ClampedArray(preview.rgba),
				preview.width,
				preview.height,
			),
			0,
			0,
		);
	}, [preview]);
	return (
		<canvas
			ref={canvasRef}
			data-testid="qr-restore-preview"
			className="mx-auto block h-auto max-h-64 w-auto max-w-full rounded-lg border border-border bg-white"
			role="img"
			aria-label="読み取りに成功した補正後の画像"
		/>
	);
}

function AttemptList({ attempts }: { attempts: RestoreAttempt[] }) {
	return (
		<ol className="grid gap-1 text-sm sm:grid-cols-2">
			{attempts.map((a) => (
				<li key={a.id} className="flex items-center gap-2">
					{a.found ? (
						<CheckCircle2
							className="h-4 w-4 shrink-0 text-safety"
							aria-hidden="true"
						/>
					) : (
						<XCircle
							className="h-4 w-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					)}
					<span>
						{a.label}
						<span className="sr-only">
							{a.found ? '（読み取り成功）' : '（読み取れず）'}
						</span>
					</span>
				</li>
			))}
		</ol>
	);
}

export function QrRestore() {
	const { trackRun } = useToolAnalytics('qr-restore');
	const [state, setState] = useState<State>({ status: 'idle' });
	const workerRef = useRef<Worker | null>(null);

	const stopWorker = useCallback(() => {
		workerRef.current?.terminate();
		workerRef.current = null;
	}, []);

	useEffect(() => stopWorker, [stopWorker]);

	const handleFile = useCallback(
		(file: File) => {
			const invalid = validateRestoreFile(file);
			if (invalid) {
				setState({ status: 'error', message: invalid });
				return;
			}
			// 実行中の処理があれば破棄して新しい Worker で始める
			stopWorker();
			trackRun();
			const worker = new Worker(
				new URL('../../workers/qr-restore.worker.ts', import.meta.url),
				{ type: 'module' },
			);
			workerRef.current = worker;
			const id = crypto.randomUUID();
			const fileName = file.name;
			setState({
				status: 'running',
				fileName,
				index: 0,
				total: 0,
				label: '画像を準備しています',
			});
			worker.onmessage = (e: MessageEvent<RestoreWorkerResponse>) => {
				const msg = e.data;
				if (msg.id !== id || workerRef.current !== worker) return;
				if (msg.type === 'progress') {
					setState({
						status: 'running',
						fileName,
						index: msg.index,
						total: msg.total,
						label: msg.label,
					});
					return;
				}
				if (msg.type === 'success') {
					setState({
						status: 'success',
						fileName,
						texts: msg.texts,
						stepLabel: msg.stepLabel,
						attempts: msg.attempts,
						preview: msg.preview,
					});
				} else if (msg.type === 'failed') {
					setState({ status: 'failed', fileName, attempts: msg.attempts });
				} else {
					setState({ status: 'error', message: msg.message });
				}
				stopWorker();
			};
			worker.onerror = () => {
				if (workerRef.current !== worker) return;
				setState({
					status: 'error',
					message:
						'処理中にエラーが発生しました。ページを再読み込みしてお試しください。',
				});
				stopWorker();
			};
			worker.postMessage({
				type: 'restore',
				id,
				blob: file,
			} satisfies RestoreWorkerRequest);
		},
		[stopWorker, trackRun],
	);

	const handleCancel = useCallback(() => {
		stopWorker();
		setState({ status: 'idle' });
	}, [stopWorker]);

	const running = state.status === 'running';

	return (
		<div className="space-y-6">
			<ImageDropzone onFileAccepted={handleFile} disabled={running} />

			<div aria-live="polite" className="space-y-4">
				{state.status === 'running' && (
					<div
						data-testid="qr-restore-progress"
						className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm"
					>
						<Loader2
							className="h-4 w-4 shrink-0 animate-spin text-primary"
							aria-hidden="true"
						/>
						<p className="min-w-0 flex-1 break-words">
							{state.total > 0
								? `試行中（${state.index + 1}/${state.total}）: ${state.label}`
								: state.label}
						</p>
						<Button variant="ghost" size="sm" onClick={handleCancel}>
							中止
						</Button>
					</div>
				)}

				{state.status === 'error' && (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					>
						<AlertTriangle
							className="mt-0.5 h-4 w-4 shrink-0"
							aria-hidden="true"
						/>
						<p className="min-w-0 break-words">{state.message}</p>
					</div>
				)}

				{state.status === 'success' && (
					<section
						data-testid="qr-restore-success"
						className="space-y-4 rounded-xl border border-safety/40 bg-safety/5 p-4"
					>
						<h2 className="flex items-center gap-2 text-base font-semibold">
							<CheckCircle2
								className="h-5 w-5 shrink-0 text-safety"
								aria-hidden="true"
							/>
							読み取れました（{state.texts.length}件）
						</h2>
						<p className="text-sm text-muted-foreground">
							成功した手法: <strong>{state.stepLabel}</strong>
						</p>
						<ul className="space-y-2">
							{state.texts.map((text) => (
								<li
									key={text}
									className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-start"
								>
									<span
										data-testid="qr-restore-text"
										className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm"
									>
										{text}
									</span>
									<div className="flex shrink-0 gap-2">
										<CopyButton text={text} />
										{isOpenableUrl(text) && (
											<Button variant="outline" size="sm" asChild>
												<a
													href={text}
													target="_blank"
													rel="noopener noreferrer"
												>
													<ExternalLink
														className="h-4 w-4"
														aria-hidden="true"
													/>
													開く
												</a>
											</Button>
										)}
									</div>
								</li>
							))}
						</ul>
						<p className="text-xs text-muted-foreground">
							URLを開く前に、表示された内容が意図したものか確認してください。
						</p>
						<div className="space-y-2">
							<p className="text-sm font-medium">補正後の画像</p>
							<PreviewCanvas preview={state.preview} />
						</div>
						<details className="text-sm">
							<summary className="cursor-pointer text-muted-foreground">
								試した手法（{state.attempts.length}件）
							</summary>
							<div className="mt-2">
								<AttemptList attempts={state.attempts} />
							</div>
						</details>
					</section>
				)}

				{state.status === 'failed' && (
					<section
						data-testid="qr-restore-failed"
						className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
					>
						<h2 className="flex items-center gap-2 text-base font-semibold">
							<AlertTriangle
								className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
								aria-hidden="true"
							/>
							読み取れませんでした
						</h2>
						<p className="text-sm text-muted-foreground">
							{state.attempts.length}
							通りの補正を試しましたが、QRコードを読み取れませんでした。次の方法をお試しください。
						</p>
						<ul className="list-disc space-y-1 pl-5 text-sm">
							<li>
								QRコードが画像の大部分を占めるように、近づいて撮り直す（または切り取る）
							</li>
							<li>ピントを合わせ、光の反射や影が入らない向きから撮り直す</li>
							<li>
								四隅の大きな四角（位置検出パターン）が3つとも写っているか確認する
							</li>
							<li>
								汚れ・破れが大きい場合は、誤り訂正で補える範囲（最大約30%）を超えている可能性があります
							</li>
						</ul>
						<details className="text-sm">
							<summary className="cursor-pointer text-muted-foreground">
								試した手法（{state.attempts.length}件）
							</summary>
							<div className="mt-2">
								<AttemptList attempts={state.attempts} />
							</div>
						</details>
					</section>
				)}
			</div>
		</div>
	);
}
