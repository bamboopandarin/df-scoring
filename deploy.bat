@echo off
title DF Scoring - Full Auto Deploy (Cloudflare Pages & GitHub)
echo =====================================================================
echo        DF SCORING - DEPLOY KE CLOUDFLARE PAGES (dfscoring123)
echo =====================================================================
echo.

echo [1/3] Memastikan login ke akun Cloudflare...
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
    echo Membuka browser untuk izin akses Cloudflare (Klik Allow)...
    call npx wrangler login
)

echo.
echo [2/3] Memastikan project Cloudflare Pages 'dfscoring123' tersedia...
call npx wrangler pages project create dfscoring123 --production-branch main 2>nul

echo.
echo [3/3] Mengupload dan men-deploy DF Scoring ke https://dfscoring123.pages.dev ...
call npx wrangler pages deploy static --project-name dfscoring123 --branch main --commit-dirty=true

echo.
echo =====================================================================
echo SELESAI! Aplikasi Anda sudah aktif di: https://dfscoring123.pages.dev
echo =====================================================================
pause
