import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToolAnalytics } from '@/lib/hooks/useToolAnalytics';
import { provideToolsFromFactory } from '@/lib/webmcp';
import { uuidTool } from '@/lib/webmcp/tools/uuid.webmcp';
import { AnalyzePanel } from './AnalyzePanel';
import { GeneratePanel } from './GeneratePanel';

type Mode = 'generate' | 'analyze';

export function IdGeneratorPage() {
	const { trackRun, trackRunDebounced } = useToolAnalytics('uuid');
	const [mode, setMode] = useState<Mode>('generate');

	// --- WebMCP Tool Registration ---
	useEffect(() => {
		return provideToolsFromFactory([uuidTool]);
	}, []);

	return (
		<div className="space-y-6">
			<Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
				<TabsList className="w-full grid grid-cols-2">
					<TabsTrigger value="generate">生成</TabsTrigger>
					<TabsTrigger value="analyze">判定・解析</TabsTrigger>
				</TabsList>
				<TabsContent value="generate" className="mt-4">
					<GeneratePanel onGenerated={trackRun} />
				</TabsContent>
				<TabsContent value="analyze" className="mt-4">
					<AnalyzePanel onAnalyzed={trackRunDebounced} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
