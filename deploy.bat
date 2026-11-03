@echo off
title DF Scoring - Full Auto Deploy (Cloudflare Pages & GitHub)
echo =====================================================================
echo        DF SCORING - DEPLOY KE CLOUDFLARE PAGES (dfscoring123)
echo =====================================================================
echo.
set "NODE_DIR=C:\Users\DELL\.gemini\antigravity\brain\1a168423-9965-42a3-8ecb-2eb30a29019d\scratch\tools\node-v20.18.0-win-x64"
if exist "%NODE_DIR%\node.exe" (
    set "PATH=%NODE_DIR%;%PATH%"
)

echo [1/3] Memastikan login ke akun Cloudflare...
call "%NODE_DIR%\wrangler.cmd" whoami >nul 2>&1
if errorlevel 1 (
    echo Membuka browser Chrome untuk izin akses Cloudflare (Klik Allow)...
    call "%NODE_DIR%\wrangler.cmd" login
)

echo.
echo [2/3] Membuat project Cloudflare Pages 'dfscoring123' (jika belum ada)...
call "%NODE_DIR%\wrangler.cmd" pages project create dfscoring123 --production-branch main 2>nul

echo.
echo [3/3] Mengupload dan men-deploy DF Scoring ke https://dfscoring123.pages.dev ...
call "%NODE_DIR%\wrangler.cmd" pages deploy static --project-name dfscoring123 --branch main --commit-dirty=true

echo.
echo =====================================================================
echo SELESAI! Aplikasi Anda sudah aktif di: https://dfscoring123.pages.dev
echo =====================================================================
pause
