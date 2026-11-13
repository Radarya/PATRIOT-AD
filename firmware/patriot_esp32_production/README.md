# Panduan Flash & Uji Firmware ESP32 Produksi Final (PATRIOT-AD)

Firmware ini dirancang untuk simpul maket testbed siber-fisik **PATRIOT-AD** (`esp32_gudang`) pada **Kartika Cyber Hackathon 2026**.

---

## 1. Daftar Komponen & Pinout GPIO Terkunci

| Komponen | Pin Modul | Terhubung ke ESP32 / Rel Daya | Catatan Teknis |
|---|---|---|---|
| **DHT22 (AM2302)** | `VCC` (`+`) | Rel `3V3` | Logika 3.3V |
| | `DATA` (`OUT`) | **`GPIO 4`** | Sudah ada internal pull-up di modul |
| | `GND` (`-`) | Rel `GND` | Ground bersama |
| **INA226 (CJMCU-226)** | `VCC` (`V+`) | Rel `3V3` | Logika I2C 3.3V |
| | `GND` | Rel `GND` | Ground bersama |
| | `SDA` | **`GPIO 21`** | Jalur data I2C (Alamat `0x44` atau `0x40`) |
| | `SCL` | **`GPIO 22`** | Jalur clock I2C |
| | `IN+` (`VIN+`) | Rel `5V (VIN)` USB | Dari input 5V USB |
| | `IN-` (`VIN-`) | Terminal `COM` Relay Ch.1 | Seri ke saklar relay kipas |
| **Relay 2-Channel 5V** | `VCC` | Rel `3V3` | Lepas jumper `JD-VCC` jika ada |
| | `JD-VCC` | Rel `5V (VIN)` USB | Daya koil relay dari USB |
| | `IN1` | **`GPIO 26`** | Sinyal Aktif-LOW (`LOW` = ON, `HIGH` = OFF) |
| | `GND` | Rel `GND` | Ground bersama |
| | Terminal `NO` | Kabel Merah (`+`) Kipas 5010 | Hubung saat relay ON |
| **Kipas DC 5010 5V** | Kabel Merah (`+`) | Terminal `NO` Relay Ch.1 | Menerima daya 5V terukur |
| | Kabel Hitam (`-`) | Rel `GND` | Ground bersama |
| **LED Hijau (Level 0)** | Anoda (`+`) | **`GPIO 27`** $\rightarrow$ Resistor `220 Ω` | Indikator Normal |
| **LED Kuning (Level 1)** | Anoda (`+`) | **`GPIO 25`** $\rightarrow$ Resistor `220 Ω` | Indikator Peringatan Anomali |
| **LED Merah (Level 2/3)** | Anoda (`+`) | **`GPIO 32`** $\rightarrow$ Resistor `220 Ω` | Indikator Interlock / Karantina |
| **Buzzer KY-012** | Pin `S` (Signal) | **`GPIO 33`** | Alarm aktif (osilator internal) |
| | Pin `-` (`GND`) | Rel `GND` | Ground bersama |

---

## 2. Library yang Diperlukan di Arduino IDE

Buka **Arduino IDE** $\rightarrow$ **Tools** $\rightarrow$ **Manage Libraries...** (`Ctrl + Shift + I`), lalu cari dan instal:
1. **`PubSubClient`** by Nick O'Leary (v2.8+)
2. **`DHT sensor library`** by Adafruit (v1.4+)
3. **`Adafruit Unified Sensor`** by Adafruit (dependensi DHT)
4. **`INA226_WE`** by Wolfgang Ewald (v1.2+)

---

## 3. Langkah Pengaturan Hotspot & IP Laptop (Untuk Demo di Cafe / Tempat Luar)

Saat berkumpul bersama tim di cafe/tempat umum:
1. Nyalakan **Hotspot Pribadi (Tethering)** di Smartphone (misal SSID: `PATRIOT_DEMO`, Sandi: `tniad2026`).
2. Sambungkan **Laptop** ke hotspot tersebut.
3. Buka PowerShell / Terminal di laptop, ketik:
   ```powershell
   ipconfig
   ```
   Catat **IPv4 Address** (misalnya `192.168.43.120`).
4. Salin file `secrets.example.h` menjadi `secrets.h` di folder `firmware/patriot_esp32_production/`, lalu sesuaikan isinya:
   ```cpp
   #define WIFI_SSID           "PATRIOT_DEMO"
   #define WIFI_PASSWORD       "YOUR_WIFI_PASSWORD"
   #define MQTT_BROKER_IP      "192.168.43.120" // Ganti dengan IP laptop hasil ipconfig
   #define MQTT_PASSWORD       "YOUR_ESP32_MQTT_PASSWORD"
   #define COMMAND_HMAC_SECRET "YOUR_SHARED_HMAC_SECRET" // Harus sama dengan PATRIOT_COMMAND_HMAC_SECRET di backend/.env
   ```
5. Simpan (`Ctrl + S`). (Catatan: `secrets.h` otomatis diabaikan oleh `.gitignore`).

---

## 4. Cara Flash Firmware ke ESP32

1. Colokkan kabel Micro-USB dari ESP32 ke laptop (terdeteksi di Port `COM7`).
2. Di Arduino IDE:
   - Pilih Board: **`DOIT ESP32 DEVKIT V1`** (atau `ESP32 Dev Module`).
   - Pilih Port: **`COM7`**.
   - Upload Speed: **`921600`** (atau `115200`).
3. Klik tombol **Upload** (`Ctrl + U`).
4. Buka **Serial Monitor** pada kecepatan **`115200 baud`**.

---

## 5. Fitur Pengujian Meja Mandiri (Serial CLI)

Sebelum membawa maket ke lokasi temu tim, uji fungsionalitas seluruh hardware langsung dari Serial Monitor:
- Ketik **`1`** $\rightarrow$ Relay ON (Kipas berputar, amati LED relay menyala).
- Ketik **`0`** $\rightarrow$ Relay OFF (Kipas berhenti).
- Ketik **`s`** $\rightarrow$ Cetak snapshot diagnostik lengkap:
  - Suhu & kelembapan DHT22.
  - Arus beban INA226 (saat kipas ON terukur ~60–110 mA; saat OFF ~0 mA).
  - Status koneksi MQTT broker.
- Ketik **`l`** $\rightarrow$ Siklus tes lampu indikator (Level 0 Hijau $\rightarrow$ Level 1 Kuning $\rightarrow$ Level 2 Merah $\rightarrow$ Level 3 Merah).
- Ketik **`b`** $\rightarrow$ Tes bunyi buzzer aktif KY-012 selama 500 ms.
- Dekatkan **uap minuman panas** ke sensor DHT22 hingga suhu $> 32.0\text{ }^\circ\text{C}$, lalu ketik **`0`** $\rightarrow$ Amati bahwa firmware **menolak** perintah mematikan kipas dan mempertahankan pendinginan aktif!
