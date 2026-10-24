# Markdown SVG image policy audit

- Base: `dc76201302a6be03e4b008988d0fa724e2677710`
- Branch: `codex/fix-markdown-external-svg-images`
- Scope: Markdown sanitizer logic, image-policy regression test, and this walkthrough. No UI wording, dependency, configuration, CI, or unrelated changes.
- Risk: R3 (privacy-sensitive sanitizer repair); independent review and human merge approval remain required.
- Finding: `src/lib/tools/markdown.ts:svg-external-image-policy-gap`.

## Acceptance criteria

1. Markdown image / HTML `img` external `src` and `srcset` remain disabled.
2. SVG `image` / `feImage` must not retain automatically loaded external image references through `href` or `xlink:href`, including relative and protocol-relative references.
3. Supported embedded `data:image/` images, safe SVG geometry, ordinary Markdown, and normal hyperlinks retain their behavior.
4. HTML download uses the same sanitized output as preview.
5. Regression checks fail against the unmodified sanitizer and pass after the smallest confirmed repair.

## Source evidence

`renderMarkdown` sanitizes marked output using DOMPurify. Its existing `afterSanitizeAttributes` hook restricts only uppercase `IMG` and its `src` / `srcset` attributes. SVG image references are not covered by that hook. The installed, version-matched DOMPurify 3.4.13 source includes SVG `image` / `feImage` and corresponding URL attributes in its default allowlists. This is a candidate privacy policy gap, not proof of runtime network traffic or script execution.

The UI stores `renderMarkdown` output in `html`; preview inserts that value and the download calls `buildStandaloneHtml(html, 'document')`.

## Reproduction fixture

`tests/e2e/markdown-image-policy.spec.ts` uses only dummy image URLs under loopback `http://127.0.0.1:49383/markdown-image-probe/`, with a Playwright route returning an empty image response. It observes attempted requests, checks removed external attributes, retains embedded PNG data / SVG geometry / links, and inspects the actual HTML download. It imports the project's `fixtures/base.ts`.

A minimal candidate input is:

```html
<svg xmlns="http://www.w3.org/2000/svg">
  <image href="http://127.0.0.1:49383/markdown-image-probe/href.png" width="1" height="1"/>
</svg>
```

## Repair

The existing attribute hook now checks SVG namespace elements with local name `image` or `feImage`. Each `href` and `xlink:href` is independently restricted by the same `data:image/` allowance already used for HTML images. Other SVG geometry, normal links, and the existing HTML IMG rule are unchanged. No dependencies were added.

## Runtime verification

Executed the original `/source/src/lib/tools/markdown.ts` using an isolated Node 22.22.3 process with the existing DOMPurify 3.4.13, marked 18.0.11, and JSDOM 25.0.1. A scratch harness outside the repository provided the DOM; JSDOM used neither script execution nor resource loading. A generic TypeScript loader used the already installed TypeScript compiler without reading repository configuration or plugins. Only the designated worktree, read-only dependency directories, and one dummy fixture file were mounted.

The OS runner cleared ambient environment, denied external network and child processes, mounted inputs read-only, and used explicit CPU 10 s, address-space 768 MiB, NPROC 32, scratch 64 MiB, and wall 60 s bounds. Initial wall 20 s attempts timed out while loading JSDOM; these are infrastructure timeouts, not successful tests. The parent explicitly approved a fixed wall 60 s limit with the other bounds unchanged.

- Baseline observation: exit 0; sanitized output retained SVG image external `href` / `xlink:href`, relative and protocol-relative URLs, external `feImage` href, and external xlink on an image with a safe data href. HTML IMG external src/srcset was removed.
- Regression against unmodified source: exit 1, `AssertionError: svg-href retains href`.
- Same regression against repaired source: exit 0, `PASS: sanitized HTML image policy and export assertions`.
- The passing assertions verify external attribute removal, HTML IMG behavior, embedded PNG data in HTML/SVG, independent mixed href/xlink handling, SVG circle geometry, normal heading/link rendering, and `buildStandaloneHtml` retaining safe data without probe URLs.

The scratch harness was invoked as `/usr/bin/node --jitless --single-threaded --v8-pool-size=0 --max-old-space-size=128 --import /runner/ts-loader.mjs /fixture.mjs observe` and then `assert` using the approved runner. It is not a new repository dependency or production entry point.

## Remaining checks and limits

- The repository Playwright regression is prepared but has not been executed. It imports the project's base fixture, observes attempted loopback requests, inspects live preview attributes, and reads the actual HTML download.
- Chromium network requests, browser layout, production behavior, and script execution / text exfiltration were not measured. JSDOM sanitized-attribute evidence must not be presented as a real browser network observation.
- Local repository lint, full type/build checks, full unit suite, and E2E were not executed: the available Biome binary is for Windows and is not executable inside the Linux runner, and target-controlled CLI tools were not run on the host. Existing GitHub CI after PR creation must provide its separate lint/E2E evidence. No new packages were downloaded or installed.
- Keep the PR Draft. R3 review, human approval, and latest-head required CI remain separate merge gates.
