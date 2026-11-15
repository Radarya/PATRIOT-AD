# PATRIOT-AD

## 🔗 Akses Cepat Penjurian
- 🌐 **Live Web Dashboard (Mode Simulasi Interaktif Vercel):** https://patriotad.vercel.app/
- 🎥 **Video Demonstrasi (YouTube):** https://youtu.be/uY3mOeJCwWY
- 📊 **Slide Presentasi (Canva):** https://canva.link/uvnc1r4apmkoexh

> **🔑 Panduan Akses Cepat Dewan Juri (Layar Otentikasi Pos Jaga):**  
> Saat membuka Web Dashboard, Dewan Juri dapat langsung menekan tombol **Akses Cepat Demo** pada layar login untuk langsung menguji fitur tanpa mengetik kredensial manual.


**Platform Analisis Trafik & Respons Infrastruktur Operasional Terpadu – Angkatan Darat**  
Kartika Cyber Hackathon 2026 (PUSSIBERAD × CODEPOLITAN) — Kategori **Penangkalan**

PATRIOT-AD adalah purwarupa pengamanan *Operational Technology* (OT) berbasis *edge* dan *offline-first* untuk memantau integritas telemetri lingkungan gudang serta mengendalikan aktuator ventilasi/pendingin (testbed laboratorium **5V DC**) secara tahan sabotase, anti-spoofing, dan dapat diaudit secara kriptografis.

---

## Pilih Jalur Uji (Panduan Cepat Dewan Juri)

Repo ini dirancang agar langsung dapat diuji dalam **3 skenario** sesuai ketersediaan perangkat saat penjurian:

| Jalur Uji | Kebutuhan | Cocok Untuk |
|---|---|---|
| **1. Web Simulasi Mandiri** | Hanya **Node.js 20+** (tanpa backend/hardware) | Evaluasi UI, 5 skenario uji, simulasi tamper SHA-256 langsung di browser (`http://localhost:3000`) |
| **2. Sistem Lokal Penuh** *(Disarankan)* | **Python (`uv`) + Node.js 20+** (tanpa ESP32/Mosquitto) | Uji penuh **FastAPI Policy Gateway + SQLite Forensic DB + WebSocket + Terminal Red Team + Stress Test** |
| **3. Testbed Hardware Riil** | Jalur 2 + **ESP32 DOIT DevKit V1** + **Mosquitto** | Uji telemetri fisik nyata **DHT22 + INA226**, kontrol **Relay/Kipas**, LED, Buzzer, & HMAC-SHA256 |

> **Catatan Penting (`backend/.env` Opsional untuk Demo Lokal):**  
> Saat menjalankan **Jalur 2** dari hasil `git clone`, Anda **tidak wajib** membuat `backend/.env` maupun memasang Mosquitto terlebih dahulu. Jika `backend/.env` tidak ada, [`backend/patriot/config.py`](backend/patriot/config.py) otomatis menghasilkan token sesi & kunci HMAC *ephemeral* per proses, dan [`backend/patriot/mqtt_client.py`](backend/patriot/mqtt_client.py) tetap berjalan *offline-first*. File `.env` baru **wajib** dibuat pada **Jalur 3** agar kunci `PATRIOT_COMMAND_HMAC_SECRET` dan kredensial MQTT sinkron dengan ESP32.

---

## Arsitektur Pertahanan 3 Lapis

Sistem memisahkan jalur permintaan perintah (`patriot/request/cmd`) dan jalur perintah terotorisasi (`patriot/approved/cmd/<device>`), serta memvalidasi konsistensi siber-fisik melalui **Policy Gateway** sebelum aktuator dikendalikan:

