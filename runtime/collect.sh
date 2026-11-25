#!/bin/sh
# AEGI 로컬 설치판: .env 의 SaaS 를 수집하고 대시보드를 연다
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 22.13 이상이 필요합니다: https://nodejs.org"; exit 1; }
[ -f .env ] || { echo ".env 가 없습니다. .env.example 을 .env 로 복사해 키를 넣거나, start.sh 로 화면을 열어 Adapters 에서 연결하세요."; exit 1; }
if [ -f dist/aegi.mjs ]; then exec node dist/aegi.mjs collect --serve "$@"; fi
if [ ! -f node_modules/tsx/package.json ]; then
  echo "처음 실행: 실행에 필요한 패키지를 설치합니다 (npm install --omit=dev)"
  npm install --omit=dev --no-audit --no-fund || exit 1
fi
exec node --import tsx bin/aegi.ts collect --serve "$@"
