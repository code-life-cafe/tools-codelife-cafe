import { Download, Shuffle, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob } from '@/lib/download';
import {
	formatGroups,
	formatShuffled,
	MAX_ITEMS,
	parseItems,
	shuffle,
	splitIntoGroups,
} from '@/lib/tools/random-sort';

type Output = {
	kind: 'shuffle' | 'group';
	text: string;
	groups?: string[][];
};

export default function RandomSort() {
	const [input, setInput] = useState('');
	const [groupCountText, setGroupCountText] = useState('2');
	const [output, setOutput] = useState<Output | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const run = (kind: 'shuffle' | 'group') => {
		setOutput(null);
		setError(null);
		setNotice(null);
		const parsed = parseItems(input);
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}
		if (parsed.items.length === 0) {
			setError('項目がありません。1行に1項目で入力してください。');
			return;
		}
		try {
			const shuffled = shuffle(parsed.items);
			const skipped =
				parsed.skippedEmptyLines > 0
					? `${parsed.skippedEmptyLines}行の空行を除外しました。`
					: '';
			if (kind === 'shuffle') {
				setOutput({ kind, text: formatShuffled(shuffled) });
				setNotice(`${shuffled.length}項目を並べ替えました。${skipped}`);
				return;
			}
			if (!/^\d+$/.test(groupCountText.trim())) {
				setError('グループ数は1以上の整数で指定してください。');
				return;
			}
			const split = splitIntoGroups(shuffled, Number(groupCountText.trim()));
			if (!split.ok) {
				setError(split.error);
				return;
			}
			setOutput({
				kind,
				text: formatGroups(split.groups),
				groups: split.groups,
			});
			setNotice(
				`${shuffled.length}項目を${split.groups.length}グループに分けました。${skipped}`,
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : '処理に失敗しました。');
		}
	};

	const handleClear = () => {
		setInput('');
		setOutput(null);
		setError(null);
		setNotice(null);
	};

	const handleSave = () => {
		if (!output) return;
		downloadBlob(
			new Blob([output.text], { type: 'text/plain;charset=utf-8' }),
			output.kind === 'group' ? 'random-groups.txt' : 'random-sorted.txt',
		);
	};

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor="random-sort-input" className="text-sm font-medium">
						項目（1行に1項目）
					</Label>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleClear}
						disabled={input === '' && !output && !error}
					>
						<Trash2 className="mr-1 h-4 w-4" />
						クリア
					</Button>
				</div>
				<Textarea
					id="random-sort-input"
					value={input}
					onChange={(e) => {
						setInput(e.target.value);
						setOutput(null);
						setError(null);
						setNotice(null);
					}}
					placeholder={'田中\n鈴木\n佐藤\n高橋'}
					resize="vertical"
					spellCheck={false}
					className="field-sizing-fixed h-[200px] min-h-[200px] max-h-[400px] text-base"
				/>
				<p className="text-xs text-muted-foreground">
					空行（空白のみの行を含む）は除外します。同じ内容の行は別々の項目として扱い、各行の文字は変更しません。最大
					{MAX_ITEMS.toLocaleString('ja-JP')}
					項目・1MiBまで。入力と結果は保存されません。
				</p>
			</div>

			<div className="flex flex-wrap items-end gap-3">
				<Button onClick={() => run('shuffle')}>
					<Shuffle className="mr-1 h-4 w-4" />
					並べ替える
				</Button>
				<div className="flex items-end gap-2">
					<div className="space-y-1">
						<Label htmlFor="random-sort-groups" className="text-sm font-medium">
							グループ数
						</Label>
						<Input
							id="random-sort-groups"
							type="number"
							inputMode="numeric"
							min={1}
							step={1}
							value={groupCountText}
							onChange={(e) => {
								setGroupCountText(e.target.value);
								if (output?.kind === 'group') {
									setOutput(null);
									setNotice(null);
								}
								setError(null);
							}}
							className="w-24"
						/>
					</div>
					<Button variant="secondary" onClick={() => run('group')}>
						<Users className="mr-1 h-4 w-4" />
						グループに分ける
					</Button>
				</div>
			</div>

			<div aria-live="polite" className="space-y-2">
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				{notice && <p className="text-sm text-muted-foreground">{notice}</p>}
			</div>

			{output && (
				<section aria-label="結果" className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h2 className="text-sm font-semibold">結果</h2>
						<div className="flex gap-2">
							<CopyButton text={output.text} label="結果をコピー" />
							<Button variant="outline" size="sm" onClick={handleSave}>
								<Download className="mr-1 h-4 w-4" />
								テキスト保存
							</Button>
						</div>
					</div>
					{output.groups ? (
						<div
							className="grid grid-cols-1 gap-3 sm:grid-cols-2"
							data-testid="random-sort-result"
						>
							{output.groups.map((g, i) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: グループ番号が同一性
									key={i}
									className="rounded-lg border border-border/60 p-3"
								>
									<h3 className="mb-2 text-sm font-semibold">
										グループ{i + 1}（{g.length}件）
									</h3>
									<ul className="space-y-1 text-sm">
										{g.map((item, j) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: 重複項目を別項目として扱うため
											<li key={j} className="whitespace-pre-wrap break-all">
												{item}
											</li>
										))}
									</ul>
								</div>
							))}
						</div>
					) : (
						<ol
							className="list-decimal space-y-1 rounded-lg border border-border/60 p-3 pl-8 text-sm"
							data-testid="random-sort-result"
						>
							{output.text.split('\n').map((item, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: 重複項目を別項目として扱うため
								<li key={i} className="whitespace-pre-wrap break-all">
									{item}
								</li>
							))}
						</ol>
					)}
				</section>
			)}
		</div>
	);
}
