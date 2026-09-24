@echo off
REM Employee Tracker - starts Postgres + API (port 5000) + UI (port 5173).
REM Run by double-clicking (Postgres needs your interactive desktop, not a service).

set ROOT=%~dp0
set PG=%ROOT%.local\pgbin\bin
set PGDATA=%ROOT%.local\pgdata

if not exist "%PG%\postgres.exe" (
  echo [db] Postgres binaries missing under .local\pgbin -- cannot start.
  pause
  exit /b 1
)

"%PG%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
if errorlevel 1 (
  echo [db] starting Postgres...
  "%PG%\pg_ctl.exe" -D "%PGDATA%" -l "%ROOT%.local\pg.log" -o "-p 5432" start
  set TRIES=0
  :waitpg
  "%PG%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
  if not errorlevel 1 goto pgready
  set /a TRIES+=1
  if %TRIES% GEQ 15 ( echo [db] Postgres did not start -- see .local\pg.log & pause & exit /b 1 )
  timeout /t 1 /nobreak >nul
  goto waitpg
)
:pgready

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

echo All running. Open http://localhost:5173 in your browser.
