import { useEffect, useId, useMemo, useRef, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
	computeHmac,
	HMAC_ALGORITHM_LABELS,
	HMAC_ALGORITHMS,
	HMAC_KEY_ENCODING_LABELS,
	HMAC_KEY_ENCODINGS,
	type HmacAlgorithm,
	type HmacKeyEncoding,
	type HmacResult,
	parseHmacKey,
} from '@/lib/tools/hmac';

/**
 * HMAC（鍵付きハッシュ）の計算欄。
 * 鍵とメッセージは秘密情報になり得るため、保存（localStorage・URL）も計測もしない。
 */
export function HmacPanel() {
	const id = useId();
	const [message, setMessage] = useState('');
	const [key, setKey] = useState('');
	const [keyEncoding, setKeyEncoding] = useState<HmacKeyEncoding>('utf8');
	const [algorithm, setAlgorithm] = useState<HmacAlgorithm>('sha256');
	// 表示中の結果がどのアルゴリズムで計算されたかを結果と一緒に持つ
	const [result, setResult] = useState<
		(HmacResult & { algorithm: HmacAlgorithm }) | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const runIdRef = useRef(0);

	const parsedKey = useMemo(
		() => parseHmacKey(key, keyEncoding),
		[key, keyEncoding],
	);
	const keyError = parsedKey.ok ? null : parsedKey.error;

	// 入力の変更から 300ms 後に計算し、古い計算結果は破棄する
	useEffect(() => {
		const runId = ++runIdRef.current;
		if ((message === '' && key === '') || !parsedKey.ok) {
			setResult(null);
			setError(null);
			return;
		}
		const keyBytes = parsedKey.bytes;
		const timer = setTimeout(async () => {
			try {
				const computed = await computeHmac(message, keyBytes, algorithm);
				if (runIdRef.current === runId) {
					setResult({ ...computed, algorithm });
					setError(null);
				}
			} catch {
				if (runIdRef.current === runId) {
					setResult(null);
					setError(
						'HMACを計算できませんでした。お使いのブラウザが対応していない可能性があります。',
					);
				}
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [message, key, parsedKey, algorithm]);

	const messageId = `${id}-message`;
	const keyId = `${id}-key`;
	const keyErrorId = `${id}-key-error`;

	return (
		<section
			className="rounded-lg border border-border p-4 space-y-4"
			aria-labelledby={`${id}-heading`}
			data-testid="hmac-panel"
		>
			<div className="space-y-1">
				<h2 id={`${id}-heading`} className="text-sm font-semibold">
					HMAC（鍵付きハッシュ）を計算
				</h2>
				<p className="text-xs text-muted-foreground">
					Webhookの署名確認やAPIの署名作成に使うHMACを計算します。鍵とメッセージはブラウザ内だけで処理し、保存・送信しません。
				</p>
			</div>

			<div className="space-y-2">
				<Label htmlFor={messageId} className="text-sm">
					メッセージ
				</Label>
				<Textarea
					id={messageId}
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					placeholder="署名するメッセージ（UTF-8として計算）"
					className="min-h-24 font-mono"
				/>
			</div>

			<div className="grid gap-4 sm:grid-cols-[1fr_auto]">
				<div className="space-y-2 min-w-0">
					<Label htmlFor={keyId} className="text-sm">
						秘密鍵
					</Label>
					<Input
						id={keyId}
						value={key}
						onChange={(e) => setKey(e.target.value)}
						placeholder="例: my-secret-key"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={keyError != null}
						aria-describedby={keyError ? keyErrorId : undefined}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor={`${id}-key-encoding`} className="text-sm">
						鍵の形式
					</Label>
					<Select
						value={keyEncoding}
						onValueChange={(v) => setKeyEncoding(v as HmacKeyEncoding)}
					>
						<SelectTrigger
							id={`${id}-key-encoding`}
							className="w-full sm:w-[180px]"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{HMAC_KEY_ENCODINGS.map((encoding) => (
								<SelectItem key={encoding} value={encoding}>
									{HMAC_KEY_ENCODING_LABELS[encoding]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			{keyError && (
				<p
					id={keyErrorId}
					className="text-sm text-destructive"
					role="alert"
					data-testid="hmac-key-error"
				>
					{keyError}
				</p>
			)}

			<div className="space-y-2">
				<Label htmlFor={`${id}-algorithm`} className="text-sm">
					アルゴリズム
				</Label>
				<Select
					value={algorithm}
					onValueChange={(v) => setAlgorithm(v as HmacAlgorithm)}
				>
					<SelectTrigger id={`${id}-algorithm`} className="w-full sm:w-[180px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{HMAC_ALGORITHMS.map((a) => (
							<SelectItem key={a} value={a}>
								{HMAC_ALGORITHM_LABELS[a]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{error && (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}

			<div className="space-y-2">
				{(
					[
						['hex', '16進数'],
						['base64', 'Base64'],
					] as const
				).map(([format, label]) => {
					const value = result?.[format] ?? null;
					return (
						<div
							key={format}
							className="rounded-lg border border-border p-3"
							data-testid={`hmac-result-${format}`}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold text-muted-foreground">
									{HMAC_ALGORITHM_LABELS[result?.algorithm ?? algorithm]}（
									{label}）
								</span>
								{value != null && (
									<CopyButton text={value} size="sm" variant="ghost" />
								)}
							</div>
							<p className="mt-1 font-mono text-sm break-all min-h-5">
								{value ?? <span className="text-muted-foreground">—</span>}
							</p>
						</div>
					);
				})}
			</div>
		</section>
	);
}
