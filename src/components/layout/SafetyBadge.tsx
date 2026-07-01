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
					<span className="hidden sm:inline">入力データ非送信</span>
					<span className="sm:hidden">非送信</span>
					<span className="sr-only">完全クライアントサイド処理</span>
					<Info className="h-3 w-3 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-80" align="start">
				<div className="space-y-3">
					<h4 className="font-semibold text-sm flex items-center gap-2">
						<ShieldCheck className="h-4 w-4 text-safety" />
						入力データ非送信・匿名統計とモデル取得あり
					</h4>
					<p className="text-sm text-muted-foreground leading-relaxed">
						このツールに入力した内容や選択したファイルは、ブラウザ内のJavaScriptで処理されます。
						入力データを当サイトのサーバーへ送信・保存する処理はありません。
					</p>
					<p className="text-xs text-muted-foreground leading-relaxed italic border-l-2 border-primary/20 pl-2">
						※
						サービス改善のため、Cookieを使用しない匿名・集計の閲覧/利用統計のみ取得しています。入力データ本体は送信されません。
						AI機能では初回実行時などに推論モデルを取得する通信が発生します。画像や入力内容はモデル配信元へ送信されません。
					</p>
					<div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
						<p>入力データ非送信: 入力内容やファイルはブラウザ内で処理</p>
						<p>Cookieなし: Cookieを使った追跡やセッション管理なし</p>
						<p>個人追跡なし: 個人識別やプロファイリングなし</p>
						<p>OSS: ソースコードはGitHubで公開中</p>
						<p>広告なし: サードパーティ広告ネットワークなし</p>
						<p>利用統計: 改善のため匿名・集計の閲覧/利用統計のみ取得</p>
						<p>AIモデル取得: 初回実行時などに推論モデルをダウンロード</p>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
