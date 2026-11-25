@echo off
chcp 65001 >nul
rem AEGI 로컬 설치판: .env 의 SaaS 를 수집하고 대시보드를 연다
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.13 이상이 필요합니다: https://nodejs.org & pause & exit /b 1)
if not exist .env (echo .env 가 없습니다. .env.example 을 .env 로 복사해 키를 넣거나, start.cmd 로 화면을 열어 Adapters 에서 연결하세요. & pause & exit /b 1)
if exist dist\aegi.mjs (node dist\aegi.mjs collect --serve %*) else (call :deps && node --import tsx bin\aegi.ts collect --serve %*)
if errorlevel 1 pause
exit /b

:deps
if exist node_modules\tsx\package.json exit /b 0
echo 처음 실행: 실행에 필요한 패키지를 설치합니다 (npm install --omit=dev)
call npm install --omit=dev --no-audit --no-fund
exit /b %errorlevel%
