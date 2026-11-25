#!/bin/sh
# AEGI 로컬 설치판: 대시보드를 연다.
# 배포 zip(dist/ 있음)은 바로 실행한다. 저장소를 clone 한 폴더는 처음 한 번 실행용 패키지를 설치한다.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 22.13 이상이 필요합니다: https://nodejs.org"; exit 1; }
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }
if [ -f dist/aegi.mjs ]; then exec node dist/aegi.mjs start "$@"; fi
if [ ! -f node_modules/tsx/package.json ]; then
  echo "처음 실행: 실행에 필요한 패키지를 설치합니다 (npm install --omit=dev)"
  npm install --omit=dev --no-audit --no-fund || exit 1
fi
exec node --import tsx bin/aegi.ts start "$@"
