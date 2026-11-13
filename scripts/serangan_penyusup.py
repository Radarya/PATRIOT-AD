#!/usr/bin/env python3
"""Terminal Simulasi Penyusup Jaringan (Red Team) - PATRIOT-AD.

Skrip ini dirancang menggunakan pustaka bawaan Python (tanpa wajib instalasi pihak ketiga)
agar dapat langsung dijalankan dari laptop kedua (laptop teman) yang terhubung
ke jaringan Wi-Fi/Hotspot yang sama dengan laptop Pos Jaga.

Cara Pakai di Laptop Teman:
    python scripts/serangan_penyusup.py
    atau:
    python scripts/serangan_penyusup.py 192.168.1.24
    atau mode sekali jalan:
    python scripts/serangan_penyusup.py 127.0.0.1 --aksi 5
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_CANDIDATE_HOSTS = ["127.0.0.1", "192.168.1.24"]
PORT = 8000


def cek_koneksi(host: str) -> dict | None:
    url = f"http://{host}:{PORT}/api/health"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def kirim_post(host: str, path: str, body: dict | None = None, extra_headers: dict | None = None) -> dict:
    url = f"http://{host}:{PORT}{path}"
    data = json.dumps(body or {}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def cetak_hasil_serangan(judul: str, hasil: dict) -> None:
    decision = hasil.get("decision") or {}
    inc = hasil.get("incident") or {}
    raw_action = decision.get("action") or hasil.get("status") or "DITOLAK"
    lvl = decision.get("level", 0)

    if lvl == 1:
        action = "PERINGATAN ANOMALI (LEVEL 1 DICATAT)"
    elif lvl == 2:
        action = "DITOLAK & KIPAS DIKUNCI AMAN (LEVEL 2)"
    elif lvl == 3 or raw_action == "QUARANTINE":
        action = "PENGIRIM DIBLOKIR & DIKARANTINA (LEVEL 3)"
    else:
        peta_keputusan = {
            "BLOCK_OR_HOLD": "DITOLAK & KIPAS DIKUNCI AMAN",
            "BLOCK_AND_HOLD": "DITOLAK & KIPAS DIKUNCI AMAN",
            "REJECT_COMMAND": "PERINTAH DITOLAK",
            "QUARANTINE": "PENGIRIM DIBLOKIR & DIKARANTINA",
            "AUDIT": "DATA DICURIGAI PALSU & DICATAT",
            "ALERT": "PERINGATAN DINI AKTIF",
            "ACCEPT": "DITERIMA",
        }
        action = peta_keputusan.get(raw_action, raw_action)
    latency = decision.get("latency_ms", 0.0)
    findings = decision.get("findings") or []
    detail = (
        findings[0].get("detail")
        if findings and isinstance(findings[0], dict)
        else "Perintah penyusup ditolak oleh pengaman sistem."
    )
    detail = (
        detail.replace("'unauthorized'", "Pihak Tanpa Izin")
        .replace("FAN_OFF", "perintah mematikan kipas")
        .replace("FAN_ON", "perintah menyalakan kipas")
        .replace("Safety Gate", "Pengaman Suhu Fisik")
    )
    seq_id = inc.get("seq_id") or decision.get("incident_seq") or "-"
    rec_hash = (inc.get("record_hash") or "-")[:24]

    print("\n" + "=" * 68)
    print(f" HASIL SERANGAN : {judul}")
    print("-" * 68)
    print(f" Keputusan Pos Jaga : {action}")
    print(f" Waktu Respons      : {latency} ms")
    print(f" Alasan Penolakan   : {detail}")
    print(f" Catatan Forensik   : #{seq_id} • Kode SHA-256: {rec_hash}...")
    print("=" * 68 + "\n")


def coba_kirim_mqtt(host: str, topic: str, payload_str: str) -> bool:
    """Mencoba mengirim ke broker MQTT jika paho-mqtt terpasang."""
    try:
        import paho.mqtt.client as mqtt

        c = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id="penyusup_test")
        c.connect(host, 1883, 2)
        c.publish(topic, payload_str, qos=1)
        c.disconnect()
        return True
    except Exception:
        return False


def jalankan_aksi(host: str, pilihan: str) -> None:
    if pilihan == "1":
        print("\n[>] Mengirim perintah palsu 'Matikan Kipas' oleh pihak tanpa izin (unauthorized)...")
        hasil = kirim_post(
            host,
            "/api/command",
            {
                "requester": "unauthorized",
                "command": "FAN_OFF",
                "target_device": "esp32_gudang",
                "reason": "Percobaan mematikan kipas gudang amunisi dari laptop luar tanpa izin.",
            },
        )
        cetak_hasil_serangan("1. Perintah Palsu Pihak Luar Tanpa Izin", hasil)

    elif pilihan == "2":
        print("\n[>] Melancarkan sabotase 'Matikan Kipas' saat suhu gudang panas (>= 32,0°C)...")
        hasil = kirim_post(host, "/api/benchmark/SCN-03")
        cetak_hasil_serangan("2. Sabotase Matikan Kipas Saat Suhu Panas", hasil)

    elif pilihan == "3":
        print("\n[>] Melancarkan Serangan Nyata: Mengirim 15 data telemetri statis (29,80°C persis) berulang-ulang...")
        print("    -> Menguji kemampuan detektor Lapis 2 mendeteksi data beku (Replay/Sensor Freeze)...")
        hasil_terakhir = {}
        for s in range(1, 16):
            payload = {
                "schema_version": "1.0",
                "device_id": "esp32_gudang",
                "seq": s,
                "uptime_ms": s * 2000,
                "temperature_c": 29.80,
                "humidity_pct": 70.0,
                "fan_reported": "OFF",
                "current_ma": 0.0,
                "bus_v": 5.0,
                "interlock_active": False,
                "failsafe_active": False,
                "sensor_status": "NORMAL",
            }
            # Kirim langsung ke mesin deteksi telemetri
            hasil_terakhir = kirim_post(host, "/api/telemetry", payload)
            # Coba juga salurkan ke port MQTT jika tersedia
            coba_kirim_mqtt(host, "patriot/telemetry/esp32_gudang", json.dumps(payload))
            print(f"    -> Paket telemetri statis #{s}/15 terkirim (Suhu: 29.80°C)...")
            time.sleep(0.2)

        cetak_hasil_serangan("3. Injeksi Telemetri Statis/Replay (Deteksi Lapis 2 Riil)", hasil_terakhir)

    elif pilihan == "4":
        print("\n[>] Melancarkan Serangan Nyata: Banjir 15 perintah berkecepatan tinggi dalam 1 detik...")
        print("    -> Menguji kemampuan detektor Lapis 1 memblokir DoS dan mengkarantina sumber penyerang...")
        hasil_terakhir = {}
        for i in range(1, 16):
            hasil_terakhir = kirim_post(
                host,
                "/api/command",
                {
                    "requester": "penyusup_flood",
                    "command": "FAN_OFF",
                    "target_device": "esp32_gudang",
                    "reason": f"Banjir paket spam #{i}/15 untuk memacetkan gateway",
                },
            )
            print(f"    -> Paket banjir #{i}/15 terkirim...")
            time.sleep(0.03)

        cetak_hasil_serangan("4. Serangan Banjir Perintah DoS (Karantina Otomatis Lapis 1)", hasil_terakhir)

    elif pilihan == "5":
        print("\n[>] Melancarkan Serangan Penyamaran: Mengaku sebagai 'operator' resmi TANPA token otorisasi...")
        print("    -> Menguji verifikasi token kriptografis header X-Patriot-Token di Gateway...")
        hasil = kirim_post(
            host,
            "/api/command",
            {
                "requester": "operator",  # Penyerang sengaja memalsukan identitas di body JSON
                "command": "FAN_OFF",
                "target_device": "esp32_gudang",
                "reason": "Percobaan mematikan kipas dengan memalsukan identitas operator piket.",
            },
            # Tanpa menyertakan header X-Patriot-Token resmi!
        )
        cetak_hasil_serangan("5. Penyamaran Identitas Operator (Identity Spoofing)", hasil)

    elif pilihan == "0":
        print("\n[>] Memulihkan status pantauan dan membebaskan daftar karantina...")
        for iden in ("penyusup_flood", "esp32_gudang", "unauthorized"):
            try:
                kirim_post(host, f"/api/quarantine/{iden}/release")
            except Exception:
                pass
        kirim_post(host, "/api/benchmark/SCN-01")
        print("[OK] Status Pos Jaga dan maket fisik telah kembali ke Kondisi Normal.\n")


def pilih_target_host(arg_host: str | None) -> str:
    if arg_host:
        info = cek_koneksi(arg_host)
        if info:
            return arg_host
        print(f"[!] Peringatan: {arg_host}:{PORT} belum merespons, tetap menggunakan {arg_host}.")
        return arg_host

    for h in DEFAULT_CANDIDATE_HOSTS:
        if cek_koneksi(h):
            return h

    print("\n[!] Server Pos Jaga tidak ditemukan di 127.0.0.1 maupun 192.168.1.24.")
    inp = input("Masukkan alamat IP Laptop Pos Jaga (contoh 192.168.1.24): ").strip()
    return inp or "127.0.0.1"


def hitung_mundur_solo(detik: int, label_aksi: str) -> None:
    print("\n" + "*" * 68)
    print(f" [MODE SYUTING SOLO] {label_aksi}")
    print(" Silakan lepas mouse & pegang Kamera HP Anda dengan kedua tangan!")
    print("*" * 68)
    for sisa in range(detik, 0, -1):
        print(f"   >>> Menembakkan serangan dalam {sisa} detik... (Rekam HP sekarang!)")
        time.sleep(1.0)
    print("   >>> [FIRE!] SERANGAN DILANCARKAN SEKARANG!\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulasi Penyusup PATRIOT-AD")
    parser.add_argument("host", nargs="?", default=None, help="Alamat IP Laptop Pos Jaga")
    parser.add_argument("--aksi", choices=["1", "2", "3", "4", "5", "0"], help="Jalankan satu serangan langsung")
    parser.add_argument("--delay", type=int, default=0, help="Hitung mundur detik sebelum serangan (untuk syuting solo)")
    parser.add_argument("--solo", action="store_true", help="Jalankan rangkaian otomatis dengan jeda syuting solo")
    args = parser.parse_args()

    host = pilih_target_host(args.host)
    info = cek_koneksi(host)
    status_alat = (
        "TERHUBUNG (ESP32 Fisik Aktif)"
        if info and info.get("hardware_connected")
        else "MODE SIMULASI (Tanpa Alat Fisik)"
    )

    if args.solo:
        hitung_mundur_solo(8, "Skenario Sabotase Termal FAN_OFF + Serangan Beruntun")
        jalankan_aksi(host, "2")
        time.sleep(4.0)
        jalankan_aksi(host, "1")
        time.sleep(3.0)
        jalankan_aksi(host, "3")
        time.sleep(3.0)
        jalankan_aksi(host, "4")
        return

    if args.aksi:
        if args.delay > 0:
            hitung_mundur_solo(args.delay, f"Aksi Serangan #{args.aksi}")
        jalankan_aksi(host, args.aksi)
        return

    while True:
        print("=" * 68)
        print(" TERMINAL SIMULASI PENYUSUP JARINGAN - PATRIOT-AD")
        print("=" * 68)
        print(f" Sasaran Pos Jaga : http://{host}:{PORT}")
        print(f" Status Sasaran   : {status_alat}")
        print("-" * 68)
        print(" Pilih skenario serangan yang ingin dikirim ke Gudang Amunisi:")
        print("  [1] Kirim Perintah Palsu Tanpa Izin (Coba Matikan Kipas)")
        print("  [2] Sabotase Matikan Kipas Saat Gudang Panas (Uji Pengaman 32,0°C)")
        print("  [3] Injeksi Telemetri Statis/Replay (Uji Deteksi Angka Beku Lapis 2)")
        print("  [4] Serangan Banjir Perintah Beruntun (Uji Karantina DoS Lapis 1)")
        print("  [5] Penyamaran Identitas Operator (Uji Verifikasi Token Otorisasi)")
        print("  [s] MODE SYUTING SOLO: Timer 8 Detik -> Sabotase Otomatis (Hands-Free!)")
        print("  [0] Pulihkan Kondisi Normal & Lepas Karantina")
        print("  [g] Ganti Alamat IP Sasaran")
        print("  [q] Keluar")
        print("-" * 68)

        try:
            pilihan = input("Pilih nomor tindakan [1/2/3/4/5/s/0/q]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nKeluar dari terminal simulasi penyusup.")
            break

        if pilihan == "q":
            print("Keluar dari terminal simulasi penyusup.")
            break
        elif pilihan == "g":
            baru = input("Masukkan alamat IP Laptop Pos Jaga baru: ").strip()
            if baru:
                host = baru
                info = cek_koneksi(host)
                status_alat = (
                    "TERHUBUNG (ESP32 Fisik Aktif)"
                    if info and info.get("hardware_connected")
                    else "MODE SIMULASI (Tanpa Alat Fisik)"
                )
        elif pilihan == "s":
            try:
                hitung_mundur_solo(8, "Sabotase FAN_OFF Saat Gudang Panas (Hands-Free Solo)")
                jalankan_aksi(host, "2")
                jalankan_aksi(host, "1")
            except Exception as err:
                print(f"\n[GAGAL] Terjadi kesalahan: {err}\n")
        elif pilihan in ("1", "2", "3", "4", "5", "0"):
            try:
                jalankan_aksi(host, pilihan)
            except urllib.error.URLError as err:
                print(f"\n[GAGAL] Tidak dapat menghubungi Pos Jaga di {host}:{PORT} ({err}).\n")
            except Exception as err:
                print(f"\n[GAGAL] Terjadi kesalahan: {err}\n")
        else:
            print("\n[!] Pilihan tidak dikenal. Silakan tekan angka 1, 2, 3, 4, 5, s, 0, atau q.\n")


if __name__ == "__main__":
    main()
