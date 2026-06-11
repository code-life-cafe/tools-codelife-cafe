// ZipcodePage — 郵便番号→住所変換のオーケストレーター（単発検索 / 一括変換のタブ切替）

import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
	createZipLookup,
	formatAddress,
	normalizeZip,
	type ZipRecord,
} from '@/lib/tools/zipcode';
import { BulkConvertPanel } from './BulkConvertPanel';
import { fetchZipChunk } from './fetchChunk';

type SearchStatus = 'idle' | 'searching' | 'found' | 'not-found' | 'error';

function SingleSearch() {
	const [query, setQuery] = useState('');
	const [records, setRecords] = useState<ZipRecord[]>([]);
	const [status, setStatus] = useState<SearchStatus>('idle');
	const lookupRef = useRef(createZipLookup(fetchZipChunk));
	const runIdRef = useRef(0);

	const runSearch = useCallback((zip7: string) => {
		const runId = ++runIdRef.current;
		setStatus('searching');
		lookupRef.current
			.lookup(zip7)
			.then((recs) => {
				if (runIdRef.current !== runId) return;
				setRecords(recs);
				setStatus(recs.length > 0 ? 'found' : 'not-found');
			})
			.catch(() => {
				if (runIdRef.current !== runId) return;
				setRecords([]);
				setStatus('error');
			});
	}, []);

	// 7桁が揃った時点で自動検索する
	const normalized = useMemo(() => normalizeZip(query), [query]);
	useEffect(() => {
		if (!normalized) {
			runIdRef.current++;
			setRecords([]);
			setStatus('idle');
			return;
		}
		runSearch(normalized);
	}, [normalized, runSearch]);

	return (
		<div className="space-y-4">
			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="郵便番号を入力（例: 100-0001）"
					className="pl-9 font-mono"
					inputMode="numeric"
					aria-label="検索する郵便番号"
				/>
			</div>

			{status === 'searching' && (
				<p className="flex items-center gap-1.5 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					検索中…
				</p>
			)}

			{status === 'found' && (
				<div className="space-y-2">
					{records.map((record) => (
						<div
							key={`${record[0]}-${record[1]}-${record[2]}-${record[3]}`}
							className="rounded-lg border border-border p-4"
						>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
								<span className="font-mono text-sm text-muted-foreground">
									〒{record[0].slice(0, 3)}-{record[0].slice(3)}
								</span>
								<span className="text-base font-medium">
									{formatAddress(record)}
								</span>
							</div>
							<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
								<dt className="text-muted-foreground">都道府県</dt>
								<dd>{record[1]}</dd>
								<dt className="text-muted-foreground">市区町村</dt>
								<dd>{record[2]}</dd>
								<dt className="text-muted-foreground">町域</dt>
								<dd>{record[3] || '（町域なし）'}</dd>
							</dl>
							<div className="mt-2">
								<CopyButton text={formatAddress(record)} label="住所をコピー" />
							</div>
						</div>
					))}
					{records.length > 1 && (
						<p className="text-xs text-muted-foreground">
							この郵便番号には {records.length} 件の町域があります。
						</p>
					)}
				</div>
			)}

			{status === 'not-found' && (
				<div
					className="rounded-lg border border-border bg-muted/30 p-4 text-sm"
					role="status"
				>
					<p>該当する住所が見つかりません。</p>
					<p className="mt-1 text-xs text-muted-foreground">
						大口事業所の個別郵便番号には対応していません。郵便番号をご確認ください。
					</p>
				</div>
			)}

			{status === 'error' && (
				<div
					className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
					role="alert"
				>
					<p className="flex items-center gap-1.5">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						住所データの取得に失敗しました。ネットワーク接続を確認してください。
					</p>
					<button
						type="button"
						onClick={() => normalized && runSearch(normalized)}
						className="mt-2 text-xs font-medium underline hover:no-underline"
					>
						再試行
					</button>
				</div>
			)}
		</div>
	);
}

export function ZipcodePage() {
	return (
		<Tabs defaultValue="single" className="space-y-4">
			<TabsList className="grid w-full grid-cols-2">
				<TabsTrigger value="single">単発検索</TabsTrigger>
				<TabsTrigger value="bulk">一括変換</TabsTrigger>
			</TabsList>
			<TabsContent value="single">
				<SingleSearch />
			</TabsContent>
			<TabsContent value="bulk">
				<BulkConvertPanel />
			</TabsContent>

			<p className="pt-2 text-xs text-muted-foreground">
				🔒
				入力された郵便番号は外部に送信されません。住所データはこのサイト内の静的ファイルから取得します。
			</p>
		</Tabs>
	);
}
