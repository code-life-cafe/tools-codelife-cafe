import CopyButton from '@/components/common/CopyButton';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
	HASH_ALGORITHM_LABELS,
	HASH_ALGORITHMS,
	type HashAlgorithm,
	type HashResults,
} from '@/lib/tools/hash';

interface HashResultTableProps {
	selectedAlgorithms: readonly HashAlgorithm[];
	results: HashResults;
	computing: boolean;
	uppercase: boolean;
	onUppercaseChange: (value: boolean) => void;
}

export function HashResultTable({
	selectedAlgorithms,
	results,
	computing,
	uppercase,
	onUppercaseChange,
}: HashResultTableProps) {
	// 表示順は定義順（md5 → sha1 → sha256 → sha512 → crc32）に固定する
	const rows = HASH_ALGORITHMS.filter((a) => selectedAlgorithms.includes(a));

	if (rows.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				計算するアルゴリズムを選択してください。
			</p>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold">計算結果</h2>
				<div className="flex items-center gap-2">
					<Switch
						id="uppercase-toggle"
						checked={uppercase}
						onCheckedChange={onUppercaseChange}
					/>
					<Label
						htmlFor="uppercase-toggle"
						className="text-sm cursor-pointer text-muted-foreground"
					>
						大文字で表示
					</Label>
				</div>
			</div>
			<div className="space-y-2">
				{rows.map((algorithm) => {
					const raw = results[algorithm];
					// Preview = Export: コピーする値は表示と同一にする
					const displayValue =
						raw != null ? (uppercase ? raw.toUpperCase() : raw) : null;
					return (
						<div
							key={algorithm}
							className="rounded-lg border border-border p-3"
							data-testid={`hash-result-${algorithm}`}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold text-muted-foreground">
									{HASH_ALGORITHM_LABELS[algorithm]}
								</span>
								{displayValue != null && (
									<CopyButton text={displayValue} size="sm" variant="ghost" />
								)}
							</div>
							<p className="mt-1 font-mono text-sm break-all min-h-5">
								{displayValue ??
									(computing ? (
										<span className="text-muted-foreground">計算中…</span>
									) : (
										<span className="text-muted-foreground">—</span>
									))}
							</p>
						</div>
					);
				})}
			</div>
		</div>
	);
}