1. **Lapis 1 — Komunikasi, Otentikasi & Kebijakan Perintah (`layer1_comm.py`)**
   - Broker **Eclipse Mosquitto** dengan autentikasi per klien dan pembatasan ACL topik ([`deploy/mosquitto/patriot_acl.conf`](deploy/mosquitto/patriot_acl.conf)).
   - Otentikasi token peran (`X-Patriot-Token` melalui `POST /api/auth/login`), penolakan *identity spoofing* saat body JSON mengaku `operator` tanpa token sah, deteksi *heartbeat drop*, *message burst* + karantina otomatis, serta pengamanan *Safety Gate* suhu tinggi (`>= 32.0 °C` menahan `FAN_OFF`).
2. **Lapis 2 — Perilaku Statistik Telemetri (`layer2_behavior.py`)**
   - Validasi skema ketat Pydantic v2 (`extra="forbid"`, penolakan `NaN`/`Inf`), anti-replay (`boot_id` ESP32 + monoton `seq` + `uptime_ms`), deteksi data beku/basi (*stale*), laju kenaikan suhu tidak wajar ($dT/dt$), dan anomali *Z-score* jendela geser.
3. **Lapis 3 — Korelasi Kontrol ↔ Respons Fisik Independen (`layer3_physical.py`)**
   - Triangulasi silang antara **perintah yang disetujui Gateway**, **status relai yang dilaporkan ESP32**, dan **bukti arus listrik aktual kipas via sensor INA226** serta tren suhu **DHT22**.
   - **Edge Interlock & Fail-Safe Mandiri di ESP32 (`mbedtls` HMAC-SHA256):** Setiap perintah ke ESP32 diverifikasi tanda tangan HMAC-SHA256 langsung di mikrokontroler; bila suhu mencapai ambang lokal `>= 32.0 °C` atau sensor DHT22/koneksi MQTT putus, ESP32 mempertahankan kipas menyala secara otonom.
4. **Forensik Audit Berantai (`forensic_db.py`)**
   - Seluruh kejadian dicatat ke SQLite (WAL mode) dengan rantai hash **SHA-256** kanonik dan *checkpoint*, dapat diverifikasi integritasnya kapan saja via `GET /api/forensic/verify` atau tab **Audit Forensik** pada dashboard.

---

## Prasyarat Sistem

