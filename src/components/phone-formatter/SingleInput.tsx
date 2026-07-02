/**
 * 単一電話番号入力コンポーネント
 * リアルタイム変換（150msデバウンス）
 */

import { CheckCircle2, Globe, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parsePhoneNumber } from '@/lib/phone-formatter/parse';
import type { ParseResult } from '@/lib/phone-formatter/types';

interface SingleInputProps {
	onResult: (result: ParseResult | null) => void;
}

export default function SingleInput({ onResult }: SingleInputProps) {
	const [value, setValue] = useState('');
	const [status, setStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
	const [errorMessage, setErrorMessage] = useState('');
	const [mounted, setMounted] = useState(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// ハイドレーション後にマウント済みとする（SSR対応）
	useEffect(() => {
		setMounted(true);
	}, []);

	const processInput = useCallback(
		(input: string) => {
			if (!input.trim()) {
				setStatus('idle');
				setErrorMessage('');
				onResult(null);
				return;
			}

			try {
				const result = parsePhoneNumber(input);
				if (result.valid) {
					setStatus('valid');
					setErrorMessage('');
					onResult(result);
				} else {
					setStatus('invalid');
					setErrorMessage(result.error ?? '無効な電話番号です。');
					onResult(null);
				}
			} catch {
				setStatus('invalid');
				setErrorMessage('電話番号の処理中にエラーが発生しました。');
				onResult(null);
			}
		},
		[onResult],
	);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value;
		setValue(newValue);

		// デバウンス150ms
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			processInput(newValue);
		}, 150);
	};

	const handleClear = () => {
		setValue('');
		setStatus('idle');
		setErrorMessage('');
		onResult(null);
		inputRef.current?.focus();
	};

	// バリデーションステータスのスタイル
	const statusStyles = {
		idle: 'border-border',
		valid: 'border-green-500 focus-within:ring-green-500/20',
		invalid: 'border-red-500 focus-within:ring-red-500/20',
	};

	const statusIndicator = {
		idle: null,
		valid: (
			<span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
				<CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				有効
			</span>
		),
		invalid: (
			<span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
				<XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				無効
			</span>
		),
	};

	return (
		<div className="space-y-3">
			{/* 国選択 + 入力欄 */}
			<div className="flex gap-2">
				{/* 国選択ドロップダウン（v1.0: 日本固定） */}
				{/* TODO: 将来的に多国対応を追加する */}
				<button
					type="button"
					disabled
					className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed shrink-0"
					title="現在は日本（+81）のみ対応"
					aria-label="国選択（日本固定）"
				>
					<Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
					+81
				</button>

				{/* 入力フィールド */}
				<div
					className={`relative flex-1 flex items-center rounded-lg border bg-background px-4 focus-within:ring-2 focus-within:ring-ring/20 transition-colors ${statusStyles[status]}`}
				>
					{mounted && (
						<input
							ref={inputRef}
							id="phone-input"
							type="tel"
							value={value}
							onChange={handleChange}
							placeholder="03-1234-5678 または 09012345678"
							className="w-full bg-transparent border-none outline-none text-[18px] py-3 text-foreground placeholder:text-muted-foreground"
							aria-label="電話番号入力"
							aria-describedby="phone-validation-status"
							autoComplete="off"
							autoCorrect="off"
							autoCapitalize="off"
							spellCheck={false}
						/>
					)}
					{value && (
						<button
							type="button"
							onClick={handleClear}
							className="flex-shrink-0 ml-2 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
							aria-label="入力をクリア"
						>
							<X className="h-4 w-4" />
						</button>
					)}
				</div>
			</div>

			{/* バリデーションステータス */}
			<output
				id="phone-validation-status"
				className="min-h-[20px]"
				aria-live="polite"
			>
				{status !== 'idle' && (
					<div className="flex items-center gap-2">
						{statusIndicator[status]}
						{status === 'invalid' && errorMessage && (
							<span className="text-xs text-red-600 dark:text-red-400">
								{errorMessage}
							</span>
						)}
					</div>
				)}
			</output>
		</div>
	);
}
