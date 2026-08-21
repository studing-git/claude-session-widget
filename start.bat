@echo off
cd /d "%~dp0"
echo [update] 최신 버전 확인 중...
git pull --ff-only
npm start
pause
