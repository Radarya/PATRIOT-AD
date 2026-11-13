@echo off
title Pasang Pengaman Akun & ACL Mosquitto PATRIOT-AD
color 0b

echo ===============================================================================
echo   PEMASANGAN PENGAMAN BROKER MQTT (PASSWORD & ACL) PATRIOT-AD
echo   Kartika Cyber Hackathon 2026 - PUSSIBERAD
echo ===============================================================================
echo.
echo Pastikan Anda menjalankan file ini dengan klik kanan -> "Run as administrator".
echo.

set "MOSQUITTO_DIR=C:\Program Files\mosquitto"
if not exist "%MOSQUITTO_DIR%" (
    echo [ERROR] Direktori Mosquitto tidak ditemukan di %MOSQUITTO_DIR%.
    pause
    exit /b 1
)

if not exist "%~dp0patriot_passwd" (
    echo [ERROR] File %~dp0patriot_passwd belum dibuat!
    echo Silakan lihat deploy\mosquitto\patriot_passwd.example untuk membuat akun via mosquitto_passwd.exe.
    pause
    exit /b 1
)

echo [1/4] Menghentikan sementara layanan Mosquitto...
net stop mosquitto >nul 2>&1

echo [2/4] Menyalin file konfigurasi, password, dan ACL ke %MOSQUITTO_DIR%...
copy /Y "%~dp0patriot_passwd" "%MOSQUITTO_DIR%\patriot_passwd" >nul
copy /Y "%~dp0patriot_acl.conf" "%MOSQUITTO_DIR%\patriot_acl.conf" >nul
copy /Y "%~dp0mosquitto.conf" "%MOSQUITTO_DIR%\mosquitto.conf" >nul

echo [3/4] Menjalankan kembali layanan Mosquitto dengan autentikasi aktif...
net start mosquitto

echo [4/4] Pengamanan Broker MQTT Selesai!
echo       - Akun Gateway  : patriot_gateway
echo       - Akun ESP32    : esp32_gudang
echo       - Anonim        : DITOLAK (allow_anonymous false)
echo       - Pembatasan    : Topik approved/cmd hanya dapat ditulis oleh gateway.
echo.
echo Tekan tombol apa saja untuk menutup...
pause >nul
