import { ChevronDown, Info } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { CipherAlgorithm } from '@/lib/cipher';

interface AlgorithmInfoProps {
	algorithm: CipherAlgorithm;
}

const infoContent: Record<CipherAlgorithm, string> = {
	caesar:
		'文字を指定した数だけずらす古典暗号。紀元前1世紀のジュリアス・シーザーが使用したことに由来。英字は大文字・小文字それぞれの26文字、かなは「あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん」の46文字を循環します。カタカナも同じ順序です。濁音・半濁音は基字と濁点・半濁点に分解し、基字をずらした後、結合できる場合は再結合します。小書きかな・長音・漢字・半角カナ・数字・記号はシフトしません。Unicodeの分解・再結合を行うため、表現が正規化される場合があります。',
	rot13:
		'シーザー暗号のシフト数を13に固定した方式。英字のみ対応。2回適用すると元に戻る特性がある。ネタバレ防止などに利用される。',
	reverse:
		'テキストの文字順を逆にする変換です。絵文字やサロゲートペアにも対応。秘密情報の保護には使えません。',
	morse:
		'文字を短点（・）と長点（−）の組み合わせで表現する符号化方式。国際モールス符号に準拠。英字・数字・主要記号に対応。',
};

export function AlgorithmInfo({ algorithm }: AlgorithmInfoProps) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="w-full rounded-md border bg-card p-4 shadow-sm"
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Info className="h-5 w-5 text-primary" />
					<h3 className="font-medium">このアルゴリズムについて</h3>
				</div>
				<CollapsibleTrigger asChild>
					<Button variant="ghost" size="sm" className="w-9 p-0">
						<ChevronDown
							className={`h-4 w-4 transition-transform duration-200 ${
								isOpen ? 'rotate-180' : ''
							}`}
						/>
						<span className="sr-only">Toggle info</span>
					</Button>
				</CollapsibleTrigger>
			</div>
			<CollapsibleContent className="mt-4 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed animate-in slide-in-from-top-2 fade-in-0">
				{infoContent[algorithm]}
			</CollapsibleContent>
		</Collapsible>
	);
}
