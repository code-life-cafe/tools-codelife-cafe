import { AlertCircle, Download, ImageIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	defaultOptions,
	downloadDataUrl,
	downloadSvg,
	type ErrorCorrectionLevel,
	generateQRDataUrl,
	generateQRSvg,
	type QROptions,
	type QRSize,
} from '@/lib/tools/qr-generator';

function hexToRgb(hex: string) {
	const h = hex.replace('#', '');
	const bigint = parseInt(h, 16);
	return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function getLuminance(r: number, g: number, b: number) {
	const a = [r, g, b].map((v) => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrastRatio(hex1: string, hex2: string) {
	try {
		const rgb1 = hexToRgb(hex1);
		const rgb2 = hexToRgb(hex2);
		const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
		const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
		const brightest = Math.max(lum1, lum2);
		const darkest = Math.min(lum1, lum2);
		return (brightest + 0.05) / (darkest + 0.05);
	} catch (_e) {
		return 21;
	}
}

export default function QrGenerator() {
	const { trackRun } = useToolAnalytics('qr-generator');
	const [text, setText] = useState('');
	const [options, setOptions] = useState<QROptions>(defaultOptions);
	const [qrDataUrl, setQrDataUrl] = useState('');
	const [qrSvg, setQrSvg] = useState('');

	const contrastRatio = useMemo(() => {
		return getContrastRatio(options.foregroundColor, options.backgroundColor);
	}, [options.foregroundColor, options.backgroundColor]);

	const isLowContrast = contrastRatio < 3.0;

	// Real-time QR generation
	useEffect(() => {
		if (!text.trim()) {
			setQrDataUrl('');
			setQrSvg('');
			return;
		}

		const timer = setTimeout(async () => {
			try {
				const [dataUrl, svg] = await Promise.all([
					generateQRDataUrl(text, options),
					generateQRSvg(text, options),
				]);
				setQrDataUrl(dataUrl);
				setQrSvg(svg);
				trackRun();
			} catch {
				// ignore
			}
		}, 150);

		return () => clearTimeout(timer);
	}, [text, options, trackRun]);

	const handleDownloadPng = useCallback(() => {
		if (qrDataUrl) downloadDataUrl(qrDataUrl, 'qrcode.png');
	}, [qrDataUrl]);

	const handleDownloadSvg = useCallback(() => {
		if (qrSvg) downloadSvg(qrSvg, 'qrcode.svg');
	}, [qrSvg]);

	return (
		<div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
			{/* Left Column: Settings */}
			<div className="lg:col-span-7 space-y-6">
				{/* Input */}
				<div>
					<Label className="text-sm font-medium mb-2 block">
						URLまたはテキスト
					</Label>
					<Input
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="https://tools.codelife.cafe"
						className="rounded-xl focus:ring-2 focus:ring-primary"
					/>
				</div>

				{/* Options */}
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<Label className="text-sm mb-2 block">サイズ</Label>
						<Select
							value={String(options.size)}
							onValueChange={(v) =>
								setOptions((prev) => ({ ...prev, size: Number(v) as QRSize }))
							}
						>
							<SelectTrigger className="rounded-xl">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="200">S (200px)</SelectItem>
								<SelectItem value="400">M (400px)</SelectItem>
								<SelectItem value="600">L (600px)</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div>
						<Label className="text-sm mb-2 block">エラー訂正レベル</Label>
						<Select
							value={options.errorCorrection}
							onValueChange={(v) =>
								setOptions((prev) => ({
									...prev,
									errorCorrection: v as ErrorCorrectionLevel,
								}))
							}
						>
							<SelectTrigger className="rounded-xl">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="L">L（低）</SelectItem>
								<SelectItem value="M">M（中）</SelectItem>
								<SelectItem value="Q">Q（中高）</SelectItem>
								<SelectItem value="H">H（高）</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div>
						<Label className="text-sm mb-2 block">前景色</Label>
						<div className="flex items-center gap-2">
							<input
								type="color"
								value={options.foregroundColor}
								onChange={(e) =>
									setOptions((prev) => ({
										...prev,
										foregroundColor: e.target.value,
									}))
								}
								className="h-10 w-10 min-w-10 rounded border border-border cursor-pointer p-0.5"
							/>
							<Input
								value={options.foregroundColor}
								onChange={(e) =>
									setOptions((prev) => ({
										...prev,
										foregroundColor: e.target.value,
									}))
								}
								className="rounded-xl"
							/>
						</div>
					</div>
					<div>
						<Label className="text-sm mb-2 block">背景色</Label>
						<div className="flex items-center gap-2">
							<input
								type="color"
								value={options.backgroundColor}
								onChange={(e) =>
									setOptions((prev) => ({
										...prev,
										backgroundColor: e.target.value,
									}))
								}
								className="h-10 w-10 min-w-10 rounded border border-border cursor-pointer p-0.5"
							/>
							<Input
								value={options.backgroundColor}
								onChange={(e) =>
									setOptions((prev) => ({
										...prev,
										backgroundColor: e.target.value,
									}))
								}
								className="rounded-xl"
							/>
						</div>
					</div>
				</div>

				{/* Download Buttons */}
				<div className="flex flex-wrap gap-3">
					<Button
						onClick={handleDownloadPng}
						disabled={!qrDataUrl}
						className="rounded-xl"
					>
						<Download className="h-4 w-4 mr-1" />
						PNG ダウンロード
					</Button>
					<Button
						onClick={handleDownloadSvg}
						disabled={!qrSvg}
						variant="outline"
						className="rounded-xl"
					>
						<Download className="h-4 w-4 mr-1" />
						SVG ダウンロード
					</Button>
				</div>
			</div>

			{/* Right Column: Preview */}
			<div className="lg:col-span-5 h-full">
				<Card className="rounded-xl h-full min-h-[300px] flex flex-col justify-center">
					<CardContent className="flex flex-col items-center justify-center p-8 w-full">
						{qrDataUrl ? (
							<div className="w-full flex flex-col items-center">
								<img
									src={qrDataUrl}
									alt="QRコード"
									className="max-w-full rounded-lg shimmer aspect-square object-contain"
									style={{ width: options.size, maxHeight: '350px' }}
								/>
								{isLowContrast && (
									<div className="mt-6 flex flex-col items-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-950/30 p-3 rounded-lg border border-yellow-200 dark:border-yellow-900 w-full text-center max-w-sm">
										<AlertCircle className="h-5 w-5" />
										<p className="font-semibold">コントラストが低すぎます</p>
										<p className="text-xs opacity-90">
											QRコードが正しく読み取れない可能性があります。コントラスト比を高めてください。
										</p>
									</div>
								)}
							</div>
						) : (
							<div className="flex flex-col items-center justify-center text-muted-foreground">
								<ImageIcon className="h-16 w-16 mb-4 opacity-30" />
								<p className="text-sm text-center">
									テキストを入力すると
									<br className="sm:hidden" />
									QRコードが表示されます
								</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
