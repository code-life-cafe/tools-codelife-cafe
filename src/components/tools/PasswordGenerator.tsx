import { Dices, Eye, EyeOff, Info } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { useToolSettings } from '@/lib/hooks/useToolSettings';
import {
	CHARSET_KEYS,
	CHARSET_LABELS,
	checkPasswordStrength,
	DEFAULT_PASSWORD_OPTIONS,
	estimateGeneratedEntropy,
	generatePasswords,
	joinPasswordsForCopy,
	MAX_COUNT,
	MAX_LENGTH,
	MIN_COUNT,
	MIN_LENGTH,
	type PasswordOptions,
	STRENGTH_LABELS,
	STRENGTH_WARNING_MESSAGES,
	type StrengthLevel,
	sanitizePasswordSettings,
	strengthLevelFromBits,
	validatePasswordOptions,
} from '@/lib/tools/password-generator';

const LEVEL_BAR_CLASSES: Record<StrengthLevel, string> = {
	0: 'bg-destructive',
	1: 'bg-orange-500',
	2: 'bg-amber-500',
	3: 'bg-emerald-500',
	4: 'bg-emerald-600',
};

// ライトの文字色は白いカード上で4.5:1以上（WCAG AA）になる濃さ。#747
const LEVEL_TEXT_CLASSES: Record<StrengthLevel, string> = {
	0: 'text-destructive',
	1: 'text-[#C2410C] dark:text-orange-400',
	2: 'text-[#B45309] dark:text-amber-400',
	3: 'text-[#047857] dark:text-emerald-400',
	4: 'text-[#047857] dark:text-emerald-400',
};

function StrengthMeter({ level }: { level: StrengthLevel }) {
	return (
		<div className="flex gap-1" aria-hidden="true">
			{[0, 1, 2, 3, 4].map((step) => (
				<div
					key={step}
					className={`h-2 flex-1 rounded-full ${step <= level ? LEVEL_BAR_CLASSES[level] : 'bg-muted'}`}
				/>
			))}
		</div>
	);
}

/**
 * パスワード生成・強度チェック。
 * 生成したパスワードと入力したパスワードは保存（localStorage・URL）も計測もしない。
 * useToolSettings で保存するのは長さ・件数・文字種などの設定値だけ。
 */
