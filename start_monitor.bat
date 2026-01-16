@echo off
setlocal
title Antigravity Mobile Monitor

:: Navigate to the script's directory
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Mobile Monitor Launcher
echo ===================================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

:: Check for node_modules, install if missing
if not exist "node_modules" (
    echo [INFO] Dependencies not found. Installing...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b
    )
    echo [SUCCESS] Dependencies installed.
)

:: Get Local IP Address for convenience
echo [INFO] Your Local IP Address(es):
ipconfig | findstr "IPv4"

echo.
echo [INSTRUCTIONS]
echo 1. Ensure Antigravity is running with: --remote-debugging-port=9000
echo 2. On your mobile device, connect to the same Wi-Fi.
echo 3. Open your mobile browser and go to your IPv4 address above, port 3000.
echo    Example: http://192.168.1.5:3000
echo.

:: Run the server
echo [INFO] Starting Server...
node server.js

pause
