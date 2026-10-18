# Analytics reliability verification

Scope: R3 analytics; draft only, no merge/deploy. User-authorized investigation and minimal correction; no new event types, identifiers, input/file data collection, dependencies, Cloudflare configuration, secrets, access settings, UI wording or unrelated tools changed.

Baseline: origin/main 80669ca. EDITH existing checkout D:/tools-codelife-cafe discovered read-only (stale main 00bc72c); fresh clone in task-5/repository and isolated worktree task-5/analytics-reliability used to avoid shared bot work. GitHub open PRs #491 and #456 were unrelated; analytics-named remote branches last changed in June. Parent subsequently reported chief paused overlapping work. Google Sheets/GAS tabs and files were not touched; Grok was not used for implementation.

Changes: preserve Analytics Engine binding receiver in server page_view; skip AE writes only for explicit X-CLC-Synthetic: 1; apply opt-out to configured Playwright contexts; shared browser fixture intercepts event POSTs and blocks RUM scripts/collectors. External monitor adoption remains outstanding. Schema, existing classifications, run meaning and privacy exclusions remain unchanged. Opt-out is not an access-control mechanism and is not stored.

Evidence:
- New receiver-sensitive and synthetic-exclusion tests both failed before production changes (0 vs 1 page_view; 2 stored events vs none).
- Targeted node tests: 29/29 pass (receiver, waitUntil, exact opt-out value, ordinary schema, traffic classification, privacy exclusions, error isolation).
- Full unit after complete build: 1780/1780 pass. First run against incomplete build failed existing links.test.ts because dist/og-image.png was not generated; resolved by complete build, no test changes.
- npm run build: pass; initial sandbox-only font DNS failure, same unchanged build succeeded with network execution approval. No network/access configuration changed.
- npx tsc --noEmit --pretty false --ignoreDeprecations 6.0: pass.
- npm run lint: exit 0, 19 existing warnings and 1 existing info (including qr-reader hook dependencies, WebMCP assertions and mermaid template style).
- E2E: analytics-consistency + analytics-synthetic, both chromium and mobile-chrome. See PR for final results and SHA.

Limitations: local tests stub binding writes and intercept browser events; no production durable storage was queried or generated. Stored event verification needs parent-authorized Cloudflare read-only aggregates and deployed SHA/binding. No evidence establishes the reported 92-day gap, 158 self-tests/159 bots, or 13 humans. RUM differs from Analytics Engine. HEAD/error HTML semantics unchanged. No SPA router found in src, so server navigation semantics retained; offline/SW-cached displays need not generate page_view. New common success/reuse tracking requires separate design approval.

Required gates before any merge: independent different-model review, R3 risk review/human approval, latest required CI, production read-only evidence and monitor-runner adoption. No approval is inferred from absent findings or test success.

Independent review follow-up (loop 1/3): Claude Sonnet statically reviewed commit 696b594 using only Read/Grep/Glob. It identified test inadequacy around CORS false positives and manual browser.newContext contexts. The synthetic E2E now asserts direct fixture abort/fulfill handler evidence and exercises a beacon script element; manual-context setup requirements are documented. No production logic changed in this follow-up. See PR for final head and re-review results.
