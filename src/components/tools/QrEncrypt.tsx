import {
	AlertTriangle,
	Download,
	Eye,
	EyeOff,
	Info,
	Loader2,
	Lock,
	Maximize2,
	QrCode as QrCodeIcon,
	RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import CameraScanner from '@/components/qr-reader/CameraScanner';
import ImageUploader from '@/components/qr-reader/ImageUploader';
import ModeTabs, { type ScanMode } from '@/components/qr-reader/ModeTabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import {
	type CapacityEstimate,
	type DecryptFailureReason,
	decryptQrPayload,
	type EncryptFailureReason,
	encryptToQrPayload,
	estimateCapacity,
	estimatePassphraseStrength,
	isPracticalScanWarning,
	MAX_PLAINTEXT_BYTES,
	MAX_QR_PAYLOAD_BYTES,
	type PassphraseStrength,
} from '@/lib/tools/qr-encrypt';
import { qrEncryptMcpTool } from '@/lib/tools/qr-encrypt.mcp';
import {
	downloadDataUrl,
	downloadSvg,
	generateQRDataUrl,
	generateQRSvg,
	MIN_QR_SCALE,
} from '@/lib/tools/qr-generator';
import { provideToolsFromFactory } from '@/lib/webmcp';
import { generateWebMcpDescriptor } from '@/lib/webmcp/descriptor-generator';

// プレビュー枠のCSS表示サイズ（実際の生成解像度とは独立。実解像度は scale で決まる）
const PREVIEW_DISPLAY_SIZE = 400;

// 容量計算はECC Lを前提にしているため固定（サイズ/色/誤り訂正レベルはMVPでは非対応）
// PNGはsize指定ではなくscale指定にし、高密度QRでもモジュールあたり8px以上を保証する
const QR_OPTIONS = {
	size: 400 as const,
	scale: MIN_QR_SCALE,
	errorCorrection: 'L' as const,
	foregroundColor: '#000000',
	backgroundColor: '#FFFFFF',
};

const ENCRYPT_ERROR_MESSAGES: Record<EncryptFailureReason, string> = {
	'empty-plaintext': 'テキストを入力してください。',
	'plaintext-too-large': `入力テキストが上限（${Math.floor(MAX_PLAINTEXT_BYTES / 1024)}KB）を超えています。テキストを短くしてください。`,
	'payload-too-large': `暗号化後のデータがQRコードの上限（${MAX_QR_PAYLOAD_BYTES}バイト）を超えました。テキストを短くしてください。`,
};

const DECRYPT_ERROR_MESSAGES: Record<DecryptFailureReason, string> = {
	'invalid-format':
		'QRデータの形式が正しくありません。本ツール（/qr-encrypt）で生成されたQRコードかご確認ください。',
	'unsupported-version':
		'未対応の形式です（対応していないバージョンのQRデータです）。',
	'unsupported-kdf':
		'未対応の形式です（対応していない鍵導出方式のQRデータです）。',
	'invalid-passphrase-or-corrupted':
		'パスフレーズが間違っているか、QRデータが破損しています。',
};

const STRENGTH_LABEL: Record<PassphraseStrength, string> = {
	weak: '弱い（8文字以上を推奨）',
	medium: '普通',
	strong: '強い',
};

const STRENGTH_BAR_CLASS: Record<PassphraseStrength, string> = {
	weak: 'w-1/3 bg-destructive',
	medium: 'w-2/3 bg-yellow-500',
	strong: 'w-full bg-safety',
};

function PassphraseField({
	id,
	label,
	value,
	onChange,
	showStrength,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	showStrength?: boolean;
}) {
	const [visible, setVisible] = useState(false);
	const strength = estimatePassphraseStrength(value);

	return (
		<div>
			<Label htmlFor={id} className="text-sm font-medium mb-2 block">
				{label}
			</Label>
			<div className="flex items-center gap-2">
				<Input
					id={id}
					type={visible ? 'text' : 'password'}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="共有するパスフレーズ"
					autoComplete="off"
					className="rounded-xl focus:ring-2 focus:ring-primary"
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={() => setVisible((v) => !v)}
					aria-label={visible ? 'パスフレーズを隠す' : 'パスフレーズを表示する'}
				>
					{visible ? (
						<EyeOff className="h-4 w-4" aria-hidden="true" />
					) : (
						<Eye className="h-4 w-4" aria-hidden="true" />
					)}
				</Button>
			</div>
			{showStrength && value.length > 0 && (
				<div className="mt-2 space-y-1">
					<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						<div
							className={`h-full transition-all ${STRENGTH_BAR_CLASS[strength]}`}
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						強度: {STRENGTH_LABEL[strength]}
					</p>
				</div>
			)}
		</div>
	);
}

