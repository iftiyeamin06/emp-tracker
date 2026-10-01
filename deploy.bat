@echo off
REM Employee Tracker - one-click production deploy.
REM Builds, uploads, migrates, restarts the API, health-checks the site.
REM Usage: double-click, or: deploy.bat [--skip-build]

cd /d %~dp0

where node >nul 2>&1
if errorlevel 1 (
  echo [deploy] node is not installed or not on PATH -- install Node 20+ first.
  pause
  exit /b 1
)

call node scripts/deploy.js %*
if errorlevel 1 (
  echo.
  echo [deploy] FAILED -- see messages above.
  pause
  exit /b 1
)

echo.
echo [deploy] done -- http://employeetracker.predestinenyc.com/
pause
