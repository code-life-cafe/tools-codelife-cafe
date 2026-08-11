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

// カレントディレクトリがサブディレクトリでもフックが機能するようプロジェクトルートを基準にする
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const match = filePath?.match(/(^|[/\\])src[/\\]lib[/\\]tools[/\\]([^/\\]+)\.ts$/);
if (!match) process.exit(0);

const slug = match[2];
const testPath = path.join(projectRoot, 'tests', 'unit', `${slug}.test.ts`);
if (!existsSync(testPath)) process.exit(0);

// node実行ファイルは直接起動できるためshellを介さない（args配列がそのままexecvに渡る）
const result = spawnSync('node', ['--test', testPath], {
	cwd: projectRoot,
	encoding: 'utf-8',
});

if (result.status !== 0) {
	// PostToolUseはツール実行後のフックのためexit codeでは実行をブロックできない。
	// decision: "block" をstdoutに返すことでClaudeに修正を促す（Claude Code hooks reference準拠）。
	process.stdout.write(
		JSON.stringify({
			decision: 'block',
			reason: `${testPath} が失敗しました:\n${result.stdout}${result.stderr}`,
		}),
	);
	process.exit(0);
}

process.exit(0);
