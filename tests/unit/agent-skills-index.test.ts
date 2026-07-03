import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const AGENT_SKILLS_DIR = path.resolve(
	import.meta.dirname,
	'../../public/.well-known/agent-skills',
);
const SITE_ORIGIN = 'https://tools.codelife.cafe';

type SkillEntry = {
	name: string;
	type: string;
	description: string;
	url: string;
	digest: string;
};

function loadIndex(): { $schema: string; skills: SkillEntry[] } {
	return JSON.parse(
		fs.readFileSync(path.join(AGENT_SKILLS_DIR, 'index.json'), 'utf-8'),
	);
}

test('index.json: Agent Skills Discovery RFC の必須フィールドを満たす', () => {
	const index = loadIndex();
	assert.equal(
		index.$schema,
		'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
	);
	assert.ok(Array.isArray(index.skills) && index.skills.length > 0);
	for (const skill of index.skills) {
		assert.match(skill.name, /^[a-z0-9-]+$/, `invalid name: ${skill.name}`);
		assert.ok(['skill-md', 'archive'].includes(skill.type));
		assert.ok(skill.description.length > 0);
		assert.ok(skill.url.startsWith(`${SITE_ORIGIN}/.well-known/agent-skills/`));
		assert.match(skill.digest, /^sha256:[0-9a-f]{64}$/);
	}
});

test('index.json: digestが参照先SKILL.mdの実体と一致する', () => {
	const index = loadIndex();
	for (const skill of index.skills) {
		const relPath = skill.url.replace(
			`${SITE_ORIGIN}/.well-known/agent-skills/`,
			'',
		);
		const filePath = path.join(AGENT_SKILLS_DIR, relPath);
		assert.ok(fs.existsSync(filePath), `skill file not found: ${relPath}`);
		// .gitattributes で eol=lf 固定のためデプロイされるバイト列はLF。
		// Windows等でのローカルチェックアウト差異を吸収するためCRLFを正規化して比較する。
		const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
		const digest = crypto
			.createHash('sha256')
			.update(content, 'utf8')
			.digest('hex');
		assert.equal(
			skill.digest,
			`sha256:${digest}`,
			`digest mismatch for ${skill.name}: SKILL.md を更新した場合は index.json の digest も更新してください`,
		);
	}
});
