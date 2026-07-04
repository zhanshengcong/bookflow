@echo off
setlocal enabledelayedexpansion

set "NODE=D:/program/nvm/v22.22.0/node.exe"
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "BACKEND_PORT=3001"
set "FRONTEND_PORT=3000"
set "NPM_CACHE=E:/WorkBuddy/2026-07-02-10-18-41/.npm-cache"

:: Build full paths
set "BACKEND_DIR=%ROOT%\server"
set "FRONTEND_DIR=%ROOT%\frontend"
set "HEALTHCHECK=%ROOT%\scripts\healthcheck.js"
set "HEALTH_URL=http://localhost:%BACKEND_PORT%/api/health"

echo ========================================
echo   BookFlow Startup Script
echo ========================================
echo.

:: Release backend port
echo [1/3] Checking port %BACKEND_PORT% ...
call :kill_port %BACKEND_PORT% "BookFlow Backend"
if errorlevel 1 exit /b 1

:: Release frontend port 1
echo.
echo [2/3] Checking port %FRONTEND_PORT% ...
call :kill_port %FRONTEND_PORT% "Vite Frontend"
if errorlevel 1 exit /b 1

:: Start services
echo.
echo [3/3] Starting services...

echo   Starting backend ^(port %BACKEND_PORT%^)...
start "BookFlow-Backend" cmd /c "cd /d "%BACKEND_DIR%" && "%NODE%" src/index.js"

echo   Waiting for backend to be ready...
set "BACKEND_READY=0"
for /L %%i in (1,1,20) do (
    ping -n 3 127.0.0.1 >nul
    "%NODE%" "%HEALTHCHECK%" %HEALTH_URL% >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_READY=1"
        echo   Backend is ready^^!
        goto :backend_ok
    )
    echo   Still waiting... ^(%%i/20^)
)
:backend_ok
if "!BACKEND_READY!"=="0" (
    echo.
    echo   [ERROR] Backend failed to start within 60 seconds!
    echo   Check the BookFlow-Backend console window for errors.
    echo   Common issues:
    echo   - Missing npm packages ^(run: cd server ^&^& npm install^)
    echo   - Port 3001 already in use
    echo   - Node.js path incorrect: %NODE%
    echo.
    pause
    exit /b 1
)

echo   Starting frontend ^(port %FRONTEND_PORT%^)...
start "BookFlow-Frontend" cmd /c "cd /d "%FRONTEND_DIR%" && set npm_config_cache=%NPM_CACHE% && npx vite --host 0.0.0.0"

echo.
echo ========================================
echo   BookFlow Started^^!
echo   Backend  : http://localhost:%BACKEND_PORT%
echo   Frontend : http://localhost:%FRONTEND_PORT%
echo ========================================
echo.
echo   Press any key to close this window ^(services will keep running^)
pause >nul
exit /b 0

:: ==========================================
:: Subroutine: safely kill process on port
:: ==========================================
:kill_port
set "PORT=%~1"
set "SERVICE_NAME=%~2"
set "PID="

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    if "!PID!"=="" set "PID=%%a"
)

if "!PID!"=="" (
    echo   Port %PORT% is free
    goto :eof
)

set "PNAME="
for /f "tokens=1 skip=3" %%b in ('tasklist /FI "PID eq !PID!" /FO TABLE') do (
    if "!PNAME!"=="" set "PNAME=%%b"
)

echo   Port %PORT% used by !PNAME! ^(PID: !PID!^)

if /i "!PNAME!"=="node.exe" (
    echo   Killing !SERVICE_NAME!...
    taskkill /PID !PID! /F >nul 2>&1
    if errorlevel 1 (
        echo   [ERROR] Failed to kill PID !PID!
        pause
        exit /b 1
    )
    echo   Killed.
) else (
    echo   [WARN] Port used by non-node process, refusing to kill^^!
    echo   Process: !PNAME!, PID: !PID!
    echo   Please close it manually and retry.
    pause
    exit /b 1
)
goto :eof
