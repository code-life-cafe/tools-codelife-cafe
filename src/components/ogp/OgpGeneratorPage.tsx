import {
	AlignCenter,
	AlignLeft,
	Download,
	ImagePlus,
	Lock,
	Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob, exportCanvas } from '@/lib/tools/image-common';
import {
	type BgKind,
	FONT_FAMILIES,
	type FontFamily,
	OGP_HEIGHT,
	OGP_WIDTH,
	type OgpSpec,
	type OgpTemplate,
	renderOgp,
	TEMPLATES,
} from '@/lib/tools/ogp';

// ---------------------------------------------------------------------------
// Helper: カラーピッカー + テキスト入力
// ---------------------------------------------------------------------------

function ColorField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
}) {
	const id = useId();
	const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			<div className="flex items-center gap-2">
				<input
					type="color"
					value={pickerValue}
					onChange={(e) => onChange(e.target.value)}
					className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
				/>
				<Input
					id={id}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className="font-mono"
					placeholder="#ffffff"
				/>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helper: 小さめの画像ドロップゾーン（ロゴ・背景用）
// ---------------------------------------------------------------------------

function MiniDropzone({
	onFile,
	label,
}: {
	onFile: (file: File) => void;
	label: string;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [isDragOver, setIsDragOver] = useState(false);

	return (
		<div>
			<button
				type="button"
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragOver(true);
				}}
				onDragLeave={(e) => {
					e.preventDefault();
					setIsDragOver(false);
				}}
				onDrop={(e) => {
					e.preventDefault();
					setIsDragOver(false);
					const file = e.dataTransfer.files[0];
					if (file) onFile(file);
				}}
				onClick={() => inputRef.current?.click()}
				className={`flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm transition-colors ${
					isDragOver
						? 'border-primary bg-primary/5'
						: 'border-border hover:border-primary/50'
				}`}
			>
				<ImagePlus className="h-4 w-4 text-muted-foreground" />
				<span className="text-muted-foreground">{label}</span>
			</button>
			<input
				ref={inputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) onFile(file);
					e.target.value = '';
				}}
				className="hidden"
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OgpGeneratorPage() {
	// テンプレート・背景
	const [template, setTemplate] = useState<OgpTemplate>('simple');
	const [bgType, setBgType] = useState<'solid' | 'gradient'>('solid');
	const [bgColor, setBgColor] = useState('#1e3a5f');
	const [gradFrom, setGradFrom] = useState('#1e3a5f');
	const [gradTo, setGradTo] = useState('#0f172a');
	const [bgImage, setBgImage] = useState<ImageBitmap | null>(null);
	const [overlay, setOverlay] = useState(0.5);

	// テキスト
	const [title, setTitle] = useState('');
	const [subtitle, setSubtitle] = useState('');
	const [textColor, setTextColor] = useState('#ffffff');
	const [align, setAlign] = useState<'left' | 'center'>('center');
	const [fontFamily, setFontFamily] = useState<FontFamily>('sans-serif');

	// ロゴ
	const [logo, setLogo] = useState<ImageBitmap | null>(null);

	// UI
	const [error, setError] = useState<string | null>(null);
	const previewRef = useRef<HTMLCanvasElement>(null);
	const bgImageRef = useRef<ImageBitmap | null>(null);
	const logoRef = useRef<ImageBitmap | null>(null);

	const fontId = useId();

	// -----------------------------------------------------------------------
	// 画像ハンドラー
	// -----------------------------------------------------------------------

	const handleBgImageFile = useCallback(async (file: File) => {
		try {
			const bitmap = await createImageBitmap(file);
			bgImageRef.current?.close();
			bgImageRef.current = bitmap;
			setBgImage(bitmap);
			setError(null);
		} catch {
			setError('背景画像の読み込みに失敗しました');
		}
	}, []);

	const clearBgImage = useCallback(() => {
		bgImageRef.current?.close();
		bgImageRef.current = null;
		setBgImage(null);
	}, []);

	const handleLogoFile = useCallback(async (file: File) => {
		try {
			const bitmap = await createImageBitmap(file);
			logoRef.current?.close();
			logoRef.current = bitmap;
			setLogo(bitmap);
			setError(null);
		} catch {
			setError('ロゴ画像の読み込みに失敗しました');
		}
	}, []);

	const clearLogo = useCallback(() => {
		logoRef.current?.close();
		logoRef.current = null;
		setLogo(null);
	}, []);

	useEffect(() => {
		return () => {
			bgImageRef.current?.close();
			logoRef.current?.close();
		};
	}, []);

	// -----------------------------------------------------------------------
	// Spec 構築
	// -----------------------------------------------------------------------

	const buildSpec = useCallback((): OgpSpec => {
		let background: BgKind;
		if (template === 'photo' && bgImage) {
			background = { type: 'image', bitmap: bgImage, overlay };
		} else if (bgType === 'gradient') {
			background = { type: 'gradient', from: gradFrom, to: gradTo };
		} else {
			background = { type: 'solid', color: bgColor };
		}

		return {
			template,
			background,
			title: title.trim() || 'タイトルを入力',
			subtitle: subtitle.trim() || undefined,
			textColor,
			align,
			logo: logo ?? undefined,
			fontFamily,
		};
	}, [
		template,
		bgImage,
		overlay,
		bgType,
		gradFrom,
		gradTo,
		bgColor,
		title,
		subtitle,
		textColor,
		align,
		logo,
		fontFamily,
	]);

	// -----------------------------------------------------------------------
	// プレビュー（debounce 150ms）
	// -----------------------------------------------------------------------

	useEffect(() => {
		const timer = setTimeout(() => {
			const spec = buildSpec();
			const offscreen = renderOgp(spec);
			const canvas = previewRef.current;
			if (!canvas) return;
			canvas.width = OGP_WIDTH;
			canvas.height = OGP_HEIGHT;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.clearRect(0, 0, OGP_WIDTH, OGP_HEIGHT);
				ctx.drawImage(offscreen, 0, 0);
			}
		}, 150);
		return () => clearTimeout(timer);
	}, [buildSpec]);

	// -----------------------------------------------------------------------
	// ダウンロード
	// -----------------------------------------------------------------------

	const handleDownload = useCallback(async () => {
		const spec = buildSpec();
		const canvas = renderOgp(spec);
		const blob = await exportCanvas(canvas, { format: 'png' });
		downloadBlob(blob, 'ogp.png');
	}, [buildSpec]);

	const canDownload = title.trim().length > 0;

	// -----------------------------------------------------------------------
	// Render
	// -----------------------------------------------------------------------

	return (
		<div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
			{/* Controls */}
			<div className="space-y-6">
				{/* エラー表示 */}
				{error && (
					<div
						role="alert"
						className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
					>
						{error}
					</div>
				)}

				{/* テンプレート選択 */}
				<section className="space-y-2">
					<Label>テンプレート</Label>
					<Tabs
						value={template}
						onValueChange={(v) => setTemplate(v as OgpTemplate)}
					>
						<TabsList className="w-full">
							{TEMPLATES.map((t) => (
								<TabsTrigger key={t.value} value={t.value} className="flex-1">
									{t.label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
				</section>

				{/* 背景設定 */}
				<section className="space-y-3">
					<Label>背景</Label>

					{template === 'photo' ? (
						<div className="space-y-3">
							{bgImage ? (
								<div className="flex items-center justify-between rounded-lg border border-border p-3">
									<span className="text-sm text-muted-foreground">
										背景画像を設定済み
									</span>
									<Button variant="ghost" size="sm" onClick={clearBgImage}>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							) : (
								<MiniDropzone
									onFile={handleBgImageFile}
									label="背景画像をドロップまたはクリック"
								/>
							)}
							{bgImage && (
								<div className="space-y-1.5">
									<Label>暗幕オーバーレイ: {Math.round(overlay * 100)}%</Label>
									<Slider
										value={[overlay * 100]}
										onValueChange={(v) => setOverlay(v[0] / 100)}
										min={0}
										max={90}
										step={5}
									/>
								</div>
							)}
						</div>
					) : (
						<div className="space-y-3">
							<div className="flex gap-1">
								<Button
									variant={bgType === 'solid' ? 'default' : 'outline'}
									size="sm"
									onClick={() => setBgType('solid')}
								>
									単色
								</Button>
								<Button
									variant={bgType === 'gradient' ? 'default' : 'outline'}
									size="sm"
									onClick={() => setBgType('gradient')}
								>
									グラデーション
								</Button>
							</div>
							{bgType === 'solid' ? (
								<ColorField
									label="背景色"
									value={bgColor}
									onChange={setBgColor}
								/>
							) : (
								<div className="grid grid-cols-2 gap-3">
									<ColorField
										label="開始色"
										value={gradFrom}
										onChange={setGradFrom}
									/>
									<ColorField
										label="終了色"
										value={gradTo}
										onChange={setGradTo}
									/>
								</div>
							)}
						</div>
					)}
				</section>

				{/* テキスト入力 */}
				<section className="space-y-3">
					<div className="space-y-1.5">
						<div className="flex items-baseline justify-between">
							<Label htmlFor="ogp-title">タイトル</Label>
							<span className="text-xs text-muted-foreground">
								{Array.from(title).length} 文字（推奨 20〜40）
							</span>
						</div>
						<Textarea
							id="ogp-title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="記事タイトルやキャッチコピーを入力"
							rows={3}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="ogp-subtitle">サブタイトル（任意）</Label>
						<Input
							id="ogp-subtitle"
							value={subtitle}
							onChange={(e) => setSubtitle(e.target.value)}
							placeholder="サイト名やカテゴリなど"
						/>
					</div>
				</section>

				{/* 文字スタイル */}
				<section className="space-y-3">
					<div className="grid grid-cols-2 gap-3">
						<ColorField
							label="文字色"
							value={textColor}
							onChange={setTextColor}
						/>
						<div className="space-y-1.5">
							<Label>揃え</Label>
							<div className="flex gap-1">
								<Button
									variant={align === 'left' ? 'default' : 'outline'}
									size="sm"
									onClick={() => setAlign('left')}
									aria-label="左揃え"
								>
									<AlignLeft className="h-4 w-4" />
								</Button>
								<Button
									variant={align === 'center' ? 'default' : 'outline'}
									size="sm"
									onClick={() => setAlign('center')}
									aria-label="中央揃え"
								>
									<AlignCenter className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={fontId}>フォント</Label>
						<select
							id={fontId}
							value={fontFamily}
							onChange={(e) => setFontFamily(e.target.value as FontFamily)}
							className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-1"
						>
							{FONT_FAMILIES.map((f) => (
								<option key={f.value} value={f.value}>
									{f.label}
								</option>
							))}
						</select>
					</div>
				</section>

				{/* ロゴ */}
				<section className="space-y-2">
					<Label>ロゴ（任意）</Label>
					{logo ? (
						<div className="flex items-center justify-between rounded-lg border border-border p-3">
							<span className="text-sm text-muted-foreground">
								ロゴを設定済み
							</span>
							<Button variant="ghost" size="sm" onClick={clearLogo}>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					) : (
						<MiniDropzone
							onFile={handleLogoFile}
							label="ロゴ画像をドロップまたはクリック"
						/>
					)}
				</section>
			</div>

			{/* Preview + Download */}
			<div className="space-y-4">
				<div className="overflow-hidden rounded-xl border border-border">
					<canvas
						ref={previewRef}
						data-testid="ogp-preview"
						className="w-full"
						style={{ aspectRatio: `${OGP_WIDTH}/${OGP_HEIGHT}` }}
					/>
				</div>

				<Button
					onClick={handleDownload}
					disabled={!canDownload}
					className="w-full"
					size="lg"
				>
					<Download className="mr-2 h-4 w-4" />
					PNGダウンロード（1200×630）
				</Button>

				<p className="text-center text-xs text-muted-foreground">
					※ Twitter / Facebook では画像の端がトリミングされる場合があります
				</p>

				<p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
					<Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
					アップロードした画像・入力はサーバーに送信されません。すべてブラウザ内で処理されます。
				</p>
			</div>
		</div>
	);
}
