@echo off
title Padel ^& Tennis Match Master
echo =====================================================================
echo           PADEL ^& TENNIS SCORING ^& TOURNAMENT MASTER PRO
echo =====================================================================
echo.
echo [1/2] Memeriksa dependensi Python...
python -m pip install -q fastapi uvicorn pandas openpyxl pillow httpx
echo [2/2] Menjalankan server aplikasi...
echo.
echo Membuka browser: http://localhost:8000
start http://localhost:8000
echo.
echo ---------------------------------------------------------------------
echo Server sedang berjalan. Jangan tutup jendela ini selama menggunakan aplikasi.
echo Tekan CTRL+C untuk menghentikan server.
echo ---------------------------------------------------------------------
python app.py
pause
