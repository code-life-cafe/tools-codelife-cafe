import { useEffect, useRef, useState } from 'react';
import { FileDropzone } from '@/components/common/FileDropzone';
import { Button } from '@/components/ui/button';
import { VideoTrimRange } from '@/components/video-compress/VideoTrimRange';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	compressionPlan,
	DEFAULT_VIDEO_SETTINGS,
	formatVideoBytes,
	MAX_VIDEO_BYTES,
	qualityEstimate,
	reductionPercent,
	type VideoInfo,
	type VideoReply,
	validateVideoSettings,
} from '@/lib/tools/video-compress';

export default function VideoCompress() {
	const [settings, updateSettings] = useToolSettings(
		'video-compress',
		DEFAULT_VIDEO_SETTINGS,
		validateVideoSettings,
	);
	const [file, setFile] = useState<File | null>(null);
	const [info, setInfo] = useState<VideoInfo | null>(null);
	const [sourceUrl, setSourceUrl] = useState('');
	const [result, setResult] = useState<{
		url: string;
		size: number;
		target: number | null;
	} | null>(null);
	const [status, setStatus] = useState<
		'empty' | 'loading' | 'ready' | 'compressing' | 'done' | 'error'
	>('empty');
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [start, setStart] = useState(0);
	const [end, setEnd] = useState(0);
	const [progress, setProgress] = useState(0);
	const worker = useRef<Worker | null>(null);
	const resultUrl = useRef('');
	const runTarget = useRef<number | null>(null);
	const processing = status === 'loading' || status === 'compressing';

	useEffect(() => {
		if (!file) {
			setSourceUrl('');
			return;
		}
		const url = URL.createObjectURL(file);
		setSourceUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);
	useEffect(
		() => () => {
			worker.current?.terminate();
			if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
		},
		[],
	);
	function clearResult() {
		if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
		resultUrl.current = '';
		setResult(null);
	}
	function load(selected: File, preserveRange = false) {
		worker.current?.terminate();
		worker.current = null;
		setError('');
		setNotice('');
		clearResult();
		setInfo(null);
		setProgress(0);
		setFile(selected);
		if (
			!selected.size ||
			selected.size > MAX_VIDEO_BYTES ||
			!/\.(mp4|mov|webm|mkv)$/i.test(selected.name)
		) {
			setError(
				'MP4・MOV・WebM・MKVの、空でない256MiB以下の動画を選択してください。',
			);
			setStatus('error');
			return;
		}
		setStatus('loading');
		try {
			const next = new Worker(
				new URL('../../workers/video-compress.worker.ts', import.meta.url),
				{ type: 'module' },
			);
			worker.current = next;
			next.onmessage = (event: MessageEvent<VideoReply>) => {
				if (worker.current !== next) return;
				const message = event.data;
				if (message.type === 'ready') {
					setInfo(message.info);
					if (!preserveRange) {
						setStart(0);
						setEnd(message.info.duration);
					}
					setStatus('ready');
				} else if (message.type === 'progress')
					setProgress(Math.min(99, Math.floor(message.progress * 100)));
				else if (message.type === 'done') {
					const blob = new Blob([message.buffer], { type: 'video/mp4' });
					const url = URL.createObjectURL(blob);
					resultUrl.current = url;
					setResult({ url, size: blob.size, target: runTarget.current });
					setProgress(100);
					setStatus('done');
				} else {
					setError(message.message);
					setStatus('error');
				}
			};
			next.onerror = () => {
				if (worker.current !== next) return;
				worker.current = null;
				setInfo(null);
				setError(
					'動画処理が停止しました。「動画を読み直す」から再試行してください。',
				);
				setStatus('error');
				next.terminate();
			};
			next.postMessage({ type: 'load', file: selected });
		} catch {
			setError('このブラウザーでは動画処理を開始できません。');
			setStatus('error');
		}
	}
	let plan: ReturnType<typeof compressionPlan> | undefined;
	let planError = '';
	if (info) {
		try {
			plan = compressionPlan(info, { settings, start, end });
		} catch (caught) {
			planError =
				caught instanceof Error ? caught.message : '設定を確認してください。';
		}
	}
	function compress() {
		if (!worker.current || !plan) return;
		clearResult();
		setError('');
		setNotice('');
		setProgress(0);
		setStatus('compressing');
		runTarget.current =
			settings.mode === 'size' ? settings.targetMB * 1_000_000 : null;
		worker.current.postMessage({
			type: 'compress',
			job: { settings, start, end },
		});
	}
	function cancel() {
		worker.current?.terminate();
		worker.current = null;
		if (status === 'loading') {
			setInfo(null);
			setStatus('empty');
		} else if (file) load(file, info !== null);
		setNotice('処理をキャンセルしました。再実行できます。');
	}
	const fieldClass = 'w-full rounded-md border border-input bg-background p-2';
	return (
		<div className="space-y-6">
			<p className="text-sm text-muted-foreground">
				動画は端末のブラウザー内だけで処理します。アップロード・外部送信はありません。入力上限256MiB、出力上限128MiB。長い動画はPCをおすすめします。
			</p>
			<FileDropzone
				onFileSelect={load}
				onValidationError={setError}
				accept=".mp4,.mov,.webm,.mkv"
				maxSizeBytes={MAX_VIDEO_BYTES}
				validationMessage="MP4・MOV・WebM・MKVの、空でない256MiB以下の動画を選択してください。"
				validate={(selected) =>
					selected.size ? null : '空の動画は読み込めません。'
				}
				label="動画をドラッグ＆ドロップ"
				description="またはクリックして動画を選択（MP4 / MOV / WebM / MKV・256MiB以下）"
				privacyNote="動画は端末内だけで処理され、外部へ送信されません"
				inputAriaLabel="動画を選択、またはここにドロップ"
				disabled={processing}
			/>
			{file && (
				<p className="break-all text-sm">
					{file.name} · {formatVideoBytes(file.size)}
				</p>
			)}
			{sourceUrl && info && (
				<div className="space-y-2">
					<video
						src={sourceUrl}
						controls
						preload="metadata"
						className="w-full max-h-80 rounded-lg"
						aria-label="元の動画プレビュー"
					>
						<track kind="captions" />
					</video>
					<p className="text-sm">
						{info.width} × {info.height}px / {info.duration.toFixed(2)}秒 / 音声
						{info.audioTracks}トラック
					</p>
				</div>
			)}
			{info && (
				<fieldset
					disabled={processing}
					className="space-y-4 rounded-xl border p-4"
				>
					<legend className="px-2 font-semibold">圧縮設定</legend>
					<div className="grid gap-4 sm:grid-cols-2">
						<label className="space-y-1">
							圧縮方法
							<select
								className={fieldClass}
								value={settings.mode}
								onChange={(event) =>
									updateSettings({
										mode: event.target.value as 'quality' | 'size',
									})
								}
							>
								<option value="quality">品質を指定</option>
								<option value="size">目標容量を指定</option>
							</select>
						</label>
						{settings.mode === 'quality' ? (
							<label className="space-y-1">
								品質
								<select
									className={fieldClass}
									aria-label="品質"
									value={settings.quality}
									onChange={(event) =>
										updateSettings({
											quality: event.target.value as 'high' | 'medium' | 'low',
										})
									}
								>
									<option value="high">
										高品質（
										{qualityEstimate(
											info,
											{ settings, start, end },
											file?.size ?? 0,
											'high',
										)}
										）
									</option>
									<option value="medium">
										標準（
										{qualityEstimate(
											info,
											{ settings, start, end },
											file?.size ?? 0,
											'medium',
										)}
										）
									</option>
									<option value="low">
										低品質・小容量（
										{qualityEstimate(
											info,
											{ settings, start, end },
											file?.size ?? 0,
											'low',
										)}
										）
									</option>
								</select>
							</label>
						) : (
							<div className="space-y-2">
								<label>
									目標容量（MB）
									<input
										className={fieldClass}
										type="number"
										min="0.1"
										max="128"
										step="0.1"
										value={settings.targetMB}
										onChange={(event) =>
											updateSettings({ targetMB: Number(event.target.value) })
										}
									/>
								</label>
								<div className="flex flex-wrap gap-2">
									{[3, 10, 20, 50].map((value) => (
										<Button
											key={value}
											variant="outline"
											size="sm"
											onClick={() => updateSettings({ targetMB: value })}
										>
											{value} MB
										</Button>
									))}
								</div>
							</div>
						)}
						<label className="space-y-1">
							解像度（長辺の上限）
							<select
								className={fieldClass}
								value={settings.maxEdge}
								onChange={(event) =>
									updateSettings({ maxEdge: Number(event.target.value) })
								}
							>
								<option value="0">元のサイズ</option>
								<option value="1920">1920px</option>
								<option value="1280">1280px</option>
								<option value="854">854px</option>
							</select>
						</label>
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={settings.removeAudio}
								onChange={(event) =>
									updateSettings({ removeAudio: event.target.checked })
								}
							/>
							音声を削除
						</label>
					</div>
					{file && (
						<VideoTrimRange
							file={file}
							info={info}
							start={start}
							end={end}
							disabled={processing}
							onChange={(nextStart, nextEnd) => {
								setStart(nextStart);
								setEnd(nextEnd);
							}}
						/>
					)}
					<p className="text-sm text-muted-foreground">
						縦横比を維持し、拡大しません。映像は最大30fps、AAC音声は元の品質を保持し、その他の音声はAAC（最大2チャンネル・48kHz）に変換します。切り出しの音声境界にはサンプル単位の誤差があります。MB
						=
						1,000,000バイト。目標容量・推定容量・削減率は目安です。削減率は元のファイル全体との比較です。
					</p>
					{plan && (
						<p className="text-sm">
							出力 {plan.width} × {plan.height}px / {plan.duration.toFixed(2)}秒
							/ 映像 約{Math.round(plan.videoBitrate / 1000)}kbps / 推定{' '}
							{formatVideoBytes(plan.estimatedBytes)}
						</p>
					)}
					{planError && (
						<p role="alert" className="text-destructive">
							{planError}
						</p>
					)}
				</fieldset>
			)}
			<div className="flex flex-wrap gap-3">
				{info && (
					<Button disabled={processing || !plan} onClick={compress}>
						圧縮する
					</Button>
				)}
				{processing && (
					<Button variant="outline" onClick={cancel}>
						キャンセル
					</Button>
				)}
				{file && !processing && (
					<Button variant="outline" onClick={() => load(file)}>
						動画を読み直す
					</Button>
				)}
			</div>
			<div role="status" aria-live="polite">
				{status === 'loading'
					? '動画情報を読み込んでいます…'
					: status === 'compressing'
						? `圧縮中… ${progress}%`
						: status === 'done'
							? '圧縮が完了しました。'
							: notice}
			</div>
			{status === 'compressing' && (
				<progress
					value={progress}
					max="100"
					className="w-full"
					aria-label="圧縮の進捗"
				/>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			{result && file && (
				<section
					className="space-y-4 rounded-xl border p-4"
					aria-label="圧縮結果"
				>
					<h2 className="font-semibold">圧縮結果</h2>
					<p>
						元 {formatVideoBytes(file.size)} → 圧縮後{' '}
						{formatVideoBytes(result.size)} / 削減率{' '}
						{reductionPercent(file.size, result.size)}%
					</p>
					{result.size >= file.size && (
						<p>
							元の動画より容量が大きくなりました。品質・解像度を下げて再実行してください。
						</p>
					)}
					{result.target !== null && result.size > result.target && (
						<p role="alert">
							目標容量を超えました。容量を小さく設定するか、範囲を短くして再実行してください。
						</p>
					)}
					<video
						controls
						src={result.url}
						preload="metadata"
						className="w-full max-h-80 rounded-lg"
						aria-label="圧縮後の動画プレビュー"
					>
						<track kind="captions" />
					</video>
					<Button asChild>
						<a
							href={result.url}
							download={`${file.name.replace(/\.[^.]+$/, '')}-compressed.mp4`}
						>
							MP4をダウンロード
						</a>
					</Button>
				</section>
			)}
		</div>
	);
}
