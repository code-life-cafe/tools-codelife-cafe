import { ArrowUpDown, BarChart2, Hash, Tag, Type } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { WordFrequency } from '@/lib/tools/wordcloud/index.ts';

interface FrequencyTableProps {
	frequencies: WordFrequency[];
}

type SortKey = 'rank' | 'word' | 'count';

export function FrequencyTable({ frequencies }: FrequencyTableProps) {
	const [sortKey, setSortKey] = useState<SortKey>('rank');
	const [sortAsc, setSortAsc] = useState<boolean>(true);

	if (frequencies.length === 0) return null;

	const sorted = [...frequencies].map((item, index) => ({
		...item,
		rank: index + 1,
	}));

	sorted.sort((a, b) => {
		let cmp = 0;
		if (sortKey === 'rank') cmp = a.rank - b.rank;
		else if (sortKey === 'word') cmp = a.word.localeCompare(b.word);
		else if (sortKey === 'count') cmp = a.count - b.count;

		return sortAsc ? cmp : -cmp;
	});

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) {
			setSortAsc(!sortAsc);
		} else {
			setSortKey(key);
			setSortAsc(key === 'word');
		}
	};

	return (
		<div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
			<div className="flex items-center justify-between">
				<h3 className="font-semibold text-base flex items-center gap-2">
					<BarChart2 className="h-4 w-4 text-primary" />
					単語出現頻度表 ({frequencies.length} 語)
				</h3>
			</div>

			<div className="max-h-[360px] overflow-auto rounded-md border">
				<table className="w-full text-left text-sm">
					<thead className="sticky top-0 bg-muted/90 backdrop-blur-sm font-medium text-muted-foreground text-xs border-b">
						<tr>
							<th className="p-2.5 w-16">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => toggleSort('rank')}
									className="h-7 px-1 text-xs font-semibold"
								>
									<Hash className="mr-1 h-3 w-3" />
									順位
									<ArrowUpDown className="ml-1 h-3 w-3" />
								</Button>
							</th>
							<th className="p-2.5">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => toggleSort('word')}
									className="h-7 px-1 text-xs font-semibold"
								>
									<Type className="mr-1 h-3 w-3" />
									単語
									<ArrowUpDown className="ml-1 h-3 w-3" />
								</Button>
							</th>
							<th className="p-2.5 w-24">
								<span className="flex items-center gap-1 px-1 py-1 text-xs font-semibold">
									<Tag className="h-3 w-3" />
									品詞
								</span>
							</th>
							<th className="p-2.5 w-24 text-right">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => toggleSort('count')}
									className="h-7 px-1 text-xs font-semibold ml-auto"
								>
									出現回数
									<ArrowUpDown className="ml-1 h-3 w-3" />
								</Button>
							</th>
						</tr>
					</thead>
					<tbody className="divide-y text-xs">
						{sorted.map((item) => (
							<tr
								key={`${item.rank}-${item.word}`}
								className="hover:bg-muted/40 transition-colors"
							>
								<td className="p-2.5 font-mono text-muted-foreground">
									{item.rank}
								</td>
								<td className="p-2.5 font-medium text-foreground">
									{item.word}
								</td>
								<td className="p-2.5 text-muted-foreground">その他</td>
								<td className="p-2.5 text-right font-mono font-semibold text-primary">
									{item.count.toLocaleString()}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
