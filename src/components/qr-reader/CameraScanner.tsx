import { AlertTriangle, ImageIcon, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { decodeFrame, terminateWorker } from '@/lib/tools/qr-reader';

const DECODE_INTERVAL_MS = 200; // 150-250ms の範囲でスロットリング
const SAME_VALUE_DEDUPE_MS = 1500;

interface CameraScannerProps {
	onDetected: (value: string) => void;
	onSwitchToImageMode: () => void;
}

type CameraStatus = 'starting' | 'active' | 'denied' | 'unsupported' | 'error';

export default function CameraScanner({
	onDetected,
	onSwitchToImageMode,
}: CameraScannerProps) {
	const [status, setStatus] = useState<CameraStatus>('starting');
	const videoRef = useRef<HTMLVideoElement>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const rafRef = useRef<number | null>(null);
	const decodingRef = useRef(false); // Worker への同時リクエストを1件までに制限
	const cancelledRef = useRef(false); // getUserMedia 応答待ち中のアンマウント/停止を検知
	const lastDecodeAtRef = useRef(0);
	const lastValueRef = useRef<{ value: string; at: number } | null>(null);
	const onDetectedRef = useRef(onDetected);
	onDetectedRef.current = onDetected;

	// --- カメラ停止（トラック停止 + Worker 終了） ---
	const stopCamera = useCallback(() => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		terminateWorker();
		// Worker終了時に確実に応答が来るとは限らないため、次回起動時に
		// captureAndDecodeLoop が固まらないようここでも明示的に解除する
		decodingRef.current = false;
		// getUserMedia の応答待ち中に呼ばれた場合、後から解決するストリームを破棄する
		cancelledRef.current = true;
	}, []);

	const captureAndDecodeLoop = useCallback(() => {
		const loop = () => {
			rafRef.current = requestAnimationFrame(loop);

			const video = videoRef.current;
			if (!video || video.readyState < video.HAVE_CURRENT_DATA) return;

			const now = performance.now();
			if (now - lastDecodeAtRef.current < DECODE_INTERVAL_MS) return;
			if (decodingRef.current) return; // バックプレッシャー: 1件までに制限、フレームはキューしない

			lastDecodeAtRef.current = now;

			if (!canvasRef.current) {
				canvasRef.current = document.createElement('canvas');
			}
			const canvas = canvasRef.current;
			const width = video.videoWidth;
			const height = video.videoHeight;
			if (width === 0 || height === 0) return;

			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.drawImage(video, 0, 0, width, height);

			let imageData: ImageData;
			try {
				imageData = ctx.getImageData(0, 0, width, height);
			} catch {
				return;
			}

			decodingRef.current = true;
			decodeFrame(imageData)
				.then((symbols) => {
					if (symbols.length === 0) return;
					const value = symbols[0].text;
					const last = lastValueRef.current;
					const nowMs = Date.now();
					if (
						last &&
						last.value === value &&
						nowMs - last.at < SAME_VALUE_DEDUPE_MS
					) {
						return;
					}
					lastValueRef.current = { value, at: nowMs };
					onDetectedRef.current(value);
				})
				.catch(() => {
					// デコードエラーはフレーム単位で無視して継続
				})
				.finally(() => {
					decodingRef.current = false;
				});
		};
		rafRef.current = requestAnimationFrame(loop);
	}, []);

	const startCamera = useCallback(async () => {
		if (!navigator.mediaDevices?.getUserMedia) {
			setStatus('unsupported');
			return;
		}
		setStatus('starting');
		cancelledRef.current = false;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' } },
				audio: false,
			});
			// 許可待ちの間にアンマウント/モード切替/非表示でstopCameraが
			// 先に呼ばれている場合、このストリームをバックグラウンドで
			// 動かし続けないよう即座に破棄する
			if (cancelledRef.current) {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				return;
			}
			streamRef.current = stream;
			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				await videoRef.current.play().catch(() => {
					// 一部ブラウザは play() を Promise 拒否するが再生自体は継続する
				});
			}
			if (cancelledRef.current) {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				streamRef.current = null;
				return;
			}
			setStatus('active');
			captureAndDecodeLoop();
		} catch (err) {
			if (
				err instanceof DOMException &&
				(err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
			) {
				setStatus('denied');
			} else {
				setStatus('error');
			}
		}
	}, [captureAndDecodeLoop]);

	// --- マウント時に開始、アンマウント時にトラック停止 + Worker 終了 ---
	useEffect(() => {
		startCamera();
		return () => {
			stopCamera();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// --- タブが非表示になったらカメラを停止（再表示時は再開しない: 明示的な再開が必要）---
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.hidden) {
				stopCamera();
				setStatus('starting');
			} else if (status !== 'denied' && status !== 'unsupported') {
				startCamera();
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () =>
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [status]);

	if (status === 'denied') {
		return (
			<div className="rounded-xl border border-destructive/50 bg-destructive/5 p-6 text-center space-y-3">
				<AlertTriangle
					className="mx-auto h-8 w-8 text-destructive"
					aria-hidden="true"
				/>
				<p className="text-sm text-foreground">
					カメラへのアクセスが許可されませんでした。ブラウザの設定でカメラの許可を有効にするか、画像アップロードで読み取ってください。
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={onSwitchToImageMode}
					className="gap-1.5"
				>
					<ImageIcon className="h-4 w-4" aria-hidden="true" />
					画像から読み取りに切り替える
				</Button>
			</div>
		);
	}

	if (status === 'unsupported') {
		return (
			<div className="rounded-xl border border-destructive/50 bg-destructive/5 p-6 text-center space-y-3">
				<AlertTriangle
					className="mx-auto h-8 w-8 text-destructive"
					aria-hidden="true"
				/>
				<p className="text-sm text-foreground">
					このブラウザまたは環境ではカメラ機能を利用できません。画像アップロードで読み取ってください。
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={onSwitchToImageMode}
					className="gap-1.5"
				>
					<ImageIcon className="h-4 w-4" aria-hidden="true" />
					画像から読み取りに切り替える
				</Button>
			</div>
		);
	}

	if (status === 'error') {
		return (
			<div className="rounded-xl border border-destructive/50 bg-destructive/5 p-6 text-center space-y-3">
				<AlertTriangle
					className="mx-auto h-8 w-8 text-destructive"
					aria-hidden="true"
				/>
				<p className="text-sm text-foreground">
					カメラの起動に失敗しました。別のアプリがカメラを使用していないかご確認のうえ、再度お試しください。
				</p>
				<Button variant="outline" size="sm" onClick={startCamera}>
					再試行
				</Button>
			</div>
		);
	}

	return (
		<div className="relative overflow-hidden rounded-xl border border-border bg-black aspect-video">
			{/* biome-ignore lint/a11y/useMediaCaption: カメラプレビューには音声トラックがない */}
			<video
				ref={videoRef}
				playsInline
				autoPlay
				muted
				className="h-full w-full object-cover"
			/>
			{status === 'starting' && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/40">
					<Loader2
						className="h-8 w-8 animate-spin text-white"
						aria-hidden="true"
					/>
				</div>
			)}
			{status === 'active' && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="h-2/3 w-2/3 rounded-2xl border-2 border-white/70" />
				</div>
			)}
		</div>
	);
}
