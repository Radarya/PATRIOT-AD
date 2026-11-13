# PATRIOT-AD

**Platform Analisis Trafik & Respons Infrastruktur Operasional Terpadu – Angkatan Darat**  
Kartika Cyber Hackathon 2026 (PUSSIBERAD × CODEPOLITAN) — Kategori **Penangkalan**

PATRIOT-AD adalah purwarupa pengamanan *Operational Technology* (OT) berbasis *edge* dan *offline-first* untuk memantau integritas telemetri lingkungan serta mengendalikan aktuator ventilasi/pendingin fasilitas operasional (testbed 5V DC) secara tahan sabotase.

---

## Arsitektur Pertahanan 3 Lapis

Sistem memisahkan jalur permintaan perintah (`patriot/request/cmd`) dan jalur perintah terotorisasi (`patriot/approved/cmd/<device>`), serta memvalidasi konsistensi siber-fisik melalui **Policy Gateway** sebelum aktuator dikendalikan:

1. **Lapis 1 — Komunikasi, Otentikasi & Kebijakan Perintah**
   - Broker **Eclipse Mosquitto** dengan autentikasi per klien dan pembatasan ACL (`deploy/mosquitto/patriot_acl.conf`).
   - Pemisahan token peran (`X-Patriot-Token` via `POST /api/auth/login`), deteksi *heartbeat drop*, *message burst*, dan pengamanan *Safety Gate* suhu tinggi.
2. **Lapis 2 — Perilaku Statistik Telemetri**
   - Validasi skema ketat Pydantic v2 (`extra="forbid"`, penolakan `NaN`/`Inf`), anti-replay (`boot_id` acak ESP32 + monoton `seq` + `uptime_ms`), deteksi telemetri basi (*stale*), laju perubahan suhu ($dT/dt$), dan anomali *Z-score* jendela geser.
3. **Lapis 3 — Korelasi Kontrol ↔ Respons Fisik Independen**
   - Triangulasi silang antara **perintah yang disetujui Gateway**, **status relai yang dilaporkan ESP32**, dan **bukti arus listrik aktual kipas via sensor INA226 (I2C 16-bit)** serta tren suhu **DHT22**.
   - **Edge Interlock & Fail-Safe Mandiri di ESP32 (`mbedtls` HMAC-SHA256):** Setiap perintah aktuator diverifikasi tanda tangan HMAC-SHA256 langsung di mikrokontroler; jika suhu melampaui batas kritis lokal atau sensor/MQTT putus, ESP32 mempertahankan kipas menyala secara otonom.
4. **Forensik Audit Berantai (SHA-256 Hash Chain)**
   - Rekaman insiden disimpan secara lokal di SQLite (WAL mode) dengan rantai hash SHA-256 kanonik dan *checkpoint*, serta dapat diaudit lewat endpoint `/api/forensic/verify` atau panel **Benchmark & Forensic Verifier** pada dashboard.

---

## Struktur Direktori

```text
├── backend/                     # FastAPI Policy Gateway, Mesin Deteksi 3 Lapis, SQLite Forensic DB
│   ├── patriot/                 # Paket inti backend (api.py, config.py, engine.py, mqtt_client.py, detection/)
│   ├── scripts/                 # Utilitas verifikasi MQTT & uji integrasi backend
│   ├── tests/                   # Suite pytest unit & API integration tests
│   ├── .env.example             # Template konfigurasi runtime backend (salin ke backend/.env)
│   └── pyproject.toml           # Konfigurasi dependensi Python (uv)
├── deploy/mosquitto/            # Konfigurasi Mosquitto Broker, ACL topik, & template kredensial
├── firmware/                    # Kode sumber Arduino/ESP32 DOIT DevKit V1
│   ├── patriot_esp32_production/# Firmware produksi (DHT22, INA226, Relay, Buzzer, 3 LED, HMAC)
│   ├── hardware_unit_test/      # Sketch uji komponen individual
│   ├── i2c_scanner/             # Sketch pemindai alamat I2C (INA226)
│   └── test_relay_buzzer/       # Sketch uji relai & buzzer
├── scripts/                     # Utilitas uji sistem (mqtt_bridge.py, serangan_penyusup.py, stress_test.py)
├── web/                         # Web Dashboard Komando (Next.js, React, TypeScript, Tailwind)
└── run_patriot_demo.bat         # Peluncur gabungan lokal (Mosquitto + FastAPI + Next.js)
```

