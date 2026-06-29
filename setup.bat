@echo off
echo ============================================
echo  GymTracker Setup
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found.
    echo     Download from: https://nodejs.org  (LTS version)
    echo     After installing, re-run this script.
    pause
    exit /b 1
)

echo [OK] Node.js found:
node --version
echo.

echo [..] Installing dependencies...
npm install

echo.
echo [OK] Done! Starting GymTracker...
echo      Open: http://localhost:3000
echo.
node server.js
