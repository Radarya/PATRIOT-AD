@echo off
title PATRIOT-AD - Pusat Pengawasan Siber-Fisik Gudang Amunisi TNI-AD
color 0a

echo ===============================================================================
echo   PATRIOT-AD : PLATFORM RESPON DAN ANALISIS TRAFIK OPERASIONAL
echo   Kartika Cyber Hackathon 2026 - PUSSIBERAD
echo ===============================================================================
echo.

cd /d "%~dp0"

echo [1/3] Memeriksa Layanan MQTT Broker (Mosquitto - Opsional)...
sc query mosquitto >nul 2>&1
if %errorlevel% equ 0 (
    net start mosquitto >nul 2>&1
    echo       Mosquitto Broker aktif pada port 1883.
) else (
    echo       Mosquitto service tidak terdeteksi ^(Mode Simulasi tanpa ESP32 tetap berjalan normal^).
)

echo [2/3] Memeriksa & Menjalankan Backend Policy Gateway (FastAPI)...
if not exist "%~dp0backend\.venv\Scripts\python.exe" (
    where uv >nul 2>&1
    if %errorlevel% equ 0 (
        echo       Environment backend belum ada, menjalankan "uv sync"...
        pushd "%~dp0backend"
        call uv sync
        popd
    )
)
if exist "%~dp0backend\.venv\Scripts\python.exe" (
    start "PATRIOT-AD Backend (FastAPI)" /min cmd /c "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn patriot.api:app --host 0.0.0.0 --port 8000 || pause"
) else (
    where uv >nul 2>&1
    if %errorlevel% equ 0 (
        start "PATRIOT-AD Backend (FastAPI)" /min cmd /c "cd /d "%~dp0backend" && uv run uvicorn patriot.api:app --host 0.0.0.0 --port 8000 || pause"
    ) else (
        echo [GAGAL] Folder backend\.venv tidak ditemukan dan 'uv' tidak terpasang.
        echo         Pasang uv lalu jalankan "cd backend && uv sync".
        pause
        exit /b 1
    )
)

echo [3/3] Memeriksa & Menjalankan Web Dashboard Komando (Next.js)...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [GAGAL] Node.js / npm tidak ditemukan di PATH.
    pause
    exit /b 1
)
if not exist "%~dp0web\node_modules" (
    echo       Dependensi web belum terpasang, menjalankan "npm install"...
    pushd "%~dp0web"
    call npm install
    popd
)
start "PATRIOT-AD Web Dashboard" /min cmd /c "cd /d "%~dp0web" && npm run dev || pause"

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
