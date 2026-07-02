import { Search } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { getSearchQueryMetadata, track } from '@/lib/analytics';
import { toolCatalog } from '@/lib/tools/catalog';
import { searchTools } from '@/lib/tools/search';
import { ToolIcon } from './ToolIcon';

export default function SearchModal() {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const filteredTools = query ? searchTools(query) : toolCatalog;

	// Track search_empty when query results in 0 tools
	const trackedQueryRef = useRef<string>('');
	useEffect(() => {
		if (!query.trim() || filteredTools.length > 0) return;
		if (trackedQueryRef.current === query) return;

		const timer = setTimeout(() => {
			if (trackedQueryRef.current !== query && filteredTools.length === 0) {
				trackedQueryRef.current = query;
				track('search_empty', getSearchQueryMetadata(query));
			}
		}, 500);

		return () => clearTimeout(timer);
	}, [query, filteredTools.length]);

	// Search trigger & Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				setIsOpen((prev) => !prev);
			}
			if (e.key === 'Escape' && isOpen) {
				e.preventDefault();
				setIsOpen(false);
			}
		};

		const handleOpenSearch = () => setIsOpen(true);

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('open-search', handleOpenSearch);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('open-search', handleOpenSearch);
		};
	}, [isOpen]);

	// Reset state and focus input when opened
	useEffect(() => {
		if (isOpen) {
			setQuery('');
			setActiveIndex(0);
			setTimeout(() => {
				inputRef.current?.focus();
			}, 0);
		}
	}, [isOpen]);

	// Handle keyboard navigation within the modal
	useEffect(() => {
		if (!isOpen) return;

		const handleModalKeyDown = (e: KeyboardEvent) => {
			// IME変換中のキー操作（変換確定のEnter・候補選択の矢印キー）は無視する
			// keyCode 229 は一部ブラウザでIME処理中を示すフォールバック
			if (e.isComposing || e.keyCode === 229) return;
			if (filteredTools.length === 0) return;

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setActiveIndex((prev) => (prev + 1) % filteredTools.length);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setActiveIndex(
					(prev) => (prev - 1 + filteredTools.length) % filteredTools.length,
				);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				window.location.href = filteredTools[activeIndex]?.href || '/';
			}
		};

		window.addEventListener('keydown', handleModalKeyDown);
		return () => window.removeEventListener('keydown', handleModalKeyDown);
	}, [isOpen, filteredTools, activeIndex]);

	// Handle background click
	const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if (e.target === e.currentTarget) {
			setIsOpen(false);
		}
	};

	if (!isOpen) return null;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop closes on click
		<div
			className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-background/80 backdrop-blur-sm"
			role="presentation"
			onClick={handleBackdropClick}
			onKeyDown={(e) => {
				if (e.key === 'Escape') setIsOpen(false);
			}}
		>
			<div className="relative w-full max-w-xl mx-4 overflow-hidden bg-card border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
				<div className="flex items-center px-4 py-3 border-b border-border">
					<Search className="w-5 h-5 text-muted-foreground mr-3" />
					<input
						ref={inputRef}
						className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
						placeholder="ツールを検索... (Enterで移動)"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActiveIndex(0);
						}}
					/>
					<kbd className="hidden sm:inline-block rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground font-mono">
						ESC
					</kbd>
				</div>
				<div className="max-h-[60vh] overflow-y-auto p-2">
					{filteredTools.length === 0 ? (
						<div className="p-4 text-center text-sm text-muted-foreground">
							一致するツールが見つかりません。
						</div>
					) : (
						<div className="flex flex-col gap-1">
							{filteredTools.map((tool, index) => (
								<a
									key={tool.id}
									href={tool.href}
									data-testid="search-result"
									className={`flex flex-col gap-1 px-4 py-3 rounded-lg transition-colors ${
										index === activeIndex
											? 'bg-primary/10 text-foreground'
											: 'hover:bg-muted text-muted-foreground hover:text-foreground'
									}`}
									onMouseEnter={() => setActiveIndex(index)}
									onClick={() => setIsOpen(false)}
								>
									<div className="flex items-center gap-3">
										<span className="text-primary" aria-hidden="true">
											<ToolIcon name={tool.icon} className="h-5 w-5" />
										</span>
										<div className="flex flex-col">
											<span
												className={`font-medium ${index === activeIndex ? 'text-primary' : 'text-foreground'}`}
											>
												{tool.title}
											</span>
											<span className="text-xs opacity-80">
												{tool.description}
											</span>
										</div>
									</div>
								</a>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
