import { CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
	compareHash,
	HASH_ALGORITHM_LABELS,
	type HashAlgorithm,
	type HashResults,
	parseExpectedHash,
} from '@/lib/tools/hash';

type VerifyVerdict =
	| { kind: 'empty' }
	| { kind: 'unknown-length' }
	| { kind: 'multi-line' }
	| { kind: 'invalid-line' }
	| { kind: 'not-selected'; algorithm: HashAlgorithm; fileName: string | null }
	| { kind: 'pending'; algorithm: HashAlgorithm; fileName: string | null }
	| { kind: 'match'; algorithm: HashAlgorithm; fileName: string | null }
	| { kind: 'mismatch'; algorithm: HashAlgorithm; fileName: string | null };

interface HashVerifierProps {
	results: HashResults;
	selectedAlgorithms: readonly HashAlgorithm[];
}

export function HashVerifier({
	results,
	selectedAlgorithms,
}: HashVerifierProps) {
	const [expected, setExpected] = useState('');

	const parsed = useMemo(() => parseExpectedHash(expected), [expected]);

	const verdict = useMemo<VerifyVerdict>(() => {
		if (!parsed.ok) return { kind: parsed.reason };
		const { algorithm, fileName, hash } = parsed;
		// 検出されたアルゴリズムが未選択でも自動で計算対象には追加しない（仕様）
		if (!selectedAlgorithms.includes(algorithm)) {
			return { kind: 'not-selected', algorithm, fileName };
		}
		const computed = results[algorithm];
		if (computed == null) return { kind: 'pending', algorithm, fileName };
		return compareHash(computed, hash)
			? { kind: 'match', algorithm, fileName }
			: { kind: 'mismatch', algorithm, fileName };
	}, [expected, results, selectedAlgorithms]);

	return (
		<div className="rounded-lg border border-border p-4 space-y-3">
			<Label htmlFor="expected-hash" className="text-sm font-semibold">
				期待値との照合（ファイルの改ざん・破損チェック）
			</Label>
			<Textarea
				id="expected-hash"
				rows={2}
				value={expected}
				onChange={(e) => setExpected(e.target.value)}
				placeholder="配布元のハッシュ値、または sha256sum 形式の1行（ハッシュ値 ファイル名）を貼り付けると自動で照合します"
				className="min-h-0 font-mono"
			/>
			{parsed.ok && (
				<dl
					data-testid="hash-verify-extracted"
					className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
				>
					<dt className="text-muted-foreground">抽出したハッシュ値</dt>
					<dd className="break-all font-mono">{parsed.hash}</dd>
					<dt className="text-muted-foreground">検出アルゴリズム</dt>
					<dd>{HASH_ALGORITHM_LABELS[parsed.algorithm]}</dd>
					{parsed.fileName != null && (
						<>
							<dt className="text-muted-foreground">記載のファイル名</dt>
							<dd className="break-all">
								{parsed.fileName}
								<span className="ml-2 text-muted-foreground">
									（ファイル名の一致は確認しません）
								</span>
							</dd>
						</>
					)}
				</dl>
			)}
			<div data-testid="hash-verify-result" className="min-h-6 text-sm">
				{verdict.kind === 'unknown-length' && (
					<span className="inline-flex items-center gap-1.5 text-muted-foreground">
						<HelpCircle className="h-4 w-4 shrink-0" />
						ハッシュ値の長さからアルゴリズムを判定できません
					</span>
				)}
				{verdict.kind === 'multi-line' && (
					<span className="inline-flex items-center gap-1.5 text-destructive">
						<XCircle className="h-4 w-4 shrink-0" />
						複数行は照合できません。1行ずつ貼り付けてください
					</span>
				)}
				{verdict.kind === 'invalid-line' && (
					<span className="inline-flex items-center gap-1.5 text-destructive">
						<XCircle className="h-4 w-4 shrink-0" />
						チェックサム行の形式が正しくありません（「ハッシュ値＋空白2個＋ファイル名」または「ハッシュ値＋空白＋*＋ファイル名」）
					</span>
				)}
				{verdict.kind === 'not-selected' && (
					<span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
						<HelpCircle className="h-4 w-4 shrink-0" />
						対象アルゴリズムを選択してください（検出:{' '}
						{HASH_ALGORITHM_LABELS[verdict.algorithm]}）
					</span>
				)}
				{verdict.kind === 'pending' && (
					<span className="text-muted-foreground">
						{HASH_ALGORITHM_LABELS[verdict.algorithm]} の計算結果を待っています…
					</span>
				)}
				{verdict.kind === 'match' && (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 font-medium text-green-600 dark:text-green-500">
						<CheckCircle2 className="h-4 w-4 shrink-0" />
						一致（
						{HASH_ALGORITHM_LABELS[verdict.algorithm]}）
					</span>
				)}
				{verdict.kind === 'mismatch' && (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 font-medium text-destructive">
						<XCircle className="h-4 w-4 shrink-0" />
						不一致（
						{HASH_ALGORITHM_LABELS[verdict.algorithm]}）
					</span>
				)}
			</div>
		</div>
	);
}
