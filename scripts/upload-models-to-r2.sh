#!/usr/bin/env bash
# 旧main取得方式を廃止。アップロードは固定マニフェストを使う手順で別承認する。
set -euo pipefail
printf '%s\n' 'Legacy mutable model upload is disabled. See docs/supply-chain-hardening-walkthrough.md.' >&2
exit 1
