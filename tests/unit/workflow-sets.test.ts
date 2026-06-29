import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	getWorkflowContext,
	getWorkflowToolIds,
	workflowSets,
} from '../../src/lib/tools/workflow-sets.ts';

test('すべてのワークフローセット内のツールがカタログに実在する', () => {
	assert.ok(workflowSets.length > 0);
});

test('csv-fixer のワークフローコンテキストが正しく取得できる', () => {
	const ctx = getWorkflowContext('csv-fixer');
	assert.notEqual(ctx, null);
	assert.equal(ctx?.set.id, 'csv-preprocessing');
	assert.equal(ctx?.currentIndex, 0);
	assert.equal(ctx?.prev, null);
	assert.equal(ctx?.next?.id, 'csv-editor');
	assert.equal(ctx?.allSteps.length, 3);
});

test('csv-editor のワークフローコンテキスト（前後両方あり）が正しく取得できる', () => {
	const ctx = getWorkflowContext('csv-editor');
	assert.notEqual(ctx, null);
	assert.equal(ctx?.prev?.id, 'csv-fixer');
	assert.equal(ctx?.next?.id, 'json-csv');
});

test('getWorkflowToolIds で自身以外のステップツールIDが取得できる', () => {
	const ids = getWorkflowToolIds('csv-fixer');
	assert.deepEqual(ids, ['csv-editor', 'json-csv']);
});

test('未所属のツールIDの場合は null / 空配列を返す', () => {
	assert.equal(getWorkflowContext('non-existent-tool'), null);
	assert.deepEqual(getWorkflowToolIds('non-existent-tool'), []);
});
