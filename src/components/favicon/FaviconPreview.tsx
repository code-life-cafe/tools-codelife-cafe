// FaviconPreview — 生成済みアセット（Export と同一ロジックの出力）でライブプレビューする
// ブラウザタブ風（16/32 実寸）＋ スマホホーム画面風（角丸・実寸）。
import type * as React from 'react';
import type { FaviconAsset } from '@/lib/tools/favicon';

// 透過カラーを示す市松模様（/color の知見を流用）
const checkerboardStyle: React.CSSProperties = {
	backgroundImage: `
		linear-gradient(45deg, var(--muted) 25%, transparent 25%),
		linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, var(--muted) 75%),
		linear-gradient(-45deg, transparent 75%, var(--muted) 75%)
	`,
	backgroundSize: '12px 12px',
	backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
};

type Props = {
	urls: Record<FaviconAsset, string> | null;
	appName: string;
	themeColor: string;
	transparent: boolean;
};

export function FaviconPreview({
	urls,
	appName,
	themeColor,
	transparent,
}: Props) {
	const tabTitle = appName.trim() || 'My App';
	return (
		<div className="space-y-4" data-testid="favicon-preview">
			<span className="text-sm font-semibold">プレビュー</span>

			<div className="grid gap-6 sm:grid-cols-2">
				{/* ブラウザタブ風 */}
				<div className="space-y-2">
					<p className="text-xs text-muted-foreground">ブラウザタブ</p>
					<div className="overflow-hidden rounded-lg border border-border bg-muted/40">
						<div className="flex items-end gap-1 px-2 pt-2">
							<div className="flex max-w-[180px] items-center gap-2 rounded-t-md bg-background px-3 py-1.5 shadow-sm">
								{urls ? (
									<img
										src={urls['favicon-16x16.png']}
										width={16}
										height={16}
										alt="favicon 16px プレビュー"
										data-testid="favicon-tab-icon"
										className="h-4 w-4 shrink-0"
									/>
								) : (
									<span className="h-4 w-4 shrink-0 rounded-sm bg-muted" />
								)}
								<span className="truncate text-xs text-foreground">
									{tabTitle}
								</span>
							</div>
						</div>
						{/* アドレスバー（テーマカラーのアクセント） */}
						<div className="flex items-center gap-2 bg-background px-3 py-2">
							<span
								className="h-3 w-3 shrink-0 rounded-full"
								style={{ backgroundColor: themeColor }}
							/>
							<span className="h-2 flex-1 rounded-full bg-muted" />
						</div>
					</div>
					{/* 実寸 16 / 32 */}
					<div className="flex items-center gap-4 pt-1">
						{(['favicon-16x16.png', 'favicon-32x32.png'] as const).map(
							(asset) => (
								<div key={asset} className="flex items-center gap-2">
									<span
										className="inline-flex items-center justify-center rounded"
										style={transparent ? checkerboardStyle : undefined}
									>
										{urls ? (
											<img
												src={urls[asset]}
												width={asset === 'favicon-16x16.png' ? 16 : 32}
												height={asset === 'favicon-16x16.png' ? 16 : 32}
												alt={`${asset} プレビュー`}
												style={{
													width: asset === 'favicon-16x16.png' ? 16 : 32,
													height: asset === 'favicon-16x16.png' ? 16 : 32,
												}}
											/>
										) : (
											<span
												className="block rounded bg-muted"
												style={{
													width: asset === 'favicon-16x16.png' ? 16 : 32,
													height: asset === 'favicon-16x16.png' ? 16 : 32,
												}}
											/>
										)}
									</span>
									<span className="text-xs text-muted-foreground">
										{asset === 'favicon-16x16.png' ? '16px' : '32px'}
									</span>
								</div>
							),
						)}
					</div>
				</div>

				{/* スマホホーム画面風 */}
				<div className="space-y-2">
					<p className="text-xs text-muted-foreground">スマホのホーム画面</p>
					<div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-gradient-to-b from-muted/60 to-muted/20 px-4 py-6">
						<span
							className="inline-flex items-center justify-center overflow-hidden rounded-[22%] shadow-md"
							style={transparent ? checkerboardStyle : undefined}
						>
							{urls ? (
								<img
									src={urls['apple-touch-icon.png']}
									width={64}
									height={64}
									alt="ホーム画面アイコン プレビュー"
									data-testid="favicon-home-icon"
									className="h-16 w-16"
								/>
							) : (
								<span className="block h-16 w-16 bg-muted" />
							)}
						</span>
						<span className="max-w-[88px] truncate text-center text-[11px] text-foreground">
							{tabTitle}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
