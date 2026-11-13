"""Klien MQTT Policy Gateway (PRD §4.1).

Menggunakan paho-mqtt v2:
- Subscribe ke `patriot/telemetry/+`
- Subscribe ke `patriot/request/cmd/+`
- Meneruskan perintah yang disetujui / keep-safe ke `patriot/approved/cmd/<device>`
- Menyalurkan event ke callback WebSocket (asyncio threadsafe loop)
- Menjalankan koneksi offline-first dengan auto-reconnect backoff (domain-iot skill)
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
from typing import Any, Callable

import paho.mqtt.client as mqtt

from .config import Settings
from .engine import PolicyEngine
from .schemas import ActuatorDirective, Decision, Telemetry

logger = logging.getLogger("patriot.mqtt")


class GatewayMQTTClient:
    def __init__(
        self,
        settings: Settings,
        engine: PolicyEngine,
        on_event_broadcast: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.settings = settings
        self.engine = engine
        self.on_event_broadcast = on_event_broadcast

        # paho-mqtt v2 CallbackAPIVersion.VERSION2 (unique PID suffix prevents client_id collision)
        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"{settings.mqtt_client_id}_{os.getpid()}",
        )
        if settings.mqtt_username:
            self.client.username_pw_set(settings.mqtt_username, settings.mqtt_password)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

        self._connected = False
        self._last_hw_telemetry_time: dict[str, float] = {}
        self._last_mqtt_only_time: dict[str, float] = {}
        self._loop_thread = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    def start(self) -> None:
        if not self.settings.mqtt_enabled:
            logger.info("MQTT dinonaktifkan dalam settings.")
            return

        logger.info(
            f"Menghubungkan ke broker MQTT di {self.settings.mqtt_host}:{self.settings.mqtt_port}..."
        )
        try:
            self.client.connect(
                self.settings.mqtt_host,
                self.settings.mqtt_port,
                keepalive=self.settings.mqtt_keepalive_s,
            )
            self.client.loop_start()
        except Exception as e:
            logger.warning(
                f"Koneksi awal ke broker MQTT gagal ({e}). Engine tetap berjalan offline-first."
            )

    def stop(self) -> None:
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass

    def _on_connect(
        self, client: mqtt.Client, userdata: Any, flags: Any, rc: mqtt.ReasonCode, properties: Any = None
    ) -> None:
        if rc.is_failure:
            logger.error(f"Gagal koneksi ke broker MQTT: {rc}")
            self._connected = False
            return

        self._connected = True
        logger.info("Terhubung ke broker MQTT! Berlangganan topik telemetri dan permintaan perintah...")
        # Subscribe telemetri semua perangkat
        client.subscribe("patriot/telemetry/+", qos=1)
        # Subscribe permintaan perintah semua role/identitas
        client.subscribe("patriot/request/cmd/+", qos=1)

    def _on_disconnect(
        self, client: mqtt.Client, userdata: Any, disconnect_flags: Any, rc: mqtt.ReasonCode, properties: Any = None
    ) -> None:
        self._connected = False
        logger.warning(f"Terputus dari broker MQTT ({rc}). Mencoba rekoneksi otomatis...")

    def _on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        topic: str = msg.topic
        payload: bytes = msg.payload
        parts = topic.split("/")

        try:
            if len(parts) == 3 and parts[0] == "patriot" and parts[1] == "telemetry":
                # Topic: patriot/telemetry/<device_id>
                device_id = parts[2]
                now_ts = time.time()
                prev_hw_ts = self._last_hw_telemetry_time.get(device_id, 0.0)
                prev_mqtt_ts = self._last_mqtt_only_time.get(device_id, 0.0)
                if prev_hw_ts == 0.0 or (now_ts - prev_hw_ts) > 7.0:
                    # Koneksi pertama atau rekoneksi perangkat fisik: bersihkan state simulasi/lama
                    self.engine.reset_to_baseline(device_id)
                elif prev_mqtt_ts == 0.0 or (now_ts - prev_mqtt_ts) > 7.0:
                    # Transisi mulus dari jalur cadangan USB Serial ke Wi-Fi MQTT
                    bst = self.engine.behavior_monitor.get_state(device_id)
                    bst.last_seq = None
                    bst.last_uptime_ms = None
                self._last_hw_telemetry_time[device_id] = now_ts
                self._last_mqtt_only_time[device_id] = now_ts
                decision, directive = self.engine.process_telemetry(device_id, payload)
                self._handle_decision_and_directive(decision, directive)

            elif len(parts) == 4 and parts[0] == "patriot" and parts[1] == "request" and parts[2] == "cmd":
                # Topic: patriot/request/cmd/<requester_identity>
                requester = parts[3]
                decision, directive = self.engine.process_command_request(requester, payload)
                self._handle_decision_and_directive(decision, directive)

        except Exception as err:
            logger.exception(f"Error memproses pesan pada topik {topic}: {err}")

    def _handle_decision_and_directive(
        self, decision: Decision, directive: ActuatorDirective | None
    ) -> None:
        # 1. Jika ada directive untuk aktuator, publish ke patriot/approved/cmd/<target_device>
        if directive is not None and self._connected:
            target_topic = f"patriot/approved/cmd/{directive.target_device}"
            payload_str = directive.model_dump_json()
            self.client.publish(target_topic, payload_str, qos=1)
            logger.info(f"Published directive ke {target_topic}: {payload_str}")

        # 2. Siapkan event broadcast ke WebSocket
        if self.on_event_broadcast is not None:
            is_hw = (
                decision.target_device == "esp32_gudang"
                or (time.time() - self._last_hw_telemetry_time.get("esp32_gudang", 0)) < 7.0
            )
            event_payload = {
                "type": "DECISION",
                "decision": decision.model_dump(),
                "latest_telemetry": (
                    self.engine.latest_telemetry.get(decision.target_device or "").model_dump()
                    if decision.target_device and decision.target_device in self.engine.latest_telemetry
                    else None
                ),
                "directive": directive.model_dump() if directive else None,
                "hardware_connected": is_hw,
                "active_source": "esp32_gudang" if is_hw else "simulator",
                "server_time": time.time(),
            }
            self.on_event_broadcast(event_payload)

    def publish_approved_command(self, directive: ActuatorDirective) -> None:
        """Mengirim directive secara manual dari REST API gateway."""
        if not self._connected:
            logger.warning("Tidak dapat publish approved command: broker offline.")
            return
        topic = f"patriot/approved/cmd/{directive.target_device}"
        self.client.publish(topic, directive.model_dump_json(), qos=1)