export function PasswordGenerator() {
	const id = useId();
	const { trackRun } = useToolAnalytics('password-generator');
	const [settings, updateSettings] = useToolSettings<PasswordOptions>(
		'password-generator',
		DEFAULT_PASSWORD_OPTIONS,
		sanitizePasswordSettings,
	);
	const [passwords, setPasswords] = useState<string[]>([]);
	const [generateError, setGenerateError] = useState<string | null>(null);
	const [checkInput, setCheckInput] = useState('');
	const [showCheckInput, setShowCheckInput] = useState(false);

	const settingsError = validatePasswordOptions(settings);
	const entropy = settingsError ? 0 : estimateGeneratedEntropy(settings);
	const entropyLevel = strengthLevelFromBits(entropy);

	const generate = useCallback(() => {
		const result = generatePasswords(settings);
		if (result.ok) {
			setPasswords(result.passwords);
			setGenerateError(null);
		} else {
			setPasswords([]);
			setGenerateError(result.error);
		}
		return result.ok;
	}, [settings]);

	// 初回表示時に既定（または復元した）設定で生成する。計測は送らない
	// biome-ignore lint/correctness/useExhaustiveDependencies: 初回マウント時のみ実行
	useEffect(() => {
		generate();
	}, []);

	const handleGenerate = useCallback(() => {
		if (generate()) trackRun();
	}, [generate, trackRun]);

	const strength = useMemo(
		() => checkPasswordStrength(checkInput),
		[checkInput],
	);

	const lengthId = `${id}-length`;
	const countId = `${id}-count`;
	const settingsErrorId = `${id}-settings-error`;
	const checkInputId = `${id}-check-input`;

	return (
		<div className="space-y-8">
			{/* 生成 */}
			<section className="space-y-5" aria-labelledby={`${id}-generate-heading`}>
				<h2 id={`${id}-generate-heading`} className="text-lg font-semibold">
					パスワードを生成
				</h2>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<Label htmlFor={lengthId} className="mb-2 block font-semibold">
							長さ（{MIN_LENGTH}〜{MAX_LENGTH}文字）
						</Label>
						<Input
							id={lengthId}
							type="number"
							inputMode="numeric"
							min={MIN_LENGTH}
							max={MAX_LENGTH}
							value={Number.isNaN(settings.length) ? '' : settings.length}
							onChange={(e) =>
								updateSettings({ length: e.target.valueAsNumber })
							}
							aria-invalid={settingsError ? true : undefined}
							aria-describedby={settingsError ? settingsErrorId : undefined}
						/>
					</div>
					<div>
						<Label htmlFor={countId} className="mb-2 block font-semibold">
							生成件数（{MIN_COUNT}〜{MAX_COUNT}）
						</Label>
						<Input
							id={countId}
							type="number"
							inputMode="numeric"
							min={MIN_COUNT}
							max={MAX_COUNT}
							value={Number.isNaN(settings.count) ? '' : settings.count}
							onChange={(e) =>
								updateSettings({ count: e.target.valueAsNumber })
							}
							aria-invalid={settingsError ? true : undefined}
							aria-describedby={settingsError ? settingsErrorId : undefined}
						/>
					</div>
				</div>

				<fieldset className="rounded-lg border border-border p-4">
					<legend className="px-1 text-sm font-semibold">使う文字</legend>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{CHARSET_KEYS.map((key) => (
							<div key={key} className="flex items-center gap-2">
								<Checkbox
									id={`${id}-charset-${key}`}
									checked={settings[key]}
									onCheckedChange={(checked) =>
										updateSettings({
											[key]: checked === true,
										} as Partial<PasswordOptions>)
									}
								/>
								<Label
									htmlFor={`${id}-charset-${key}`}
									className="cursor-pointer text-sm"
								>
									{CHARSET_LABELS[key]}
								</Label>
							</div>
						))}
					</div>
					<div className="mt-4 space-y-3 border-t border-border pt-4">
						<div className="flex items-center gap-2">
							<Switch
								id={`${id}-exclude-ambiguous`}
								checked={settings.excludeAmbiguous}
								onCheckedChange={(checked) =>
									updateSettings({ excludeAmbiguous: checked })
								}
							/>
							<Label
								htmlFor={`${id}-exclude-ambiguous`}
								className="cursor-pointer text-sm"
							>
								紛らわしい文字（0 O o 1 l I |）を除く
							</Label>
						</div>
						<div className="flex items-center gap-2">
							<Switch
								id={`${id}-require-each`}
								checked={settings.requireEach}
								onCheckedChange={(checked) =>
									updateSettings({ requireEach: checked })
								}
							/>
							<Label
								htmlFor={`${id}-require-each`}
								className="cursor-pointer text-sm"
							>
								選んだ文字種を1文字以上ずつ含める
							</Label>
						</div>
					</div>
				</fieldset>

				{settingsError ? (
					<p
						id={settingsErrorId}
						className="text-sm text-destructive"
						role="alert"
					>
						{settingsError}
					</p>
				) : (
					<p
						className="text-sm text-muted-foreground"
						data-testid="generate-entropy"
					>
						この設定の強さの目安: 約{Math.floor(entropy)}ビット（
						<span
							className={`font-semibold ${LEVEL_TEXT_CLASSES[entropyLevel]}`}
						>
							{STRENGTH_LABELS[entropyLevel]}
						</span>
						）
					</p>
				)}

				<Button
					onClick={handleGenerate}
					disabled={!!settingsError}
					className="w-full sm:w-auto"
				>
					<Dices className="h-4 w-4" />
					<span className="ml-1.5">生成する</span>
				</Button>

				{generateError && (
					<p className="text-sm text-destructive" role="alert">
						{generateError}
					</p>
				)}

				{passwords.length > 0 && (
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-2">
							<p className="text-sm font-semibold" aria-live="polite">
								生成結果（{passwords.length}件）
							</p>
							<CopyButton
								text={joinPasswordsForCopy(passwords)}
								label="全件コピー"
							/>
						</div>
						<ul
							className="divide-y divide-border rounded-lg border border-border font-mono-tool text-sm"
							data-testid="password-result-list"
							aria-label="生成されたパスワード一覧"
						>
							{passwords.map((password, i) => (
								<li
									// biome-ignore lint/suspicious/noArrayIndexKey: 生成のたびに全件が入れ替わる読み取り専用リストのため
									key={i}
									className="flex items-center justify-between gap-2 px-3 py-1.5"
								>
									<span className="min-w-0 break-all">{password}</span>
									<CopyButton
										text={password}
										label={`${i + 1}件目をコピー`}
										variant="ghost"
										size="sm"
										className="shrink-0"
									/>
								</li>
							))}
						</ul>
					</div>
				)}
			</section>

			{/* 強度チェック */}
			<section
				className="space-y-4 rounded-lg border border-border p-4"
				aria-labelledby={`${id}-check-heading`}
			>
				<h2 id={`${id}-check-heading`} className="text-lg font-semibold">
					パスワードの強度をチェック
				</h2>
				<div>
					<Label htmlFor={checkInputId} className="mb-2 block font-semibold">
						確認するパスワード
					</Label>
					<div className="flex gap-2">
						<Input
							id={checkInputId}
							type={showCheckInput ? 'text' : 'password'}
							value={checkInput}
							onChange={(e) => setCheckInput(e.target.value)}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className="min-w-0 font-mono-tool"
							placeholder="入力すると強度の目安を表示します"
						/>
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="shrink-0"
							onClick={() => setShowCheckInput((v) => !v)}
							aria-pressed={showCheckInput}
							aria-label={
								showCheckInput ? 'パスワードを隠す' : 'パスワードを表示'
							}
						>
							{showCheckInput ? (
								<EyeOff className="h-4 w-4" />
							) : (
								<Eye className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>

				<div aria-live="polite" data-testid="strength-result">
					{strength ? (
						<div className="space-y-3">
							<StrengthMeter level={strength.level} />
							<p className="text-sm">
								強度の目安:{' '}
								<span
									className={`font-semibold ${LEVEL_TEXT_CLASSES[strength.level]}`}
								>
									{STRENGTH_LABELS[strength.level]}
								</span>
								（{strength.length}文字・推定エントロピー 約
								{Math.floor(strength.bits)}ビット）
							</p>
							{strength.warnings.length > 0 && (
								<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
									{strength.warnings.map((warning) => (
										<li key={warning}>{STRENGTH_WARNING_MESSAGES[warning]}</li>
									))}
								</ul>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							パスワードを入力すると、ここに強度の目安を表示します。
						</p>
					)}
				</div>

				<p className="flex gap-1.5 text-xs text-muted-foreground">
					<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>
						強度は文字の種類と長さから計算した推定値です。よく使われるパスワードや単純な並びは検出しますが、辞書の単語・名前・誕生日などを組み合わせたパスワードへの耐性は保証できません。入力したパスワードは外部に送信・保存しません。
					</span>
				</p>
			</section>
		</div>
	);
}
