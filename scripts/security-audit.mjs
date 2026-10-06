import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
function dependencyRoutes(lock, target) {
  const reverse = new Map();
  for (const [parent, pkg] of Object.entries(lock.packages)) {
    const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
    for (const name of names) {
      let directory = parent;
      while (true) {
        const child = `${directory ? `${directory}/` : ''}node_modules/${name}`;
        if (lock.packages[child]) {
          if (!reverse.has(child)) reverse.set(child, []);
          reverse.get(child).push(parent);
          break;
        }
        if (!directory) break;
        const index = directory.lastIndexOf('/node_modules/');
        directory = index < 0 ? '' : directory.slice(0, index);
      }
    }
  }
  const edges = new Set();
  const visited = new Set();
  const queue = [target];
  while (queue.length) {
    const child = queue.pop();
    if (visited.has(child)) continue;
    visited.add(child);
    for (const parent of reverse.get(child) ?? []) {
      const pkg = lock.packages[parent];
      edges.add(JSON.stringify([parent, pkg.version ?? null, Boolean(pkg.dev), Boolean(pkg.optional), child]));
      queue.push(parent);
    }
  }
  return [...edges].sort();
}
export function findings(report, lock) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities || lock.lockfileVersion < 2 || !lock.packages) {
    throw new Error('監査結果またはlockfileの形式が不正です');
  }
  const result = new Map();
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    if (!Array.isArray(item.via) || !item.via.length || !Array.isArray(item.nodes) || !item.nodes.length) throw new Error('監査対象の依存経路が不明です');
    // Meta-vulnerabilities are represented by their concrete advisory below.
    for (const advisory of item.via.filter(value => typeof value === 'object' && value !== null)) {
      if (!advisory.url || !severities.includes(advisory.severity)) throw new Error('アドバイザリの識別子・重大度が不明です');
      for (const node of item.nodes) {
        const pkg = lock.packages[node];
        if (!pkg?.version) throw new Error(`解決バージョンが不明です: ${node}`);
        const key = JSON.stringify([advisory.url, name, node, pkg.version, pkg.integrity ?? null, Boolean(pkg.dev), Boolean(pkg.optional), dependencyRoutes(lock, node)]);
        result.set(key, { name, node, version: pkg.version, advisory: advisory.url, severity: advisory.severity });
      }
    }
  }
  if (report.metadata.vulnerabilities.total > 0 && !result.size) throw new Error('具体的なアドバイザリを取得できません');
  return result;
}
export function compare(baseReport, baseLock, headReport, headLock) {
  const base = findings(baseReport, baseLock);
  const head = findings(headReport, headLock);
  return [...head].filter(([key, value]) => !base.has(key) || severities.indexOf(value.severity) > severities.indexOf(base.get(key).severity)).map(([, value]) => value);
}
function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} に失敗しました`);
  return result.stdout;
}
function scan(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'security-audit-'));
  try {
    for (const file of ['package.json', 'package-lock.json']) writeFileSync(join(dir, file), git('show', `${ref}:${file}`));
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    const audit = spawnSync('npm', ['audit', '--json', '--package-lock-only', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    if (audit.error || ![0, 1].includes(audit.status)) throw new Error('npm audit の実行に失敗しました');
    const report = JSON.parse(audit.stdout);
    findings(report, lock); // Reject API errors even when npm exits with code 1.
    return { report, lock };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export function main(baseRef, headRef = 'HEAD') {
  if (!baseRef || !/^[0-9a-f]{40}$/.test(baseRef)) throw new Error('比較元の完全SHAが必要です');
  const headSha = git('rev-parse', '--verify', headRef).trim();
  git('merge-base', '--is-ancestor', baseRef, headSha);
  const base = scan(baseRef);
  const head = scan(headSha);
  const added = compare(base.report, base.lock, head.report, head.lock);
  const summary = `## 依存脆弱性の差分監査\n\n比較元: ${baseRef}\n対象: ${headSha}\n新規・悪化: ${added.length}件（全重大度）\n\n${added.map(v => `- ${v.name}@${v.version} / ${v.node} / ${v.severity} / ${v.advisory}`).join('\n')}\n`;
  console.log(summary);
  const outputDir = process.env.SECURITY_AUDIT_DIR;
  if (outputDir) {
    writeFileSync(join(outputDir, 'base.json'), JSON.stringify(base.report, null, 2));
    writeFileSync(join(outputDir, 'head.json'), JSON.stringify(head.report, null, 2));
    writeFileSync(join(outputDir, 'delta.json'), JSON.stringify({ baseSha: baseRef, headSha, added }, null, 2));
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (added.length) throw new Error('新規または悪化した依存脆弱性を検出しました');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.env.AUDIT_BASE_SHA ?? process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
