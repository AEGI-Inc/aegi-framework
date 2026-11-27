#!/usr/bin/env bash
# 사용: run-scheduled.sh <engine checkout 경로> [--open-issues]
set -euo pipefail

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
  echo "사용: $0 <engine checkout 경로> [--open-issues]" >&2
  exit 1
fi

CHECKOUT_DIR="$1"
shift

cd "$CHECKOUT_DIR"

if ! (git fetch -q origin main && git merge -q --ff-only origin/main); then
  echo "경고: origin/main 갱신 실패, 현재 상태로 진행합니다" >&2
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p collected/api-watch

./node_modules/.bin/tsx scripts/collect/apiWatch/watch.ts check --out "collected/api-watch/report-${STAMP}.json" "$@"

# 최근 보고서 30개만 남기고 오래된 것은 지운다
ls -1t collected/api-watch/report-*.json 2>/dev/null | tail -n +31 | xargs -r rm -f
