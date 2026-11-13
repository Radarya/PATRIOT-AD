"""Uji konektivitas live broker Mosquitto di localhost:1883."""

import json
import time
import paho.mqtt.client as mqtt

received = []


def on_connect(client, userdata, flags, rc, properties=None):
    print(f"[LIVE MQTT] Terhubung ke broker Mosquitto! (RC: {rc})")
    client.subscribe("patriot/test/ping", qos=1)


def on_message(client, userdata, msg):
    payload = msg.payload.decode("utf-8")
    print(f"[LIVE MQTT] Pesan diterima di '{msg.topic}': {payload}")
    received.append(payload)


def main():
    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id="patriot-test-ping")
    client.on_connect = on_connect
    client.on_message = on_message

    print("[LIVE MQTT] Menghubungkan ke 127.0.0.1:1883...")
    client.connect("127.0.0.1", 1883, keepalive=10)
    client.loop_start()

    time.sleep(1.0)
    msg = json.dumps({"test": "PATRIOT-AD-LIVE-PING", "timestamp": time.time()})
    print(f"[LIVE MQTT] Mem-publish pesan ke 'patriot/test/ping'...")
    client.publish("patriot/test/ping", msg, qos=1)

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
