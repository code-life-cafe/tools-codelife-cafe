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

// 同一matcherグループ内の複数hookは並列実行されるため、整形→テストの順序を
// 保証するには1プロセス内で直列に呼ぶ必要がある（Claude hooks referenceの
// 「matching handlers run in parallel」を踏まえた対応）。

// 1. Biomeで自動整形（src/・tests/配下の.ts(x)のみ、非ブロッキング）
// npxはWindowsで.cmdシムのためshellが必須（shell:falseだとEINVAL）。
// shell経由での注入を防ぐため、パスは英数字・./\-_のみの安全な文字集合に限定する。
const SAFE_PATH_RE = /^[A-Za-z0-9_.:/\\-]+$/;

if (
	filePath &&
	SAFE_PATH_RE.test(filePath) &&
	/(^|[/\\])(src|tests)[/\\].*\.tsx?$/.test(filePath)
) {
	const formatResult = spawnSync('npx', ['biome', 'check', '--write', filePath], {
		shell: true,
		cwd: projectRoot,
		encoding: 'utf-8',
	});
	if (formatResult.status !== 0) {
		process.stderr.write(
			`[post-edit] biome check failed:\n${formatResult.stdout}${formatResult.stderr}\n`,
		);
	}
}

// 2. 整形後のファイルに対して単体テストを実行（src/lib/tools/{slug}.tsのみ）
const match = filePath?.match(/(^|[/\\])src[/\\]lib[/\\]tools[/\\]([^/\\]+)\.ts$/);
if (!match) process.exit(0);

const slug = match[2];
const testPath = path.join(projectRoot, 'tests', 'unit', `${slug}.test.ts`);
if (!existsSync(testPath)) process.exit(0);

// node実行ファイルは直接起動できるためshellを介さない（args配列がそのままexecvに渡る）
const testResult = spawnSync('node', ['--test', testPath], {
	cwd: projectRoot,
	encoding: 'utf-8',
});

if (testResult.status !== 0) {
	// PostToolUseはツール実行後のフックのためexit codeでは実行をブロックできない。
	// decision: "block" をstdoutに返すことでClaudeに修正を促す（Claude Code hooks reference準拠）。
	process.stdout.write(
		JSON.stringify({
			decision: 'block',
			reason: `${testPath} が失敗しました:\n${testResult.stdout}${testResult.stderr}`,
		}),
	);
	process.exit(0);
}

process.exit(0);
