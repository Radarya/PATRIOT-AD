"""Uji konektivitas live broker Mosquitto di localhost:1883."""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import paho.mqtt.client as mqtt
from patriot.config import load_settings

TEST_TOPIC = "patriot/status/test_ping"

received = []
connect_rc = None


def on_connect(client, userdata, flags, rc, properties=None):
    global connect_rc
    connect_rc = rc
    print(f"[LIVE MQTT] Terhubung ke broker Mosquitto! (RC: {rc})")
    is_failure = rc.is_failure if hasattr(rc, "is_failure") else bool(rc)
    if not is_failure:
        client.subscribe(TEST_TOPIC, qos=1)


def on_message(client, userdata, msg):
    payload = msg.payload.decode("utf-8")
    print(f"[LIVE MQTT] Pesan diterima di '{msg.topic}': {payload}")
    received.append(payload)


def main():
    settings = load_settings()
    host = settings.mqtt_host or "127.0.0.1"
    port = settings.mqtt_port or 1883

    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id="patriot-test-ping")
    if settings.mqtt_username and settings.mqtt_password:
        client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
    client.on_connect = on_connect
    client.on_message = on_message

    print(f"[LIVE MQTT] Menghubungkan ke {host}:{port}...")
    client.connect(host, port, keepalive=10)
    client.loop_start()

    time.sleep(1.0)
    msg = json.dumps({"test": "PATRIOT-AD-LIVE-PING", "timestamp": time.time()})
    print(f"[LIVE MQTT] Mem-publish pesan ke '{TEST_TOPIC}'...")
    client.publish(TEST_TOPIC, msg, qos=1)

    time.sleep(1.5)
    client.loop_stop()
    client.disconnect()

    if received:
        print("\n>>> HASIL: BROKER MOSQUITTO BERFUNGSI 100% SECARA LIVE! <<<")
        return 0
    else:
        print("\n>>> HASIL: GAGAL MENERIMA PESAN DARI BROKER <<<")
        return 1


if __name__ == "__main__":
    exit(main())
