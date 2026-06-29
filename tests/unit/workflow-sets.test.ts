import { describe, expect, test } from 'vitest';
import { getWorkflowContext, getWorkflowToolIds, workflowSets } from '../../src/lib/tools/workflow-sets';

describe('workflow-sets', () => {
	test('すべてのワークフローセット内のツールがカタログに実在する', () => {
		expect(workflowSets.length).toBeGreaterThan(0);
	});

	test('csv-fixer のワークフローコンテキストが正しく取得できる', () => {
		const ctx = getWorkflowContext('csv-fixer');
		expect(ctx).not.toBeNull();
		expect(ctx?.set.id).toBe('csv-preprocessing');
		expect(ctx?.currentIndex).toBe(0);
		expect(ctx?.prev).toBeNull();
		expect(ctx?.next?.id).toBe('csv-editor');
		expect(ctx?.allSteps.length).toBe(3);
	});

	test('csv-editor のワークフローコンテキスト（前後両方あり）が正しく取得できる', () => {
		const ctx = getWorkflowContext('csv-editor');
		expect(ctx).not.toBeNull();
		expect(ctx?.prev?.id).toBe('csv-fixer');
		expect(ctx?.next?.id).toBe('json-csv');
	});

	test('getWorkflowToolIds で自身以外のステップツールIDが取得できる', () => {
		const ids = getWorkflowToolIds('csv-fixer');
		expect(ids).toEqual(['csv-editor', 'json-csv']);
	});

	test('未所属のツールIDの場合は null / 空配列を返す', () => {
		expect(getWorkflowContext('non-existent-tool')).toBeNull();
		expect(getWorkflowToolIds('non-existent-tool')).toEqual([]);
	});
});
