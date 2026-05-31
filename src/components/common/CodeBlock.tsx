import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
	/** テキスト内容（行数の計算に使用） */
	content: string;
	/** dangerouslySetInnerHTML で描画する場合の HTML */
	htmlContent?: string;
	/** React ノードで描画する場合（htmlContent より優先） */
	children?: React.ReactNode;
	/** 追加の CSS クラス */
	className?: string;
	/** 行番号表示のオン/オフ（デフォルト: true） */
	showLineNumbers?: boolean;
	/** ハイライトする行番号のセット（エラー行など） */
	highlightLines?: Set<number>;
	/** 最小高さ */
	minHeight?: string;
}

export default function CodeBlock({
	content,
	htmlContent,
	children,
	className,
	showLineNumbers = true,
	highlightLines,
	minHeight = '200px',
}: CodeBlockProps) {
	const contentRef = useRef<HTMLPreElement>(null);
	const gutterRef = useRef<HTMLDivElement>(null);
	const [lineCount, setLineCount] = useState(1);

	useEffect(() => {
		const count = content ? content.split('\n').length : 1;
		setLineCount(count);
	}, [content]);

	const handleScroll = useCallback(() => {
		if (contentRef.current && gutterRef.current) {
			gutterRef.current.scrollTop = contentRef.current.scrollTop;
		}
	}, []);

	const lines = Array.from({ length: lineCount }, (_, i) => i + 1);

	return (
		<div
			className={cn(
				'flex rounded-xl border border-border bg-card overflow-hidden font-mono-tool text-sm',
				className,
			)}
			style={{ minHeight }}
		>
			{/* 行番号ガター */}
			{showLineNumbers && (
				<div
					ref={gutterRef}
					className="shrink-0 w-12 border-r bg-muted/40 text-right pr-2 py-3 overflow-hidden text-xs text-muted-foreground select-none"
					aria-hidden="true"
				>
					{lines.map((num) => (
						<div
							key={num}
							className={cn(
								'leading-5 h-5 px-1',
								highlightLines?.has(num) &&
									'bg-destructive/20 text-destructive font-bold rounded-sm',
							)}
						>
							{num}
						</div>
					))}
				</div>
			)}

			{/* コンテンツ */}
			<pre
				ref={contentRef}
				onScroll={handleScroll}
				className="flex-1 p-3 m-0 overflow-auto whitespace-pre-wrap break-all leading-5"
			>
				{children ? (
					<code>{children}</code>
				) : htmlContent ? (
					<code
						// biome-ignore lint/security/noDangerouslySetInnerHtml: syntax highlighting output is sanitized
						dangerouslySetInnerHTML={{ __html: htmlContent }}
					/>
				) : (
					<code>{content}</code>
				)}
			</pre>
		</div>
	);
}
