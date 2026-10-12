import { Slider } from 'radix-ui';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { VideoInfo } from '@/lib/tools/video-compress';

export function VideoTrimRange({
	file,
	info,
	start,
	end,
	disabled,
	onChange,
}: {
	file: File;
	info: VideoInfo;
	start: number;
	end: number;
	disabled: boolean;
	onChange: (start: number, end: number) => void;
}) {
	const [frames, setFrames] = useState<string[]>([]);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let urls: string[] = [];
		let active = true;
		setFrames([]);
		setFailed(false);
		let worker: Worker;
		try {
			worker = new Worker(
				new URL('../../workers/video-thumbnails.worker.ts', import.meta.url),
				{ type: 'module' },
			);
			worker.onmessage = (event: MessageEvent<Blob[] | null>) => {
				if (!active) return;
				if (event.data) {
					urls = event.data.map((blob) => URL.createObjectURL(blob));
					setFrames(urls);
				} else setFailed(true);
				worker.terminate();
			};
			worker.onerror = () => {
				if (!active) return;
				setFailed(true);
				worker.terminate();
			};
			worker.postMessage({ file, info });
		} catch {
			setFailed(true);
		}
		return () => {
			active = false;
			worker?.terminate();
			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, [file, info]);
	const step = Math.min(0.01, info.duration / 100);
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-semibold">書き出し範囲</h3>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => onChange(0, info.duration)}
				>
					全範囲に戻す
				</Button>
			</div>
			<p className="text-sm text-muted-foreground">
				左右のハンドルで開始・終了位置を調整できます。矢印キーでも操作できます。
			</p>
			<Slider.Root
				className="relative flex h-20 w-full touch-none select-none items-center"
				min={0}
				max={info.duration}
				step={step}
				minStepsBetweenThumbs={1}
				value={[start, end]}
				disabled={disabled}
				onValueChange={(values) => onChange(values[0], values[1])}
			>
				<Slider.Track className="relative h-16 w-full overflow-hidden rounded-md bg-muted">
					<div
						className="absolute inset-0 flex"
						aria-hidden="true"
						data-testid="video-frames"
					>
						{frames.map((url, index) => (
							<img
								key={url}
								src={url}
								alt=""
								className={`h-full min-w-0 flex-1 object-cover ${[0, 2, 5, 7].includes(index) ? '' : 'hidden sm:block'}`}
							/>
						))}
					</div>
					<div
						className="absolute inset-y-0 left-0 bg-black/65"
						style={{ width: `${(start / info.duration) * 100}%` }}
					/>
					<div
						className="absolute inset-y-0 right-0 bg-black/65"
						style={{ width: `${(1 - end / info.duration) * 100}%` }}
					/>
					<Slider.Range className="absolute h-full border-y-2 border-primary bg-primary/10" />
				</Slider.Track>
				{['開始位置', '終了位置'].map((label) => (
					<Slider.Thumb
						key={label}
						aria-label={label}
						aria-valuetext={`${(label === '開始位置' ? start : end).toFixed(2)}秒`}
						className="block h-20 w-5 rounded border-2 border-background bg-primary shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					/>
				))}
			</Slider.Root>
			<div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums">
				<span>開始 {start.toFixed(2)}秒</span>
				<span>書き出し {(end - start).toFixed(2)}秒</span>
				<span>終了 {end.toFixed(2)}秒</span>
			</div>
			{frames.length === 0 && (
				<p className="text-xs text-muted-foreground">
					{failed
						? 'フレームを表示できません。範囲の調整・圧縮は引き続き利用できます。'
						: 'フレームを端末内で読み込んでいます…'}
				</p>
			)}
		</div>
	);
}
