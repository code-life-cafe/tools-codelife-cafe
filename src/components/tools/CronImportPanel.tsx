import { FileInput, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import CopyButton from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { importScheduleExpression } from '@/lib/tools/cron-import';

interface CronImportPanelProps {
	/** 換算したJSTのcron式を解析欄へ反映する */
	onApply: (expr: string) => void;
}

/**
 * AWS EventBridge・GitHub Actions・systemd timer のスケジュール式を標準cron式へ読み替える欄。
 * 貼り付けた内容は保存・送信・計測しない（この欄は tool_run を送らない）。
 */
export default function CronImportPanel({ onApply }: CronImportPanelProps) {
	const [text, setText] = useState('');

	const result = useMemo(
		() => (text.trim() === '' ? null : importScheduleExpression(text)),
		[text],
	);

	return (
		<div
			className="rounded-xl border bg-muted/30 p-4 sm:p-6 space-y-3"
			data-testid="cron-import"
		>
			<div className="flex items-center gap-2 text-sm font-medium">
				<FileInput className="h-4 w-4 text-primary" aria-hidden="true" />
				他の形式から読み込む（AWS EventBridge・GitHub Actions・systemd timer）
			</div>
			<div>
				<Label htmlFor="cron-import-input" className="sr-only">
					読み込む式（AWS EventBridge・GitHub Actions・systemd timer）
				</Label>
				<Textarea
					id="cron-import-input"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder={
						"例: cron(0 9 ? * MON-FRI *) / rate(5 minutes) / - cron: '30 0 * * 1-5' / OnCalendar=Mon..Fri *-*-* 09:00:00"
					}
					rows={3}
					className="rounded-xl font-mono text-sm"
					autoComplete="off"
					spellCheck={false}
				/>
				<p className="mt-2 text-xs text-muted-foreground">
					EventBridgeのcron式とtimezone未指定のGitHub
					ActionsはUTCとして読み込み、JSTのcron式に換算します。systemd
					timerは末尾のタイムゾーン（UTC・Asia/Tokyo）に従い、指定がなければJSTとみなします。
				</p>
			</div>

			<div aria-live="polite">
				{result && !result.success && (
					<p
						className="text-sm text-destructive"
						data-testid="cron-import-error"
					>
						{result.error}
					</p>
				)}
				{result?.success && (
					<div className="space-y-2" data-testid="cron-import-result">
						<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
							<dt className="text-muted-foreground">形式</dt>
							<dd>{result.formatLabel}</dd>
							<dt className="text-muted-foreground">元のタイムゾーン</dt>
							<dd>
								{result.sourceTimeZoneLabel ??
									result.sourceTimeZone ??
									'時刻に依存しない（間隔指定）'}
							</dd>
							{result.sourceExpr &&
								result.sourceTimeZone &&
								result.sourceTimeZone !== 'Asia/Tokyo' && (
									<>
										<dt className="text-muted-foreground">
											cron式（{result.sourceTimeZone}）
										</dt>
										<dd>
											<code
												className="font-mono break-all"
												data-testid="cron-import-source"
											>
												{result.sourceExpr}
											</code>
										</dd>
									</>
								)}
						</dl>
						{result.jstExpr ? (
							<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
								<div className="min-w-0">
									<div className="text-xs text-muted-foreground">
										cron式（JST）
									</div>
									<code
										className="font-mono text-sm break-all"
										data-testid="cron-import-jst"
									>
										{result.jstExpr}
									</code>
								</div>
								<div className="flex items-center gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() => onApply(result.jstExpr as string)}
									>
										解析欄へ反映
									</Button>
									<CopyButton text={result.jstExpr} size="sm" />
								</div>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								JSTのcron式へは換算できませんでした（下の注意を確認してください）。
							</p>
						)}
						{result.notes.length > 0 && (
							<ul className="space-y-1" data-testid="cron-import-notes">
								{result.notes.map((note) => (
									<li
										key={note}
										className="flex gap-2 text-xs text-muted-foreground"
									>
										<Info
											className="mt-0.5 h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										<span>{note}</span>
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
