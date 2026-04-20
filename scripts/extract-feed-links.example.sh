#!/usr/bin/env bash
# 依赖：curl、jq。在 WeWe-RSS 已运行且已同步数据后执行。
# 用法：BASE_URL=http://localhost:4000 ./scripts/extract-feed-links.example.sh
# 或：./scripts/extract-feed-links.example.sh http://localhost:4000 500

set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:4000}}"
LIMIT="${2:-200}"
ENDPOINT="${BASE_URL}/feeds/all.json?limit=${LIMIT}&page=1"

echo "# GET ${ENDPOINT}" >&2
curl -sS "$ENDPOINT" | jq -r '.items[] | .url // .link'
