/**
 * PATRIOT-AD: Platform Analisis Trafik & Respons Infrastruktur Operasional Terpadu - Angkatan Darat
 * Kartika Cyber Hackathon 2026 - PUSSIBERAD
 * 
 * Production Firmware Configuration for ESP32 DOIT DevKit V1
 * Hardware: ESP32 + DHT22 + INA226 (R100) + Relay 2-Ch + Fan 5010 + Buzzer KY-012 + 3-Color LEDs
 */

#ifndef PATRIOT_CONFIG_H
#define PATRIOT_CONFIG_H

#include <Arduino.h>

// Kredensial sensitif (Wi-Fi, IP Broker, Password MQTT, HMAC Secret) dimuat dari
// "secrets.h" (lokal / gitignored) atau fallback ke template "secrets.example.h".
#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif
#else
#include "secrets.h"
#endif

// =============================================================================
// 1. PARAMETER JARINGAN (WIFI & MQTT BROKER)
// =============================================================================
// Ubah kredensial jaringan melalui file "secrets.h" (salin dari secrets.example.h).
#define WIFI_RETRY_INTERVAL_MS  5000                // Interval percobaan koneksi WiFi (non-blocking)

#define MQTT_BROKER_PORT        1883
#define MQTT_CLIENT_ID          "esp32_gudang"
#define MQTT_USERNAME           "esp32_gudang"
#define MQTT_RETRY_INTERVAL_MS  3000                // Interval reconnect MQTT

// =============================================================================
// 2. TOPIK MQTT (TERISOLASI & TEROTORISASI)
// =============================================================================
// Telemetri dipublish oleh ESP32 ke topik ini:
#define TOPIC_TELEMETRY         "patriot/telemetry/esp32_gudang"

// Perintah yang telah diverifikasi oleh Policy Gateway diterima di topik ini:
#define TOPIC_APPROVED_CMD      "patriot/approved/cmd/esp32_gudang"

// Batas gagal baca sensor DHT22 berturut-turut sebelum masuk mode Fail-Safe (kipas dipaksa ON)
#define DHT_MAX_FAIL_STREAK     3

// =============================================================================
// 3. PINOUT GPIO ESP32 (LOCKED SESUAI SPESIFIKASI MAKET & WIRING)
// =============================================================================
#define PIN_LED_BUILTIN         2    // Heartbeat LED internal ESP32
#define PIN_DHT                 4    // Data DHT22 / AM2302 (modul 3-pin dengan internal pull-up)
#define PIN_I2C_SDA             21   // I2C Data line (INA226)
#define PIN_I2C_SCL             22   // I2C Clock line (INA226)
#define PIN_RELAY_IN1           26   // Kontrol Relay Ch.1 (Active-LOW: LOW=ON, HIGH=OFF)
#define PIN_LED_HIJAU           27   // Level 0: Normal / Terlindungi (via resistor 220 Ohm)
#define PIN_LED_KUNING          25   // Level 1: Peringatan Anomali Sensor (via resistor 220 Ohm)
#define PIN_LED_MERAH           32   // Level 2 & 3: Safety Gate Interlock & Karantina
#define PIN_BUZZER              33   // Buzzer Aktif KY-012

// =============================================================================
// 4. SPESIFIKASI SENSOR & KALIBRASI FISIK
// =============================================================================
#define DHT_TYPE                DHT22
#define TEMP_CALIBRATION_OFFSET_C -2.3 // Kompensasi self-heating boks maket tertutup & ambien tropis (C)
#define INA226_I2C_ADDR_DEFAULT 0x44 // Alamat CJMCU-226 (bisa 0x44 atau 0x40)
#define SHUNT_RESISTOR_OHM      0.10 // Resistor R100 pada modul CJMCU-226 = 0.1 Ohm
#define MAX_EXPECTED_CURRENT_A  0.80 // Rentang ukur maks 0.8A (Kipas 5010 ~60-110 mA)

// Batas arus listrik untuk konfirmasi fisik perputaran motor Kipas 5010 (Lapis 3)
#define CURRENT_FAN_ACTIVE_MIN_MA 40.0 // Arus > 40 mA menandakan kipas berputar aktif

// =============================================================================
// 5. AUTONOMOUS SAFETY GATE & FAIL-SAFE EDGE THRESHOLDS
// =============================================================================
// Lingkar Keselamatan Mandiri (Edge Defense-in-Depth):
// Jika suhu ruangan >= 32.0 C, firmware ESP32 SECARA FISIK MENOLAK perintah matikan kipas!
// Kipas dipaksa berputar (Relay ON) untuk melindungi amunisi tanpa bergantung penuh pada server.
#define LOCAL_INTERLOCK_TEMP_C      32.0 // Ambang Interlock Fisik Lokal Mandiri (C)
#define LOCAL_CRITICAL_TEMP_C       34.0 // Ambang Bahaya Kritis Lokal (C)

// Jika komunikasi MQTT ke laptop putus > 5 detik, ESP32 masuk mode fail-safe lokal
#define FAILSAFE_HEARTBEAT_TIMEOUT_MS 5000 

// Periode sampling & publish telemetri (DHT22 membutuhkan minimal 2 detik untuk akurasi optimal)
#define TELEMETRY_INTERVAL_MS       2000

// Serial baud rate untuk monitor diagnostik
#define SERIAL_BAUD_RATE            115200

#endif // PATRIOT_CONFIG_H
