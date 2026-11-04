@echo off
cd /d "%~dp0"
title DF Scoring - Cloudflare Pages
findstr /R /C:"^\[\[d1_databases\]\]" wrangler.toml >nul
if errorlevel 1 (
  echo Isi binding D1 DF_SCORING_DB di wrangler.toml dan ikuti konfigurasi di README.md.
  exit /b 1
)
call npx wrangler pages deploy static --project-name dfscoring123 --branch main --commit-dirty=true
if errorlevel 1 exit /b 1
echo Deploy selesai. Buka https://dfscoring123.pages.dev
