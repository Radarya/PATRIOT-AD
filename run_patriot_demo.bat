@echo off
title PATRIOT-AD - Pusat Pengawasan Siber-Fisik Gudang Amunisi TNI-AD
color 0a

echo ===============================================================================
echo   PATRIOT-AD : PLATFORM RESPON DAN ANALISIS TRAFIK OPERASIONAL
echo   Kartika Cyber Hackathon 2026 - PUSSIBERAD
echo ===============================================================================
echo.

cd /d "%~dp0"

echo [1/3] Memeriksa Layanan MQTT Broker (Mosquitto)...
sc query mosquitto >nul 2>&1
if %errorlevel% equ 0 (
    net start mosquitto >nul 2>&1
    echo       Mosquitto Broker aktif pada port 1883.
) else (
    echo       Mosquitto sudah aktif atau berjalan mandiri.
)

echo [2/3] Menjalankan Backend dan Policy Gateway (FastAPI)...
start "PATRIOT-AD Backend (FastAPI)" /min cmd /c "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn patriot.api:app --host 0.0.0.0 --port 8000"

echo [3/3] Menjalankan Web Dashboard Komando (Next.js)...
start "PATRIOT-AD Web Dashboard" /min cmd /c "cd /d "%~dp0web" && npm run dev"

echo Menunggu server siap...
ping -n 4 127.0.0.1 >nul

echo Membuka Web Dashboard di browser...
start http://localhost:3000

echo.
echo ===============================================================================
echo   SISTEM PATRIOT-AD SUDAH AKTIF!
echo   - Web Dashboard : http://localhost:3000
echo   - API Gateway   : http://localhost:8000
echo   - MQTT Broker   : port 1883
echo ===============================================================================
echo.
echo Tekan tombol apa saja untuk menutup jendela peluncur ini...
pause >nul