function EncryptTab() {
	const { trackRun } = useToolAnalytics('qr-encrypt');
	const [plaintext, setPlaintext] = useState('');
	const [passphrase, setPassphrase] = useState('');
	const [capacity, setCapacity] = useState<CapacityEstimate | null>(null);
	const [processing, setProcessing] = useState(false);
	const [qrDataUrl, setQrDataUrl] = useState('');
	const [qrSvg, setQrSvg] = useState('');
	const [payloadBytes, setPayloadBytes] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [zoomOpen, setZoomOpen] = useState(false);

	// 使用量メーターはリアルタイム更新するが、PBKDF2を含む実暗号化は行わない
	// （estimateCapacityは圧縮のみでバイト数を決定論的に見積もる軽量処理）
	useEffect(() => {
		let cancelled = false;
		if (!plaintext) {
			setCapacity(null);
			return;
		}
		estimateCapacity(plaintext).then((result) => {
			if (!cancelled) setCapacity(result);
		});
		return () => {
			cancelled = true;
		};
	}, [plaintext]);

	const handleGenerate = useCallback(async () => {
		setError(null);
		setQrDataUrl('');
		setQrSvg('');
		setProcessing(true);
		try {
			const result = await encryptToQrPayload(plaintext, passphrase);
			if (!result.ok) {
				setError(ENCRYPT_ERROR_MESSAGES[result.reason]);
				setPayloadBytes(result.payloadBytes ?? 0);
				return;
			}
			const [dataUrl, svg] = await Promise.all([
				generateQRDataUrl(result.envelope, QR_OPTIONS),
				generateQRSvg(result.envelope, QR_OPTIONS),
			]);
			setQrDataUrl(dataUrl);
			setQrSvg(svg);
			setPayloadBytes(result.payloadBytes);
			trackRun();
		} catch {
			setError(
				'QRコードの生成に失敗しました。時間をおいて再度お試しください。',
			);
		} finally {
			setProcessing(false);
		}
	}, [plaintext, passphrase, trackRun]);

	const plaintextBytes = new TextEncoder().encode(plaintext).length;
	const isPlaintextTooLarge = plaintextBytes > MAX_PLAINTEXT_BYTES;
	const canGenerate =
		plaintext.trim().length > 0 &&
		passphrase.length > 0 &&
		!isPlaintextTooLarge;

	return (
		<div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
			<div className="lg:col-span-7 space-y-6">
				<div>
					<div className="flex justify-between items-center mb-2 min-h-6">
						<Label className="text-sm font-medium block">
							暗号化するテキスト
						</Label>
						<span
							className={`text-xs ${isPlaintextTooLarge ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}
						>
							{plaintextBytes.toLocaleString()} /{' '}
							{MAX_PLAINTEXT_BYTES.toLocaleString()} bytes
						</span>
					</div>
					<Textarea
						value={plaintext}
						onChange={(e) => setPlaintext(e.target.value)}
						placeholder="QRコードにして共有したい秘密のメッセージを入力してください"
						className="min-h-[160px] rounded-xl focus:ring-2 focus:ring-primary"
					/>
				</div>

				<PassphraseField
					id="qr-encrypt-passphrase"
					label="パスフレーズ"
					value={passphrase}
					onChange={setPassphrase}
					showStrength
				/>

				{capacity && (
					<div>
						<div className="flex justify-between items-center mb-1 text-xs text-muted-foreground">
							<span>QRペイロード使用量（暗号化後の見積もり）</span>
							<span
								className={
									!capacity.withinLimit ? 'text-destructive font-semibold' : ''
								}
							>
								{capacity.payloadBytes.toLocaleString()} /{' '}
								{capacity.limitBytes.toLocaleString()} bytes
							</span>
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className={`h-full transition-all ${
									!capacity.withinLimit
										? 'bg-destructive'
										: capacity.practicalScanWarning
											? 'bg-yellow-500'
											: 'bg-primary'
								}`}
								style={{ width: `${Math.min(100, capacity.usedRatio * 100)}%` }}
							/>
						</div>
						{!capacity.withinLimit && (
							<p className="mt-1 text-xs text-destructive">
								上限を
								{(capacity.payloadBytes - capacity.limitBytes).toLocaleString()}
								バイト超過しています。テキストを短くしてください。
							</p>
						)}
						{capacity.withinLimit && capacity.practicalScanWarning && (
							<p className="mt-1 text-xs text-yellow-700 dark:text-yellow-500">
								このサイズは画面表示では読み取りにくい可能性があります。拡大表示・PNG/SVGの高解像度出力、または印刷を推奨します。
							</p>
						)}
					</div>
				)}

				<Button
					onClick={handleGenerate}
					disabled={!canGenerate || processing}
					className="rounded-xl"
				>
					{processing ? (
						<>
							<Loader2
								className="h-4 w-4 mr-1 animate-spin"
								aria-hidden="true"
							/>
							暗号化中...
						</>
					) : (
						<>
							<Lock className="h-4 w-4 mr-1" aria-hidden="true" />
							暗号化してQR生成
						</>
					)}
				</Button>

				{error && (
					<div className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
						<AlertTriangle
							className="h-4 w-4 shrink-0 mt-0.5"
							aria-hidden="true"
						/>
						<span>{error}</span>
					</div>
				)}

				<div className="flex flex-wrap gap-3">
					<Button
						onClick={() => downloadDataUrl(qrDataUrl, 'qr-encrypt.png')}
						disabled={!qrDataUrl}
						variant="outline"
						className="rounded-xl"
					>
						<Download className="h-4 w-4 mr-1" aria-hidden="true" />
						PNG ダウンロード
					</Button>
					<Button
						onClick={() => downloadSvg(qrSvg, 'qr-encrypt.svg')}
						disabled={!qrSvg}
						variant="outline"
						className="rounded-xl"
					>
						<Download className="h-4 w-4 mr-1" aria-hidden="true" />
						SVG ダウンロード
					</Button>
				</div>
			</div>

			<div className="lg:col-span-5 h-full">
				<Card className="rounded-xl h-full min-h-[300px] flex flex-col justify-center">
					<CardContent className="flex flex-col items-center justify-center p-8 w-full">
						{qrDataUrl ? (
							<div className="w-full flex flex-col items-center">
								<img
									src={qrDataUrl}
									alt="暗号化QRコード"
									className="max-w-full rounded-lg shimmer aspect-square object-contain"
									style={{ width: PREVIEW_DISPLAY_SIZE, maxHeight: '350px' }}
								/>
								<p className="mt-3 text-xs text-muted-foreground">
									ペイロード: {payloadBytes.toLocaleString()} bytes
								</p>
								<Button
									type="button"
									variant={
										isPracticalScanWarning(payloadBytes) ? 'default' : 'outline'
									}
									size="sm"
									onClick={() => setZoomOpen(true)}
									className="mt-3 rounded-xl"
								>
									<Maximize2 className="h-4 w-4 mr-1" aria-hidden="true" />
									拡大表示
								</Button>
							</div>
						) : (
							<div className="flex flex-col items-center justify-center text-muted-foreground">
								<QrCodeIcon
									className="h-16 w-16 mb-4 opacity-30"
									aria-hidden="true"
								/>
								<p className="text-sm text-center">
									テキストとパスフレーズを入力して
									<br className="sm:hidden" />
									「暗号化してQR生成」を押してください
								</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
				<DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] flex-col items-center gap-4 p-4 sm:max-w-[95vw]">
					<DialogHeader>
						<DialogTitle>暗号化QRコード（拡大表示）</DialogTitle>
					</DialogHeader>
					<div className="flex w-full flex-1 items-center justify-center overflow-auto">
						{qrDataUrl && (
							<img
								src={qrDataUrl}
								alt="暗号化QRコード（拡大表示）"
								className="max-h-full max-w-full object-contain"
							/>
						)}
					</div>
					<p className="text-xs text-muted-foreground">
						ペイロード: {payloadBytes.toLocaleString()} bytes
					</p>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function DecryptTab() {
	const { trackRun } = useToolAnalytics('qr-encrypt');
	const [mode, setMode] = useState<ScanMode>('camera');
	const [scannedPayload, setScannedPayload] = useState('');
	const [passphrase, setPassphrase] = useState('');
	const [processing, setProcessing] = useState(false);
	const [plaintext, setPlaintext] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleScanned = useCallback((value: string) => {
		setScannedPayload(value);
		setPlaintext(null);
		setError(null);
	}, []);

	const handleImageDecoded = useCallback(
		(_fileName: string, values: string[]) => {
			if (values.length > 0) handleScanned(values[0]);
		},
		[handleScanned],
	);

	const handleRescan = useCallback(() => {
		setScannedPayload('');
		setPlaintext(null);
		setError(null);
	}, []);

	const handleDecrypt = useCallback(async () => {
		setError(null);
		setPlaintext(null);
		setProcessing(true);
		try {
			const result = await decryptQrPayload(scannedPayload, passphrase);
			if (!result.ok) {
				setError(DECRYPT_ERROR_MESSAGES[result.reason]);
				return;
			}
			setPlaintext(result.plaintext);
			trackRun();
		} finally {
			setProcessing(false);
		}
	}, [scannedPayload, passphrase, trackRun]);

	return (
		<div className="space-y-6">
			{!scannedPayload ? (
				<>
					<ModeTabs mode={mode} onModeChange={setMode} />
					<div>
						{mode === 'camera' ? (
							<CameraScanner
								key="camera"
								onDetected={handleScanned}
								onSwitchToImageMode={() => setMode('image')}
							/>
						) : (
							<ImageUploader onDecoded={handleImageDecoded} />
						)}
					</div>
				</>
			) : (
				<div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm">
					<div className="flex items-center gap-2 min-w-0">
						<QrCodeIcon
							className="h-4 w-4 shrink-0 text-safety"
							aria-hidden="true"
						/>
						<span className="truncate">QRコードを読み取りました</span>
					</div>
					<Button variant="outline" size="sm" onClick={handleRescan}>
						<RotateCcw className="h-4 w-4 mr-1" aria-hidden="true" />
						読み取り直す
					</Button>
				</div>
			)}

			<PassphraseField
				id="qr-decrypt-passphrase"
				label="パスフレーズ"
				value={passphrase}
				onChange={setPassphrase}
			/>

			<Button
				onClick={handleDecrypt}
				disabled={!scannedPayload || !passphrase || processing}
				className="rounded-xl"
			>
				{processing ? (
					<>
						<Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
						復号中...
					</>
				) : (
					<>
						<Lock className="h-4 w-4 mr-1" aria-hidden="true" />
						復号する
					</>
				)}
			</Button>

			{error && (
				<div className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
					<AlertTriangle
						className="h-4 w-4 shrink-0 mt-0.5"
						aria-hidden="true"
					/>
					<span>{error}</span>
				</div>
			)}

			{plaintext !== null && (
				<div>
					<div className="flex items-center justify-between mb-2">
						<Label className="text-sm font-medium">復号結果</Label>
						<CopyButton text={plaintext} />
					</div>
					<Textarea
						value={plaintext}
						readOnly
						className="min-h-[120px] rounded-xl bg-muted/50 shimmer"
					/>
				</div>
			)}
		</div>
	);
}

export default function QrEncrypt() {
	useEffect(() => {
		return provideToolsFromFactory([
			generateWebMcpDescriptor(qrEncryptMcpTool),
		]);
	}, []);

	return (
		<div className="space-y-6">
			<div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
				<Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
				<p>
					入力データはサーバーへ送信されません。すべての暗号化・復号処理はこの端末のブラウザ内で完結します。パスフレーズは保存されないため、忘れると復号できなくなります。
				</p>
			</div>

			<Tabs defaultValue="encrypt">
				<div className="flex justify-center sm:justify-start">
					<TabsList className="mb-4 bg-muted/50 p-1 rounded-xl">
						<TabsTrigger
							value="encrypt"
							className="rounded-lg px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all font-medium"
						>
							暗号化してQR生成
						</TabsTrigger>
						<TabsTrigger
							value="decrypt"
							className="rounded-lg px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all font-medium"
						>
							QRを読み取って復号
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="encrypt" className="mt-0">
					<EncryptTab />
				</TabsContent>
				<TabsContent value="decrypt" className="mt-0">
					<DecryptTab />
				</TabsContent>
			</Tabs>
		</div>
	);
}
