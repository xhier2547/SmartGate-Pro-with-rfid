@echo off
title Smart School - Cloudflare Tunnel
echo ==========================================
echo    SMART SCHOOL PERMANENT TUNNEL
echo ==========================================
echo.
echo [1/2] Checking for cloudflared...
where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] cloudflared not found. Please install it first.
    echo Download: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
    pause
    exit /b
)

echo [2/2] Starting Tunnel...
echo Path: http://localhost:3000
echo.
echo * Note: Make sure you have configured your tunnel in Cloudflare Zero Trust Dashboard.
echo * Command: cloudflared tunnel run smart-school (Assuming tunnel name is 'smart-school')
echo.
cloudflared tunnel run smart-school

if %errorlevel% neq 0 (
    echo.
    echo [!] Failed to start the named tunnel.
    echo Attempting to start a Quick Tunnel (Random URL)...
    echo.
    cloudflared tunnel --url http://localhost:3000
)

pause
