import { Info, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';

export default function SafetyBadge() {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-2 rounded-lg border border-safety/30 bg-safety/5 px-3 py-1.5 text-sm font-medium text-safety hover:bg-safety/10 transition-colors cursor-pointer"
					aria-label="セキュリティ情報を表示"
				>
					<ShieldCheck className="h-4 w-4" />
					<span className="hidden sm:inline">入力データは送信されません</span>
					<span className="sm:hidden">ローカル処理</span>
					<span className="sr-only">完全クライアントサイド処理</span>
					<Info className="h-3 w-3 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-80" align="start">
				<div className="space-y-3">
					<h4 className="font-semibold text-sm flex items-center gap-2">
						<ShieldCheck className="h-4 w-4 text-safety" />
						入力データはブラウザ内で処理
					</h4>
					<p className="text-sm text-muted-foreground leading-relaxed">
						このツールの処理対象となるテキストやファイルは、ブラウザ内のJavaScriptで処理されます。
						入力内容や選択したファイルを当サイトのサーバーへ送信・保存する処理はありません。
					</p>
					<div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
						<p>✅ 入力データは端末内で処理</p>
						<p>✅ ページを閉じると処理中データは消去</p>
						<p>✅ 広告スクリプトは不使用</p>
						<p>✅ アクセス解析はCookieなし・個人追跡なし</p>
						<p>ℹ️ AI機能ではモデル取得のための通信が発生する場合があります</p>
						<p>✅ ソースコードはGitHubで公開中</p>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
