import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function readStdin() {
	try {
		return JSON.parse(readFileSync(0, 'utf-8'));
	} catch {
		return null;
	}
}

const input = readStdin();
const filePath = input?.tool_input?.file_path;

if (filePath && /(^|[/\\])(src|tests)[/\\].*\.tsx?$/.test(filePath)) {
	const result = spawnSync('npx', ['biome', 'check', '--write', filePath], {
		shell: true,
		encoding: 'utf-8',
	});
	if (result.status !== 0) {
		process.stderr.write(`[format-on-edit] biome check failed:\n${result.stdout}${result.stderr}\n`);
	}
}

process.exit(0);
