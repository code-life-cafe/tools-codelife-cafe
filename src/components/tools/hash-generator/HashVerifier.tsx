import { CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	compareHash,
	detectAlgorithmByLength,
	HASH_ALGORITHM_LABELS,
	type HashAlgorithm,
	type HashResults,
	normalizeHash,
} from '@/lib/tools/hash';

type VerifyVerdict =
	| { kind: 'empty' }
	| { kind: 'unknown-length' }
	| { kind: 'not-selected'; algorithm: HashAlgorithm }
	| { kind: 'pending'; algorithm: HashAlgorithm }
	| { kind: 'match'; algorithm: HashAlgorithm }
	| { kind: 'mismatch'; algorithm: HashAlgorithm };

interface HashVerifierProps {
	results: HashResults;
	selectedAlgorithms: readonly HashAlgorithm[];
}

export function HashVerifier({
	results,
	selectedAlgorithms,
}: HashVerifierProps) {
	const [expected, setExpected] = useState('');

	const verdict = useMemo<VerifyVerdict>(() => {
		const normalized = normalizeHash(expected);
		if (!normalized) return { kind: 'empty' };
		const algorithm = detectAlgorithmByLength(normalized);
		if (!algorithm) return { kind: 'unknown-length' };
		// 検出されたアルゴリズムが未選択でも自動で計算対象には追加しない（仕様）
		if (!selectedAlgorithms.includes(algorithm)) {
			return { kind: 'not-selected', algorithm };
		}
		const computed = results[algorithm];
		if (computed == null) return { kind: 'pending', algorithm };
		return compareHash(computed, expected)
			? { kind: 'match', algorithm }
			: { kind: 'mismatch', algorithm };
	}, [expected, results, selectedAlgorithms]);

	return (
		<div className="rounded-lg border border-border p-4 space-y-3">
			<Label htmlFor="expected-hash" className="text-sm font-semibold">
				期待値との照合（ファイルの改ざん・破損チェック）
			</Label>
			<Input
				id="expected-hash"
				value={expected}
				onChange={(e) => setExpected(e.target.value)}
				placeholder="配布元のハッシュ値を貼り付けると自動で照合します"
				className="font-mono"
			/>
			<div data-testid="hash-verify-result" className="min-h-6 text-sm">
				{verdict.kind === 'unknown-length' && (
					<span className="inline-flex items-center gap-1.5 text-muted-foreground">
						<HelpCircle className="h-4 w-4 shrink-0" />
						ハッシュ値の長さからアルゴリズムを判定できません
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
