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

// npxはWindowsで.cmdシムのためshellが必須（shell:falseだとEINVAL）。
// shell経由での注入を防ぐため、パスは英数字・./\-_のみの安全な文字集合に限定する。
const SAFE_PATH_RE = /^[A-Za-z0-9_.:/\\-]+$/;

if (
	filePath &&
	SAFE_PATH_RE.test(filePath) &&
	/(^|[/\\])(src|tests)[/\\].*\.tsx?$/.test(filePath)
) {
	const result = spawnSync('npx', ['biome', 'check', '--write', filePath], {
		shell: true,
		encoding: 'utf-8',
	});
	if (result.status !== 0) {
		process.stderr.write(`[format-on-edit] biome check failed:\n${result.stdout}${result.stderr}\n`);
	}
}

process.exit(0);
