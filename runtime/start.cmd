@echo off
chcp 65001 >nul
rem AEGI 로컬 설치판: 대시보드를 연다.
rem 배포 zip(dist\ 있음)은 바로 실행한다. 저장소를 clone 한 폴더는 처음 한 번 실행용 패키지를 설치한다.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.13 이상이 필요합니다: https://nodejs.org & pause & exit /b 1)
if not exist .env if exist .env.example copy .env.example .env >nul
if exist dist\aegi.mjs (node dist\aegi.mjs start %*) else (call :deps && node --import tsx bin\aegi.ts start %*)
if errorlevel 1 pause
exit /b

:deps
if exist node_modules\tsx\package.json exit /b 0
echo 처음 실행: 실행에 필요한 패키지를 설치합니다 (npm install --omit=dev)
call npm install --omit=dev --no-audit --no-fund
exit /b %errorlevel%