- **Git**
- **Node.js 20+** & **npm** (untuk Web Dashboard `web/`)
- **[uv](https://docs.astral.sh/uv/)** *(sangat disarankan)* — [`backend/pyproject.toml`](backend/pyproject.toml) mensyaratkan Python **`>=3.11,<3.13`**. Menjalankan `uv sync` otomatis mengelola runtime Python 3.12 terisolasi di `backend/.venv` meskipun Python global OS Anda versi lebih baru (misalnya 3.13–3.15).
- *(Opsional — Jalur 3)* **Eclipse Mosquitto** & **Arduino IDE** dengan pustaka ESP32.

---

## Panduan Menjalankan Proyek dari GitHub (Clean Setup)

### 1. Clone Repositori

```bash
git clone https://github.com/Radarya/PATRIOT-AD.git
cd PATRIOT-AD
```

### 2. Jalankan Mode Lokal Penuh (Jalur 2 — Tanpa Hardware)

#### Opsi A — Peluncur Otomatis Windows

```bat
run_patriot_demo.bat
```

Skrip [`run_patriot_demo.bat`](run_patriot_demo.bat) otomatis mengecek layanan Mosquitto (opsional), menjalankan `uv sync` bila `backend\.venv` belum tersedia, menjalankan `npm install` bila `web\node_modules` belum tersedia, menyalakan Backend FastAPI (`port 8000`) & Frontend Next.js (`port 3000`), lalu membuka `http://localhost:3000`.

#### Opsi B — Manual Lintas Platform (Windows / Linux / macOS)

Buka **2 terminal** dari folder root repositori:

**Terminal 1 — Backend Policy Gateway (`http://localhost:8000`)**

```bash
cd backend
uv sync
uv run uvicorn patriot.api:app --host 0.0.0.0 --port 8000
```

> Verifikasi cepat: buka `http://localhost:8000/api/health` (harus merespons `"status": "HEALTHY"`) atau dokumentasi interaktif Swagger di `http://localhost:8000/docs`.

**Terminal 2 — Web Dashboard Komando (`http://localhost:3000`)**

```bash
cd web
npm install
npm run dev
```

Buka **`http://localhost:3000`** pada peramban. Frontend otomatis terhubung ke Backend FastAPI lokal melalui HTTP (`:8000`) dan WebSocket (`ws://<host>:8000/ws`).

> **Catatan Jalur 1 (Tanpa Backend):** Jika Anda hanya menyalakan Terminal 2 (`web/`), dashboard tetap dapat diakses sepenuhnya di `http://localhost:3000` dengan mesin simulasi bawaan browser.

---

## Panduan Uji Penjurian (*Judging Walkthrough*)

### A. Verifikasi Tes Otomatis, Kualitas Kode & Build

Jalankan perintah berikut untuk memastikan seluruh test backend, linter, tipe TypeScript, dan build produksi berjalan tanpa galat:

```bash
# 1. Uji unit & integrasi Policy Gateway (15 kasus uji)
cd backend
uv run pytest -v

# 2. Audit lint, tipe TypeScript, dan build produksi Web Dashboard
cd ../web
npm run lint
npx tsc --noEmit
npm run build
```

### B. Alur Demo Interaktif di Web Dashboard (`http://localhost:3000`)

1. **Layar Kunci Taktis (`TacticalLockScreen`):**
   - Pilih **`Perwira Pengawas`** (`admin`) atau **`Operator Piket`** (`operator`) untuk memperoleh sesi resmi dari `POST /api/auth/login` (dengan header `X-Patriot-Token`).
   - Tersedia juga simulasi profil **`Penyusup Siber`** (`unauthorized`) untuk mendemonstrasikan bagaimana akses tanpa token ditahan di Policy Gateway.
2. **Konsol Utama & Kontrol Aktuator:**
   - Amati kartu sensor real-time (Suhu DHT22, Kelembapan, Arus INA226 dalam mA) dan grafik telemetri.
   - Uji kirim perintah **`FAN_ON`** / **`FAN_OFF`** melalui Konsol Perintah.
3. **Evaluasi 5 Skenario Uji (`SCN-01` s.d. `SCN-05`):**
   - **`SCN-01` (Normal):** Kondisi operasional aman, suhu terkendali, kipas aktif (~88,5 mA simulasi), Level 0.
   - **`SCN-02` (Sensor Fault / Lonjakan $dT/dt$):** Deteksi anomali perubahan suhu ekstrem pada Lapis 2 (Level 1 — Peringatan).
   - **`SCN-03` (Sabotase *Safety Gate*):** Percobaan mematikan kipas (`FAN_OFF`) saat suhu panas (`>= 32.0 °C`) ditolak paksa (*BLOCK* / Level 2) dan mempertahankan `KEEP_SAFE (FAN_ON)`.
   - **`SCN-04` (Replay / Telemetri Beku):** Data sensor identik berulang kali terdeteksi sebagai data basi/bukan aliran riil (Level 1).
   - **`SCN-05` (Banjir DoS / *Message Burst*):** Banjir perintah beruntun memicu pemblokiran dan karantina pengirim (Level 3 — *Quarantine*).
4. **Tab Audit Forensik (`ForensicAuditViewer`):**
   - Verifikasi keutuhan seluruh rantai hash SHA-256 langsung ke `GET /api/forensic/verify`.
   - Coba tombol simulasi *Tamper* untuk membuktikan sistem mendeteksi perubahan 1 karakter sekalipun pada log, serta unduh/cetak laporan forensik (`GET /api/forensic/export`).

### C. Simulasi Serangan Red Team (`scripts/serangan_penyusup.py`)

Saat Backend FastAPI menyala pada port `8000`, buka **Terminal 3** di root repo (cukup memakai Python 3 standar OS tanpa perlu `uv`/library eksternal):

```bash
# Mode menu interaktif
python scripts/serangan_penyusup.py 127.0.0.1
```

Atau jalankan skenario satu per satu via CLI:

```bash
python scripts/serangan_penyusup.py 127.0.0.1 --aksi 1   # Perintah palsu pihak tanpa izin ('unauthorized')
python scripts/serangan_penyusup.py 127.0.0.1 --aksi 2   # Sabotase FAN_OFF saat suhu gudang >= 32,0°C (SCN-03)
python scripts/serangan_penyusup.py 127.0.0.1 --aksi 3   # Injeksi 15 paket telemetri statis/replay (Lapis 2)
python scripts/serangan_penyusup.py 127.0.0.1 --aksi 4   # Banjir 15 perintah cepat berturut-turut (Karantina Lapis 1)
python scripts/serangan_penyusup.py 127.0.0.1 --aksi 5   # Penyamaran 'requester: operator' tanpa X-Patriot-Token
python scripts/serangan_penyusup.py 127.0.0.1 --aksi 0   # Bebaskan karantina & pulihkan ke kondisi normal (SCN-01)
```

> Untuk demo jarak jauh dari laptop kedua pada Wi-Fi/hotspot yang sama, ganti `127.0.0.1` dengan alamat IP laptop Pos Jaga. Tersedia pula flag `--solo` dan `--delay <detik>`.

### D. Uji Beban & Audit Kriptografi (`scripts/stress_test.py`)

Menguji 500 request konkuren ke `/api/status`, 200 perintah konkuren ke `/api/command` (serta pemulihan otomatis status karantina `operator` pasca-uji), dan kecepatan verifikasi rantai SHA-256 `/api/forensic/verify`:

```bash
uv run --project backend python scripts/stress_test.py
```

---

## Ringkasan API & WebSocket Gateway

| Endpoint | Metode | Keterangan |
|---|---|---|
| `/ws` | `WebSocket` | Stream telemetri real-time, status hardware, dan keputusan Policy Engine |
| `/api/health` | `GET` | Pemeriksaan kesehatan gateway, DB SQLite, koneksi MQTT, dan status ESP32 |
| `/api/status` | `GET` | Snapshot telemetri terbaru, keputusan aktif, level siaga, dan daftar karantina |
| `/api/auth/login` | `POST` | Autentikasi peran (`admin`, `operator`, `dashboard`, `unauthorized`) → token sesi |
| `/api/command` | `POST` | Kirim perintah aktuator (`FAN_ON`/`FAN_OFF`); wajib `X-Patriot-Token` untuk peran sah |
| `/api/telemetry` | `GET`/`POST` | Baca riwayat telemetri atau injeksi paket telemetri ke Lapis 2 |
| `/api/benchmark/{scenario_id}` | `POST` | Eksekusi skenario uji `SCN-01` s.d. `SCN-05` memakai detektor riil *(butuh token)* |
| `/api/incidents` | `GET` | Daftar catatan insiden terbaru dari SQLite Forensic DB |
| `/api/forensic/verify` | `GET` | Verifikasi penuh rantai hash SHA-256 & checkpoint |
| `/api/forensic/export` | `GET` | Ekspor riwayat log audit forensik |
| `/api/quarantine/{identity}/release` | `POST` | Lepaskan identitas dari daftar karantina *(butuh token)* |
| `/api/config` | `GET` | Konfigurasi ambang kalibrasi aktif (nilai rahasia disensor/redacted) |
| `/api/hardware/test-leds`, `test-buzzer`, `toggle-relay` | `POST` | Perintah uji langsung ke ESP32 melalui jalur USB Serial cadangan |
| `/docs` | `GET` | Dokumentasi interaktif Swagger UI FastAPI |

---

## Setup Hardware Testbed & Broker Mosquitto (Jalur 3)

### 1. Pemetaan Pinout GPIO ESP32 DOIT DevKit V1

Mengacu pada [`firmware/patriot_esp32_production/config.h`](firmware/patriot_esp32_production/config.h):

| Komponen | Pin ESP32 / Antarmuka | Keterangan Teknis |
|---|---|---|
| **DHT22 (AM2302)** | `GPIO 4` (`DATA`) | Suhu & kelembapan (interval pembacaan 2 detik) |
| **INA226 (CJMCU-226)** | `GPIO 21` (`SDA`), `GPIO 22` (`SCL`) | Alamat I2C `0x44`/`0x40`, shunt `R100` (`0,1 Ω`), seri jalur 5V ke `COM` relai |
| **Relay 2-Channel 5V** | `GPIO 26` (`IN1`) | Active-LOW (`LOW` = ON, `HIGH` = OFF), logika `3V3`, koil `JD-VCC` `5V` |
| **LED Status (Level 0–3)** | `GPIO 27` (Hijau), `GPIO 25` (Kuning), `GPIO 32` (Merah) | Melalui resistor pembatas `220 Ω` |
| **Buzzer Aktif KY-012** | `GPIO 33` | Peringatan akustik lokal |
| **Heartbeat LED Board** | `GPIO 2` | Indikator internal ESP32 |

### 2. Konfigurasi Kredensial `.env`, `secrets.h`, dan Mosquitto ACL

1. **Backend (`.env`):** Salin [`backend/.env.example`](backend/.env.example) menjadi `backend/.env` dan isi nilai password MQTT, token API/peran, serta `PATRIOT_COMMAND_HMAC_SECRET`.
2. **Firmware (`secrets.h`):** Salin [`firmware/patriot_esp32_production/secrets.example.h`](firmware/patriot_esp32_production/secrets.example.h) menjadi `firmware/patriot_esp32_production/secrets.h`, lalu isi `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_BROKER_IP` (IPv4 laptop), `MQTT_PASSWORD`, dan `COMMAND_HMAC_SECRET` yang **sama persis** dengan `PATRIOT_COMMAND_HMAC_SECRET` pada `backend/.env`.
3. **Broker Mosquitto (Windows — opsional bila memakai autentikasi & ACL):**
   - Buat `deploy/mosquitto/patriot_passwd` sesuai petunjuk [`deploy/mosquitto/patriot_passwd.example`](deploy/mosquitto/patriot_passwd.example) (`patriot_gateway` dan `esp32_gudang`).
   - Klik kanan [`deploy/mosquitto/pasang_keamanan_mosquitto.bat`](deploy/mosquitto/pasang_keamanan_mosquitto.bat) → **Run as administrator**. *(Catatan: [`deploy/mosquitto/mosquitto.conf`](deploy/mosquitto/mosquitto.conf) memakai path Windows `C:/Program Files/mosquitto/...`; untuk Linux/macOS sesuaikan path `password_file` dan `acl_file` ke direktori `/etc/mosquitto/`).*
4. **Flash Firmware & Verifikasi Live:**
   - Panduan lengkap instalasi pustaka Arduino (`PubSubClient`, `DHT sensor library`, `Adafruit Unified Sensor`, `INA226_WE`), cara upload sketch [`patriot_esp32_production.ino`](firmware/patriot_esp32_production/patriot_esp32_production.ino), serta perintah **Serial CLI (`115200 baud`: `1`, `0`, `s`, `l`, `b`)** tersedia di [`firmware/patriot_esp32_production/README.md`](firmware/patriot_esp32_production/README.md).
   - Verifikasi koneksi Mosquitto & alur end-to-end backend-broker:
     ```bash
     uv run --project backend python backend/scripts/verify_live_mqtt.py
     uv run --project backend python backend/scripts/test_live_system.py
     ```
     *(Jika Mosquitto memakai `allow_anonymous false` dengan [`patriot_acl.conf`](deploy/mosquitto/patriot_acl.conf), set juga env `PATRIOT_ESP32_MQTT_PASSWORD` sebelum menjalankan `test_live_system.py`.)*
   - Utilitas tambahan [`scripts/mqtt_bridge.py`](scripts/mqtt_bridge.py) tersedia jika perlu meneruskan koneksi TCP `0.0.0.0:1883` ke `127.0.0.1:1883` secara mandiri saat gateway tidak mengikat port `1883` (secara default FastAPI Gateway sudah membuka jembatan TCP `0.0.0.0:1883`).

---

## Struktur Direktori

```text
├── backend/                          # FastAPI Policy Gateway, Mesin Deteksi 3 Lapis, SQLite Forensic DB
│   ├── patriot/                      # Paket inti backend (api.py, config.py, engine.py, mqtt_client.py, detection/)
│   ├── scripts/                      # verify_live_mqtt.py & test_live_system.py
│   ├── tests/                        # Suite pytest (test_policy_engine.py)
│   ├── .env.example                  # Template konfigurasi runtime backend
│   ├── pyproject.toml                # Konfigurasi dependensi Python (>=3.11,<3.13, uv)
│   └── uv.lock                       # Lockfile dependensi backend
├── deploy/mosquitto/                 # Konfigurasi Mosquitto Broker, ACL topik, & installer Windows
├── firmware/                         # Kode sumber Arduino/ESP32 DOIT DevKit V1
│   ├── patriot_esp32_production/     # Firmware produksi + panduan flash (README.md)
│   ├── hardware_unit_test/           # Sketch uji komponen individual
│   ├── i2c_scanner/                  # Sketch pemindai alamat I2C INA226
│   └── test_relay_buzzer/            # Sketch uji relai & buzzer
├── scripts/                          # Utilitas uji (serangan_penyusup.py, stress_test.py, mqtt_bridge.py)
├── web/                              # Web Dashboard Komando (Next.js 16, React 19, TypeScript, Tailwind CSS 4)
└── run_patriot_demo.bat              # Peluncur gabungan lokal Windows (Mosquitto + FastAPI + Next.js)
```

---

## Troubleshooting Ringkas

| Gejala | Penyebab & Solusi |
|---|---|
| `pip install` / Python gagal karena versi Python `>=3.11,<3.13` | Gunakan **`uv sync`** di folder `backend/` (bukan `pip` global); `uv` otomatis memakai Python 3.12 di `.venv`. |
| Web menampilkan status simulasi / tidak terhubung ke backend | Pastikan terminal backend berjalan di port `8000` (`http://127.0.0.1:8000/api/health`) dan web dibuka lewat `http://localhost:3000` atau `http://<IP>:3000` (bukan HTTPS). |
| Perintah dashboard atau `serangan_penyusup.py` berstatus ditolak terus | Identitas pengirim sedang dikarantina akibat uji flood/DoS. Klik rilis karantina di dashboard atau jalankan `python scripts/serangan_penyusup.py 127.0.0.1 --aksi 0`. |
| ESP32 gagal autentikasi MQTT / HMAC tidak cocok | Pastikan `COMMAND_HMAC_SECRET` dan `MQTT_PASSWORD` di `secrets.h` sama persis dengan `backend/.env` dan `deploy/mosquitto/patriot_passwd`, serta port `1883` tidak diblokir Windows Firewall pada profil jaringan Wi-Fi/Hotspot (Private). |

---

## Batasan & Catatan Keamanan Purwarupa

PATRIOT-AD dibangun dan diuji pada *testbed* laboratorium bertegangan rendah (**5V DC USB**). Implementasi pada fasilitas penyimpanan strategis nyata memerlukan penempatan panel kontrol di luar zona bahaya (*safe zone*), selubung sensor/aktuator bersertifikat *Explosion-Proof* (Ex d / ATEX), rotasi rahasia kriptografi produksi, serta enkripsi transport TLS/mTLS pada broker MQTT.
