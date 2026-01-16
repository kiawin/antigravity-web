@echo off
setlocal enabledelayedexpansion
title Antigravity Phone Connect

:: Navigate to the script's directory
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Phone Connect Launcher
echo ===================================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install it from https://nodejs.org/
    pause
    exit /b
)

:: Install deps if missing
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b
    )
)

:: Get Local IP
set "MYIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address" /c:"IP Address"') do (
    set "tmpip=%%a"
    set "tmpip=!tmpip: =!"
    if not "!tmpip!"=="" set "MYIP=!tmpip!"
)

echo [READY] Server will be available at:
echo       http://!MYIP!:3000
echo.

echo [CONTEXT MENU]
echo Do you want to add "Open with Antigravity (Debug)" to your Right-Click menu?
echo This allows you to right-click any folder and start Antigravity with the required settings.
set /p "choice=Enter 'y' to install, or any other key to skip: "
if /i "%choice%"=="y" (
    echo [INFO] Requesting Registry modification...
    powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityDebug\" /t REG_SZ /v \"\" /d \"Open with Antigravity (Debug)\" /f' -Verb RunAs"
    powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\Background\shell\AntigravityDebug\command\" /t REG_SZ /v \"\" /d \"cmd /c antigravity . --remote-debugging-port=9000\" /f' -Verb RunAs"
    powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityDebug\" /t REG_SZ /v \"\" /d \"Open with Antigravity (Debug)\" /f' -Verb RunAs"
    powershell -Command "Start-Process reg -ArgumentList 'add \"HKEY_CLASSES_ROOT\Directory\shell\AntigravityDebug\command\" /t REG_SZ /v \"\" /d \"cmd /c cd /d %%1 && antigravity . --remote-debugging-port=9000\" /f' -Verb RunAs"
    echo [SUCCESS] Context menu added!
)
echo.

echo [STARTING] Launching monitor server...
node server.js
pause
