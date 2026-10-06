import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, findings } from '../../scripts/security-audit.mjs';

const lock = (version = '1.0.0', dev = false) => ({
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
