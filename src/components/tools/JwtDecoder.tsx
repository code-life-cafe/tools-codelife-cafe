import { AlertTriangle, KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { decodeJwt } from '@/lib/tools/jwt-decoder';

const SAMPLE_JWT =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuWxseeUsOWkqumDjiIsInJvbGUiOiLnrqHnkIbogIUiLCJpYXQiOjE3MDQwNjcyMDAsImV4cCI6NDEwMjQ0NDgwMH0.dummy-signature';

function ResultCard({ title, value }: { title: string; value: string }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
				<CardTitle className="text-base">{title}</CardTitle>
				<CopyButton text={value} />
			</CardHeader>
			<CardContent>
				<pre className="min-h-40 overflow-auto rounded-lg bg-muted p-4 font-mono-tool text-sm whitespace-pre-wrap">
					{value || 'デコード結果がここに表示されます。'}
				</pre>
			</CardContent>
		</Card>
	);
}

export function JwtDecoder() {
	const { trackRun } = useToolAnalytics('jwt-decoder');
	const [input, setInput] = useState(SAMPLE_JWT);
	const result = useMemo(() => decodeJwt(input), [input]);

	useEffect(() => {
		if (input.trim() && !result.error) {
			trackRun();
		}
	}, [input, result.error, trackRun]);

	return (
		<div className="space-y-6">
			<Alert>
				<KeyRound className="h-4 w-4" />
				<AlertTitle>署名検証は行いません</AlertTitle>
				<AlertDescription>
					JWTのヘッダーとペイロードをブラウザ内でデコードします。秘密鍵や外部サーバーは使用しません。
				</AlertDescription>
			</Alert>

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<Label htmlFor="jwt-input">JWT</Label>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setInput('')}
						disabled={!input}
					>
						<Trash2 className="mr-1 h-4 w-4" />
						クリア
					</Button>
				</div>
				<Textarea
					id="jwt-input"
					value={input}
					onChange={(event) => setInput(event.target.value)}
					placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
					className="min-h-36 font-mono-tool"
				/>
			</div>

			{result.error && (
				<Alert variant="destructive">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>デコードできません</AlertTitle>
					<AlertDescription>{result.error}</AlertDescription>
				</Alert>
			)}

			{result.warnings.length > 0 && (
				<Alert>
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>注意</AlertTitle>
					<AlertDescription>{result.warnings.join(' / ')}</AlertDescription>
				</Alert>
			)}

			<div className="grid gap-4 lg:grid-cols-2">
				<ResultCard title="ヘッダー" value={result.header?.formatted ?? ''} />
				<ResultCard
					title="ペイロード"
					value={result.payload?.formatted ?? ''}
				/>
			</div>
			<ResultCard title="署名（未検証）" value={result.signature} />
		</div>
	);
}
