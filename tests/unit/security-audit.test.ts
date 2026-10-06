import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, findings } from '../../scripts/security-audit.mjs';
import { resolveBaseline } from '../../scripts/security-audit-baseline.mjs';

type AuditLock = {
	lockfileVersion: number;
	packages: Record<
		string,
		{
			version: string;
			dev?: boolean;
			integrity?: string;
			dependencies?: Record<string, string>;
		}
	>;
};
const lock = (version = '1.0.0', dev = false): AuditLock => ({
	lockfileVersion: 3,
	packages: {
		'node_modules/example': { version, dev, integrity: 'sha512-example' },
	},
});
const report = (id = 'GHSA-one', severity = 'high') => ({
	auditReportVersion: 2,
	metadata: { vulnerabilities: { total: 1 } },
	vulnerabilities: {
		example: {
			via: [{ url: `https://github.com/advisories/${id}`, severity }],
			nodes: ['node_modules/example'],
		},
	},
});
test('existing vulnerabilities do not block unchanged dependencies', () => {
	assert.deepEqual(compare(report(), lock(), report(), lock()), []);
});
test('equal counts do not hide replacement with another vulnerability', () => {
	assert.equal(compare(report(), lock(), report('GHSA-two'), lock()).length, 1);
});
test('severity escalation, affected version changes and dev promotion block', () => {
	assert.equal(
		compare(report('GHSA-one', 'low'), lock(), report(), lock()).length,
		1,
	);
	assert.equal(compare(report(), lock(), report(), lock('1.1.0')).length, 1);
	assert.equal(
		compare(report(), lock('1.0.0', true), report(), lock()).length,
		1,
	);
});
test('removing a vulnerability passes', () => {
	const empty = {
		...report(),
		vulnerabilities: {},
		metadata: { vulnerabilities: { total: 0 } },
	};
	assert.deepEqual(compare(report(), lock(), empty, lock()), []);
});
test('API failures, unknown schema and missing resolved packages are rejected', () => {
	assert.throws(() => findings({ error: { code: 'E503' } }, lock()));
	assert.throws(() => findings({ ...report(), auditReportVersion: 1 }, lock()));
	assert.throws(() => findings(report(), { lockfileVersion: 3, packages: {} }));
});

test('new consumers of the same flattened vulnerable dependency are detected', () => {
	const baseLock = lock();
	const headLock = lock();
	headLock.packages['node_modules/consumer'] = {
		version: '1.0.0',
		dependencies: { example: '*' },
	};
	assert.equal(compare(report(), baseLock, report(), headLock).length, 1);
});

test('deployment baseline uses the most recently completed deployment and skips itself', async () => {
	const sha = 'a'.repeat(40);
	const get = async (path: string) =>
		path === 'actions/runs/42'
			? { id: 42, created_at: '2026-10-06T10:00:00Z' }
			: {
					workflow_runs: [
						{
							id: 43,
							created_at: '2026-10-06T11:00:00Z',
							updated_at: '2026-10-06T11:05:00Z',
							conclusion: 'success',
							head_branch: 'main',
							head_sha: 'b'.repeat(40),
						},
						{
							id: 42,
							created_at: '2026-10-06T10:00:00Z',
							conclusion: 'success',
							head_branch: 'main',
							head_sha: 'c'.repeat(40),
						},
						{
							id: 41,
							created_at: '2026-10-05T10:00:00Z',
							updated_at: '2026-10-06T12:00:00Z',
							conclusion: 'success',
							head_branch: 'main',
							head_sha: sha,
						},
					],
				};
	assert.equal((await resolveBaseline(get, '42')).head_sha, sha);
});
test('deployment without a successful baseline fails closed', async () => {
	await assert.rejects(
		resolveBaseline(
			async (path: string) =>
				path === 'actions/runs/42'
					? { id: 42, created_at: '2026-10-06T10:00:00Z' }
					: { workflow_runs: [] },
			'42',
		),
	);
});

test('upgrading only the consumer preserves an unchanged vulnerability baseline', () => {
	const baseLock = lock();
	const headLock = lock();
	baseLock.packages['node_modules/consumer'] = {
		version: '1.0.0',
		dependencies: { example: '*' },
	};
	headLock.packages['node_modules/consumer'] = {
		version: '1.1.0',
		dependencies: { example: '*' },
	};
	assert.deepEqual(compare(report(), baseLock, report(), headLock), []);
});
