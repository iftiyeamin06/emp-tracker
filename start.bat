@echo off
REM Employee Tracker - uses your MySQL84 service + API (port 5000) + UI (port 5173).
REM Run by double-clicking.

set ROOT=%~dp0

sc query MySQL84 | findstr /C:"RUNNING" >nul
if errorlevel 1 (
  echo [db] starting MySQL84 service...
  net start MySQL84
  if errorlevel 1 (
    echo [db] could not start MySQL84 -- start it from Services or MySQL Workbench, then re-run.
    pause
    exit /b 1
  )
)

if not exist "%ROOT%server\node_modules\" (
  echo [setup] installing server deps...
  pushd "%ROOT%server" && call npm install --no-audit --no-fund && popd
)

if not exist "%ROOT%server\.env" (
  echo [setup] creating server\.env from .env.example...
  copy "%ROOT%server\.env.example" "%ROOT%server\.env" >nul
)

if not exist "%ROOT%.local\.migrated" (
  echo [db] first run: creating database and running migrations...
  pushd "%ROOT%server" && call npm run migrate && popd
  if errorlevel 1 (
    echo [db] migration failed -- fix the error, then delete .local\.migrated and re-run start.bat.
    pause
    exit /b 1
  )
  echo. > "%ROOT%.local\.migrated"
)

if not exist "%ROOT%client\node_modules\" (
  echo [setup] installing client deps...
  pushd "%ROOT%client" && call npm install --no-audit --no-fund && popd
)

start "Employee Tracker - API" cmd /k "cd /d %ROOT%server && npm run dev"
start "Employee Tracker - UI" cmd /k "cd /d %ROOT%client && npm run dev"

echo Waiting for the UI, then opening the browser...
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
echo All running at http://localhost:5173
pause
exit /b 0