---

## Pemetaan Hardware Testbed (ESP32 DOIT DevKit V1)

| Komponen | Pin / Antarmuka | Keterangan |
|---|---|---|
| Sensor Suhu & Kelembapan **DHT22** | `GPIO 4` | Pembacaan suhu & kelembapan tiap 2 detik |
| Sensor Arus **INA226 (CJMCU-226)** | `SDA=GPIO 21`, `SCL=GPIO 22` | Shunt `R100` (`0,1 Ω`), seri jalur 5V ke `COM` relai |
| **Relay 2-Channel 5V** (Ch.1 → Kipas 5010) | `GPIO 26` (`IN1`) | Logika `VCC=3V3`, koil `JD-VCC=5V`, Active-LOW |
| **LED Indikator Status** | `GPIO 27` (Hijau), `25` (Kuning), `32` (Merah) | Indikator Level 0–3 melalui resistor `220 Ω` |
| **Buzzer Aktif KY-012** | `GPIO 33` | Peringatan akustik lokal |

---

## Panduan Menjalankan Lokal (Quick Start)

### 1. Siapkan Kredensial Lokal (Wajib Sebelum Run)

File rahasia diabaikan otomatis oleh [`.gitignore`](.gitignore). Salin seluruh template sebelum menjalankan sistem:

- **Backend:** salin [`backend/.env.example`](backend/.env.example) menjadi `backend/.env` dan isi nilai password/token/HMAC secret.
- **Firmware ESP32:** salin [`firmware/patriot_esp32_production/secrets.example.h`](firmware/patriot_esp32_production/secrets.example.h) menjadi `firmware/patriot_esp32_production/secrets.h` dengan SSID Wi-Fi, IP broker laptop, password MQTT, dan HMAC secret yang **sama persis** dengan `PATRIOT_COMMAND_HMAC_SECRET` di `backend/.env`.
- **Mosquitto (opsional jika menggunakan autentikasi broker Windows):** buat `deploy/mosquitto/patriot_passwd` mengikuti instruksi di [`deploy/mosquitto/patriot_passwd.example`](deploy/mosquitto/patriot_passwd.example), lalu jalankan `deploy/mosquitto/pasang_keamanan_mosquitto.bat` sebagai Administrator.

### 2. Backend (Python 3.11+ / `uv`)

```bash
cd backend
uv sync
uv run pytest -v
uv run uvicorn patriot.api:app --host 0.0.0.0 --port 8000
```

### 3. Web Dashboard (Next.js)

```bash
cd web
npm install
npm run dev
# atau build produksi:
npm run build
```

Buka `http://localhost:3000`. Saat dijalankan di Vercel tanpa backend lokal, dashboard otomatis beroperasi pada **Mode Simulasi / Replay Interaktif**.

### 4. Peluncur Cepat Windows & Uji Keamanan

- Klik ganda `run_patriot_demo.bat` untuk menyalakan Mosquitto + FastAPI + Next.js secara bersamaan.
- Jalankan `python scripts/serangan_penyusup.py` untuk menguji penolakan perintah tanpa token, pelanggaran *Safety Gate*, maupun *message burst*.

---

## Batasan & Catatan Keamanan Purwarupa

PATRIOT-AD dibangun dan diuji pada *testbed* laboratorium bertegangan rendah (**5V DC USB**). Implementasi pada fasilitas penyimpanan strategis nyata memerlukan penempatan panel kontrol di luar zona bahaya (*safe zone*), selubung sensor/aktuator bersertifikat *Explosion-Proof* (Ex d / ATEX), rotasi rahasia kriptografi produksi, serta enkripsi transport TLS/mTLS pada broker MQTT.
