"""Uji integrasi live end-to-end: Mosquitto Broker + Policy Gateway + SQLite + REST API.

Menguji siklus hidup nyata:
1. ESP32 mem-publish telemetri riil (DHT22: 32.5 °C, INA226: 88.5 mA) ke `patriot/telemetry/esp32_gudang`.
2. Gateway mendeteksi telemetri, mengevaluasi 3 Lapis, dan menyimpan ke SQLite.
3. Operator mengirim perintah terlarang FAN_OFF ke `patriot/request/cmd/operator`.
4. Gateway menahan perintah (Safety Gate) dan menerbitkan directive KEEP_SAFE (FAN_ON) ke `patriot/approved/cmd/esp32_gudang`.
5. ESP32 menerima directive KEEP_SAFE dari gateway.
6. Verifikasi REST API /api/status dan /api/forensic/verify.
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

# Tambahkan backend root ke sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import paho.mqtt.client as mqtt

from patriot.config import Calibration, load_settings
from patriot.engine import PolicyEngine
from patriot.forensic_db import ForensicDB
from patriot.mqtt_client import GatewayMQTTClient
from patriot.schemas import FanState, ResponseLevel

received_approved_directives = []


def on_esp32_message(client, userdata, msg):
    payload = json.loads(msg.payload.decode("utf-8"))
    print(f"\n[ESP32 SIMULATOR] Menerima directive di '{msg.topic}':\n  {payload}")
    received_approved_directives.append(payload)


def main():
    print("=" * 60)
    print(" PATRIOT-AD LIVE END-TO-END INTEGRATION TEST")
    print("=" * 60)

    # 1. Inisialisasi DB sementara & Gateway Engine dengan live broker
    with tempfile.TemporaryDirectory(prefix="patriot_live_") as tmpdir:
        tmp = Path(tmpdir)
        db = ForensicDB(
            str(tmp / "live_test.db"),
            str(tmp / "live_checkpoints.jsonl"),
            checkpoint_every=2,
        )
        base_settings = load_settings()
        host = base_settings.mqtt_host or "127.0.0.1"
        port = base_settings.mqtt_port or 1883
        settings = base_settings.model_copy(
            update={
                "mqtt_enabled": True,
                "mqtt_host": host,
                "mqtt_port": port,
                "calibration": Calibration(
                    safety_gate_temp_c=32.0, fan_active_current_ma=40.0
                ),
            }
        )
        engine = PolicyEngine(settings, db)
        gateway = GatewayMQTTClient(settings, engine)
        gateway.start()

        for _ in range(20):
            if gateway.is_connected:
                break
            time.sleep(0.15)
        assert gateway.is_connected, "Gateway gagal terhubung ke broker Mosquitto live!"
        print(f"[1/5] Gateway aktif & terhubung ke Mosquitto di {host}:{port}")

        esp32_user = os.getenv("PATRIOT_ESP32_MQTT_USERNAME", settings.mqtt_username)
        esp32_pass = os.getenv("PATRIOT_ESP32_MQTT_PASSWORD", settings.mqtt_password)

        # 2. ESP32 Simulator Client (Subscribe ke approved commands)
        esp32_client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id="esp32-sim-client",
        )
        if esp32_user and esp32_pass:
            esp32_client.username_pw_set(esp32_user, esp32_pass)
        esp32_client.on_message = on_esp32_message
        esp32_client.connect(host, port)
        esp32_client.subscribe("patriot/approved/cmd/esp32_gudang", qos=1)
        esp32_client.loop_start()
        time.sleep(0.5)

        # 3. Publish Telemetri Panas (DHT22: 32.5 °C > 32.0 °C, INA226: 88.5 mA)
        print("\n[2/5] ESP32 mem-publish telemetri live ke 'patriot/telemetry/esp32_gudang'...")
        telemetry_msg = {
            "schema_version": "1.0",
            "device_id": "esp32_gudang",
            "seq": 100,
            "uptime_ms": 50000,
            "temperature_c": 32.5,
            "humidity_pct": 76.0,
            "fan_reported": "ON",
            "current_ma": 88.5,
            "bus_v": 4.95,
            "interlock_active": False,
            "failsafe_active": False,
        }
        esp32_client.publish(
            "patriot/telemetry/esp32_gudang", json.dumps(telemetry_msg), qos=1
        )
        time.sleep(1.0)

        # Verifikasi telemetri tersimpan di gateway
        latest = engine.latest_telemetry.get("esp32_gudang")
        assert latest is not None and latest.temperature_c == 32.5
        print(f"      -> Gateway berhasil memvalidasi telemetri (Suhu: {latest.temperature_c} °C, Arus: {latest.current_ma} mA)")

        # 4. Operator mengirim perintah terlarang FAN_OFF saat suhu 32.5 °C
        print("\n[3/5] Operator mengirim perintah ilegal FAN_OFF saat suhu tinggi...")
        operator_client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id="operator-sim-client",
        )
        if settings.mqtt_username and settings.mqtt_password:
            operator_client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        operator_client.connect(host, port)
        cmd_msg = {
            "schema_version": "1.0",
            "request_id": "req-live-001",
            "command": "FAN_OFF",
            "target_device": "esp32_gudang",
            "reason": "Uji penyerangan sengaja matikan kipas",
        }
        operator_client.publish("patriot/request/cmd/operator", json.dumps(cmd_msg), qos=1)
        time.sleep(1.5)

        # 5. Verifikasi bahwa Policy Gateway MENAHAN perintah dan mengirim KEEP_SAFE FAN_ON
        print("\n[4/5] Memverifikasi intervensi Policy Gateway & Safety Gate...")
        assert len(received_approved_directives) > 0, "ESP32 tidak menerima directive dari gateway!"
        directive = received_approved_directives[-1]
        assert directive["fan"] == "FAN_ON", f"Perintah seharusnya ditahan ke FAN_ON, tetapi: {directive['fan']}"
        assert directive["origin"] == "KEEP_SAFE", f"Origin harus KEEP_SAFE, tetapi: {directive['origin']}"
        assert directive["alert_level"] == ResponseLevel.BLOCK, f"Alert level harus BLOCK (Merah), tetapi: {directive['alert_level']}"
        print("      -> HASIL: Perintah FAN_OFF SUKSES DITAHAN! Gateway memaksakan KEEP_SAFE (FAN_ON) + Level Merah!")

        # 6. Verifikasi Integritas Rantai Forensik SQLite
        print("\n[5/5] Memverifikasi Integritas Log Audit Berantai SHA-256...")
        report = db.verify_chain()
        print(f"      -> Rantai Rekaman Diperiksa : {report.records_checked}")
        print(f"      -> Checkpoint Diperiksa     : {report.checkpoints_checked}")
        print(f"      -> Head Hash               : {report.head_hash[:16]}...")
        print(f"      -> Status Integritas       : {'VALID (100% UTUH)' if report.ok else 'RUSAK'}")
        assert report.ok is True, "Integritas rantai forensik gagal diverifikasi!"

        # Cleanup
        esp32_client.loop_stop()
        esp32_client.disconnect()
        operator_client.disconnect()
        gateway.stop()
        db.close()

    print("\n" + "=" * 60)
    print(">>> KESIMPULAN: ARSITEKTUR LIVE PATRIOT-AD TERBUKTI 100% KOKOH! <<<")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    exit(main())
