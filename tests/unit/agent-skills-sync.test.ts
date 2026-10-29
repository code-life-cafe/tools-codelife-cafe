import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// .claude/skills（Claude Code）と .agents/skills（他のエージェント）は同一内容の複製。
// 片方だけ更新されて乖離しないことを検査する。
const ROOT = path.resolve(import.meta.dirname, '../..');
const SKILLS = ['add-tool', 'gen-test', 'hard-task'];

for (const name of SKILLS) {
	test(`.agents/skills/${name} と .claude/skills/${name} が同一`, () => {
		const claude = fs.readFileSync(
			path.join(ROOT, '.claude/skills', name, 'SKILL.md'),
			'utf8',
		);
		const agents = fs.readFileSync(
			path.join(ROOT, '.agents/skills', name, 'SKILL.md'),
			'utf8',
		);
		assert.equal(agents, claude);
	});
}

test('CLAUDE.md は AGENTS.md を import している', () => {
	const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
	assert.match(claude, /^@AGENTS\.md$/m);
});
