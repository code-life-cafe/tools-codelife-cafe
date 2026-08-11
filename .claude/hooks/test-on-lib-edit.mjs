import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function readStdin() {
	try {
		return JSON.parse(readFileSync(0, 'utf-8'));
	} catch {
		return null;
	}
}

const input = readStdin();
const filePath = input?.tool_input?.file_path;

const match = filePath?.match(/[/\\]src[/\\]lib[/\\]tools[/\\]([^/\\]+)\.ts$/);
if (!match) process.exit(0);

const slug = match[1];
const testPath = path.join('tests', 'unit', `${slug}.test.ts`);
if (!existsSync(testPath)) process.exit(0);

const result = spawnSync('node', ['--test', testPath], {
	shell: true,
	encoding: 'utf-8',
});

if (result.status !== 0) {
	process.stderr.write(
		`[test-on-lib-edit] ${testPath} failed:\n${result.stdout}${result.stderr}\n`,
	);
	process.exit(2);
}

process.exit(0);
