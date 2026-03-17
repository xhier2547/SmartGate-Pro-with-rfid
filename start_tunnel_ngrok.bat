@echo off
title Smart School - ngrok FREE Permanent Tunnel
echo ==========================================
echo    SMART SCHOOL FREE PERMANENT TUNNEL
echo ==========================================
echo.

:: --- ส่วนที่ผู้ใช้ต้องแก้ ---
set AUTHTOKEN=3B1Uxhx4vSDdFzeVpgPjK3R3Fvb_3ybWFhR1JAx5z3eA4Lu8J
set STATIC_DOMAIN=fran-irascible-seductively.ngrok-free.dev
:: -----------------------

if "%AUTHTOKEN%"=="" (
    echo [!] กรุณาใส่ AUTHTOKEN และ STATIC_DOMAIN ในไฟล์ .bat นี้ก่อนนะครับ
    echo ไปเอาได้จากหน้าเว็บ ngrok.com ครับ
    pause
    exit /b
)

echo [1/2] Configuring Authtoken...
ngrok.exe config add-authtoken %AUTHTOKEN%

echo [2/2] Starting Tunnel...
echo Domain: https://%STATIC_DOMAIN%
echo Forwarding to: http://localhost:3000
echo.
ngrok.exe http --domain=%STATIC_DOMAIN% 3000

pause
