@echo off
setlocal
cd /d "%~dp0"
if /I "%~1"=="--help" (
  echo Start JobOS from this project folder. No coding assistant is required.
  echo First install: npm.cmd ci
  echo Diagnostics: npm.cmd run doctor
  echo Keep the app terminal open. Browser: http://127.0.0.1:4317/
  exit /b 0
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 or newer, then open this file again. See USER-GUIDE.md.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Run npm.cmd ci once in this folder with internet, then open this file again.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4317/ and keep this terminal open.
call npm.cmd start
if errorlevel 1 (
  echo JobOS could not start. Run npm.cmd run doctor and read USER-GUIDE.md.
  pause
)
