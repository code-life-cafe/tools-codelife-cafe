# CSV extraction/sort WebMCP verification

Risk: R3 (WebMCP). Maker: Codex. Independent reviewer: agy gemini-3.8-flash-high.
Base: d6a80f8d73399b183e6fc1243af3a9e0e13412cd. Approval: approved-csv-query-plan.md.
Notion AC: https://app.notion.com/p/3f1dfd36033681699144f366194196c5

- query_csv: explicit physical columns and comparison type, one filter and stable sort, CSV/TSV; all processing local; UI/history not changed.
- Bounds: 100000 codepoints, 1000 data rows, 50 columns, 20000 padded cells incl. header, success JSON 1MiB. Strict parse and deterministic error priority.
- npm run test:unit: 1619/1619 passed (13 new tests). tsc --noEmit --pretty false --ignoreDeprecations 6.0: passed. npm run build: passed (119 pages; 19 descriptors; prior 18 unchanged).
- npm run lint: exit 0, 15 existing warnings and 1 info; changed files clean.
- Related E2E first run: 72/74 passed, mobile Undo accessible-name locator failed twice. Changed only locator to existing title. Final CSV WebMCP rerun: 14/14 PC/mobile passed. Remaining 60 related tests passed in first run.
- Disposable PWA warm-cache acceptance: 2/2 PC/mobile passed; offline UI and registered MCP execution; CsvEditor asset cached; cleanup registrations=0, caches=[], local/session storage=0. This does not prove full precache or R2 model caching. No persistent user browser PWA settings changed.
- Actual native WebMCP via Codex in-app browser on built localhost:4397/csv-editor/: tool discovered and executed (no mock). Filter B>=100, sort B descending returned ID,価格 CRLF 002,120 CRLF 001,100 and counts 3/2/2; quoted-tab TSV ascending passed; malformed quote returned fixed syntax error; separate input execution preserved existing UI table and Undo state (unchanged AX tree). Screenshot: acceptance-native.png.
- Boundary/privacy/error/lifecycle tests use existing E2E fixture; those tests do not by themselves prove production network behavior. Production deployment not performed.
- Mutation check: increasing data-row cap to 1001 caused boundary unit failure; exact source restored and tests passed.
- agy round 1: two test gaps and one option-contract clarification. Added text descending ties, both header modes with empty input, numeric empty/notEmpty valid/invalid prevalidation. No production or specification change. Round 2: approve, zero findings. Raw structured results and reviewed-file hashes retained alongside this file. One correction loop.
- Draft PR only. Latest GitHub CI and formal bot Code/Security review are separate gates; no Merge/Deploy authorization in this task.
- Existing dirty changes in D:/tools-codelife-cafe are excluded. Reused clean managed checkout on codex/webmcp-csv-query.
