---
name: tools-codelife-cafe-guide
description: Guide for using tools.codelife.cafe, a collection of privacy-first Japanese business web tools. Use when you need browser-based text conversion, encoding, image processing, PDF utilities, or data formatting where input data must never leave the client.
---

# tools.codelife.cafe Usage Guide

tools.codelife.cafe は日本語業務に特化したWebツール集です。すべてのツールが完全クライアントサイドで動作し、入力データをサーバーへ送信しません。

All tools on this site run entirely in the browser (client-side). Input data is never sent to a server, which makes the tools safe for confidential business data.

## Discovering tools

- Machine-readable tool index (title, URL, description): https://tools.codelife.cafe/llms.txt
- Detailed tool reference (use cases, inputs, outputs, options): https://tools.codelife.cafe/llms-full.txt
- Human-readable catalog: https://tools.codelife.cafe/

## Using tools programmatically

On the homepage (https://tools.codelife.cafe/), the site registers WebMCP tools via the Model Context API on page load:

- `list_tools` — returns the full catalog of available tools (id, title, description, url, category).
- `search_tools` — searches the catalog by keyword (Japanese or English); input: `{ "query": "..." }`.

Some individual tool pages register additional WebMCP tools for direct execution (for example, hash generation on /hash and Japanese consumption-tax calculation on /tax).

## Notes for agents

- Pages are static HTML and can be fetched directly; each tool page describes its purpose in Japanese.
- Tool state can often be shared via a `?settings=` URL parameter; such URLs are marked `noindex`.
- There is no server-side API: processing happens in the browser, so executing a tool requires a browser context (or use the WebMCP tools above).
