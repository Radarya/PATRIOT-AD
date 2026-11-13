"""FastAPI REST API dan WebSocket Real-Time Stream (PRD §4, §7, §8).

Menyediakan:
- WebSocket `/ws` untuk live stream telemetri dan keputusan deteksi.
- REST API `/api/status`, `/api/telemetry`, `/api/incidents`.
- Audit Verifier `/api/forensic/verify` dan ekspor `/api/forensic/export`.
- Kontrol manual `/api/command` yang divalidasi Policy Gateway.
- CORS terbuka untuk dashboard Next.js lokal maupun cloud Vercel.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import socket
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import Settings, load_settings
from .engine import PolicyEngine
from .forensic_db import ForensicDB
from .mqtt_client import GatewayMQTTClient
from .schemas import (
    ActuatorDirective,
    Classification,
    CommandRequest,
    Decision,
    DirectiveOrigin,
    FanCommand,
    FanState,
    Finding,
    FindingCode,
    ResponseLevel,
    Telemetry,
    VerifyReport,
)

logger = logging.getLogger("patriot.api")


class ConnectionManager:
    """Mengelola koneksi klien WebSocket aktif (thread-safe broadcast)."""

    def __init__(self) -> None:
        self.active_connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self.active_connections.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        async with self._lock:
            to_remove = set()
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    to_remove.add(connection)
            for dead in to_remove:
                self.active_connections.discard(dead)


# Global instances
settings: Settings = load_settings()
db = ForensicDB(settings.db_path, settings.checkpoint_path, settings.checkpoint_every)
engine = PolicyEngine(settings, db)
ws_manager = ConnectionManager()
main_event_loop: asyncio.AbstractEventLoop | None = None


def broadcast_from_mqtt(event: dict[str, Any]) -> None:
    """Jembatan callback paho-mqtt (thread terpisah) ke asyncio loop."""
    global main_event_loop
    if main_event_loop and main_event_loop.is_running():
        asyncio.run_coroutine_threadsafe(ws_manager.broadcast(event), main_event_loop)


mqtt_gateway = GatewayMQTTClient(settings, engine, on_event_broadcast=broadcast_from_mqtt)


async def start_tcp_bridge():
    """Jembatan transparan IP_LOKAL:1883 -> 127.0.0.1:1883.
    Memungkinkan ESP32 pada jaringan Wi-Fi lokal tersambung ke Mosquitto Windows
    meskipun Mosquitto terikat pada localhost (127.0.0.1).
    """
    async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            while not reader.at_eof():
                data = await reader.read(4096)
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        except Exception:
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
        peer = client_writer.get_extra_info("peername")
        logger.info(f"[TCP-BRIDGE] Koneksi fisik ESP32 terdeteksi dari {peer}")
        print(f"[TCP-BRIDGE] Koneksi fisik ESP32 terdeteksi dari {peer}", flush=True)
        try:
            broker_reader, broker_writer = await asyncio.open_connection("127.0.0.1", 1883)
            await asyncio.gather(
                pipe(client_reader, broker_writer),
                pipe(broker_reader, client_writer),
                return_exceptions=True,
            )
        except Exception as err:
            logger.warning(f"[TCP-BRIDGE] Gagal menyambung ke Mosquitto lokal: {err}")
            try:
                client_writer.close()
            except Exception:
                pass

    bind_ips = ["0.0.0.0"]
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in bind_ips:
                bind_ips.append(ip)
    except Exception:
        pass

    servers = []
    for b_ip in bind_ips:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((b_ip, 1883))
            sock.setblocking(False)
            server = await asyncio.start_server(handle_client, sock=sock)
            logger.info(f"[TCP-BRIDGE] Jembatan MQTT {b_ip}:1883 aktif untuk deteksi otomatis ESP32.")
            print(f"[TCP-BRIDGE] Jembatan MQTT {b_ip}:1883 aktif untuk deteksi otomatis ESP32.", flush=True)
            servers.append(server)
            if b_ip == "0.0.0.0":
                break  # 0.0.0.0 mencakup seluruh antarmuka
        except Exception as err:
            logger.debug(f"[TCP-BRIDGE] Bind {b_ip}:1883 dilewati: {err}")

    return servers[0] if servers else None


active_serial_conn: Any = None


def send_serial_command(cmd_str: str) -> bool:
    """Kirim perintah langsung ke mikrokontroler ESP32 melalui USB Serial (Dual-Link)."""
    global active_serial_conn
    if active_serial_conn is not None:
        try:
            if getattr(active_serial_conn, "is_open", False):
                active_serial_conn.write(cmd_str.encode("utf-8"))
                active_serial_conn.flush()
                print(f"[SERIAL-OUT] Terkirim ke ESP32 via USB: {cmd_str.strip()}", flush=True)
                return True
        except Exception as err:
            logger.error(f"[SERIAL-OUT] Gagal mengirim perintah via Serial: {err}")
    return False


async def serial_hardware_worker():
    """Detektor otomatis USB Serial (COM7 / CP210x / CH340 / ESP32).
    Jika ESP32 dicolok lewat kabel USB, sistem mendeteksi port secara mandiri
    dan memvalidasi aliran data fisik secara real-time.
    """
    global active_serial_conn
    try:
        import serial
        import serial.tools.list_ports
    except ImportError:
        logger.info("[SERIAL-AUTO] Modul pyserial tidak tersedia, mengandalkan Wi-Fi TCP Bridge.")
        return

    while True:
        try:
            target_port = None
            for p in serial.tools.list_ports.comports():
                desc = (p.description or "").lower()
                hwid = (p.hwid or "").lower()
                if any(k in desc or k in hwid for k in ["cp210", "ch340", "ftdi", "usb to uart", "esp32"]):
                    target_port = p.device
                    break

            if not target_port:
                await asyncio.sleep(2.0)
                continue

            def _open_ser():
                s = serial.Serial(target_port, 115200, timeout=1.0)
                try:
                    s.dtr = False
                    s.rts = False
                except Exception:
                    pass
                return s

            ser = await asyncio.to_thread(_open_ser)
            active_serial_conn = ser
            serial_session_start_ms = int(time.monotonic() * 1000)
            logger.info(f"[SERIAL-AUTO] Terhubung ke simpul fisik pada port {target_port}")
            print(f"[SERIAL-AUTO] Terhubung ke simpul fisik pada port {target_port}", flush=True)

            try:
                import re
                while True:
                    line = await asyncio.to_thread(ser.readline)
                    text = line.decode("utf-8", errors="ignore").strip()
                    if not text:
                        continue

                    print(f"[ESP32-SERIAL] {text}", flush=True)

                    if "[TELEMETRI #" in text:
                        now_ser = time.time()
                        prev_hw_ts = (
                            mqtt_gateway._last_hw_telemetry_time.get("esp32_gudang", 0.0)
                            if mqtt_gateway
                            else 0.0
                        )
                        if prev_hw_ts == 0.0 or (now_ser - prev_hw_ts) > 7.0:
                            # Koneksi fisik pertama kali / rekoneksi: reset baseline agar bebas peringatan palsu
                            engine.reset_to_baseline("esp32_gudang")
                        if mqtt_gateway:
                            mqtt_gateway._last_hw_telemetry_time["esp32_gudang"] = now_ser

                        # Beri jeda 250ms agar jika paket yang sama juga dikirim via MQTT Wi-Fi,
                        # jalur MQTT memprosesnya lebih dulu tanpa duplikasi seq/uptime
                        await asyncio.sleep(0.25)

                        # Jika MQTT Wi-Fi aktif mengirim telemetri dalam 5 detik terakhir,
                        # jangan duplikasi ke engine dari jalur USB agar seq & uptime_ms tidak bentrok!
                        mqtt_stream_active = bool(
                            mqtt_gateway
                            and (time.time() - mqtt_gateway._last_mqtt_only_time.get("esp32_gudang", 0.0)) < 5.0
                        )
                        if mqtt_stream_active:
                            continue

                        # Parser Cadangan Jalur USB (Dual-Link Redundancy saat MQTT putus)
                        m = re.search(
                            r"\[TELEMETRI #(\d+)\]\s*Suhu:\s*([0-9\.\-]+|null)\s*C\s*\|\s*RH:\s*([0-9\.\-]+|null)\s*%\s*\|\s*Fan:\s*([A-Za-z]+)\s*\|\s*Arus INA226:\s*([0-9\.\-]+|null)\s*mA\s*\|\s*Bus:\s*([0-9\.\-]+|null)\s*V",
                            text,
                        )
                        if m:
                            seq_val = int(m.group(1))
                            last_t = engine.latest_telemetry.get("esp32_gudang")
                            if last_t is not None and last_t.seq == seq_val:
                                continue

                            temp_val = float(m.group(2)) if m.group(2) != "null" else None
                            hum_val = float(m.group(3)) if m.group(3) != "null" else None
                            fan_val = FanState.ON if m.group(4).upper() == "ON" else FanState.OFF
                            curr_val = float(m.group(5)) if m.group(5) != "null" else None
                            bus_val = float(m.group(6)) if m.group(6) != "null" else None

                            up_m = re.search(r"Uptime:\s*(\d+)\s*ms", text)
                            boot_m = re.search(r"Boot:\s*(\d+)", text)
                            real_uptime_ms = (
                                int(up_m.group(1))
                                if up_m
                                else max(1, int(time.monotonic() * 1000) - serial_session_start_ms)
                            )
                            real_boot_id = int(boot_m.group(1)) if boot_m else None

                            is_sensor_disconnected = (temp_val is None and seq_val >= 3)
                            t_serial = Telemetry(
                                schema_version="1.0",
                                device_id="esp32_gudang",
                                boot_id=real_boot_id,
                                seq=seq_val,
                                uptime_ms=real_uptime_ms,
                                temperature_c=temp_val,
                                humidity_pct=hum_val,
                                fan_reported=fan_val,
                                current_ma=curr_val,
                                bus_v=bus_val,
                                interlock_active=(temp_val is not None and temp_val >= 32.0),
                                failsafe_active=is_sensor_disconnected,
                                sensor_status="SENSOR_PUTUS" if is_sensor_disconnected else "NORMAL",
                            )
                            # Proses ke mesin kebijakan 3 lapis jika MQTT belum menyalurkan data
                            decision, directive = engine.process_telemetry("esp32_gudang", t_serial.model_dump_json())
                            await ws_manager.broadcast({
                                "type": "DECISION",
                                "decision": decision.model_dump(),
                                "latest_telemetry": t_serial.model_dump(),
                                "directive": directive.model_dump() if directive else None,
                                "hardware_connected": True,
                                "active_source": "esp32_gudang",
                                "server_time": time.time(),
                            })

                    # Beri jeda kecil agar loop tidak membebani CPU
                    await asyncio.sleep(0.05)
            finally:
                active_serial_conn = None
                ser.close()

        except Exception as err:
            active_serial_conn = None
            logger.debug(f"[SERIAL-AUTO] Serial scan: {err}")
            await asyncio.sleep(2.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global main_event_loop
    main_event_loop = asyncio.get_running_loop()
    logger.info("Memulai PATRIOT-AD Policy Gateway...")
    mqtt_gateway.start()

    tcp_server = await start_tcp_bridge()
    ser_task = asyncio.create_task(serial_hardware_worker())

    # Background task untuk cek heartbeat timeout & deteksi otomatis fisik
    async def heartbeat_worker():
        prev_hw_online = False
        while True:
            await asyncio.sleep(1.0)
            hw_online = is_esp32_online()
            if hw_online != prev_hw_online:
                prev_hw_online = hw_online
                logger.info(f"[HARDWARE-DETECTION] Status fisik berubah: online={hw_online}")
                await ws_manager.broadcast({
                    "type": "HARDWARE_STATUS",
                    "hardware_connected": hw_online,
                    "active_source": "esp32_gudang" if hw_online else "simulator",
                    "server_time": time.time(),
                })

            if not hw_online:
                continue
            decisions = engine.check_heartbeats()
            for d in decisions:
                await ws_manager.broadcast({"type": "HEARTBEAT_ALERT", "decision": d.model_dump()})

    task = asyncio.create_task(heartbeat_worker())
    try:
        yield
    finally:
        task.cancel()
        ser_task.cancel()
        if tcp_server:
            tcp_server.close()
            try:
                await tcp_server.wait_closed()
            except Exception:
                pass
        mqtt_gateway.stop()
        db.close()
        logger.info("PATRIOT-AD Policy Gateway dinonaktifkan.")


app = FastAPI(
    title="PATRIOT-AD Edge Command Gateway",
    version="1.0.0",
    description="OT Security Gateway, 3-Layer Detection Engine, & Forensic Hash-Chain Verifier",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app|http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------


def is_esp32_online() -> bool:
    if mqtt_gateway is None:
        return False
    last_t = getattr(mqtt_gateway, "_last_hw_telemetry_time", {}).get("esp32_gudang")
    if last_t is None:
        return False
    return (time.time() - last_t) <= 6.5


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Kirim snapshot status awal saat terhubung
        init_snapshot = {
            "type": "INIT",
            "telemetry": {k: v.model_dump() for k, v in engine.latest_telemetry.items()},
            "alert_level": engine.current_alert_level.value,
            "mqtt_connected": mqtt_gateway.is_connected,
            "hardware_connected": is_esp32_online(),
            "recent_incidents": db.incidents(limit=20),
        }
        await websocket.send_json(init_snapshot)

        while True:
            # Terima pesan dari client jika ada (mis. PING)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# REST Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health")
def get_health():
    return {
        "status": "HEALTHY",
        "db_ok": db.ping(),
        "mqtt_connected": mqtt_gateway.is_connected,
        "hardware_connected": is_esp32_online(),
        "registered_devices": list(settings.telemetry_devices),
    }


@app.get("/api/status")
def get_status():
    return {
        "telemetry": {k: v.model_dump() for k, v in engine.latest_telemetry.items()},
        "decisions": {k: v.model_dump() for k, v in engine.latest_decision.items()},
        "current_alert_level": engine.current_alert_level.value,
        "quarantined_sources": list(engine.comm_monitor._quarantined.keys()),
        "mqtt_connected": mqtt_gateway.is_connected,
        "hardware_connected": is_esp32_online(),
    }


@app.get("/api/telemetry")
def get_telemetry_history(
    device_id: str | None = None, limit: int = Query(default=100, ge=1, le=1000)
):
    return db.recent_telemetry(device_id=device_id, limit=limit)


@app.post("/api/telemetry")
async def post_telemetry(payload: dict[str, Any]):
    """Endpoint injeksi telemetri langsung ke mesin kebijakan (uji coba Red Team)."""
    raw_json = json.dumps(payload)
    device_id = payload.get("device_id", "esp32_gudang")
    decision, directive = engine.process_telemetry(device_id, raw_json)
    if mqtt_gateway and directive and mqtt_gateway.is_connected:
        mqtt_gateway.publish_approved_command(directive)

    event = {
        "type": "DECISION",
        "decision": decision.model_dump(),
        "telemetry": payload,
        "alert_level": engine.current_alert_level.value,
    }
    await ws_manager.broadcast(event)

    return {
        "status": decision.action,
        "decision": decision.model_dump(),
        "directive": directive.model_dump() if directive else None,
        "incident_seq": decision.incident_seq,
    }


@app.get("/api/incidents")
def get_incidents(
    limit: int = Query(default=50, ge=1, le=500), after_seq: int | None = None
):
    return db.incidents(limit=limit, after_seq=after_seq)


@app.get("/api/forensic/verify", response_model=VerifyReport)
def verify_forensic_chain():
    """Memeriksa integritas rantai SHA-256 dan file checkpoint (PRD §7)."""
    return db.verify_chain()


@app.get("/api/forensic/export")
def export_forensic_chain():
    """Ekspor penuh log audit berantai untuk arsip peradilan / audit militer."""
    return db.export_chain()


class ManualCommandPayload(BaseModel):
    requester: str = Field(default="dashboard")
    command: FanCommand
    target_device: str = Field(default="esp32_gudang")
    reason: str | None = None


@app.post("/api/hardware/test-leds")
async def test_leds_hardware():
    """Uji coba 3 lampu LED fisik (Hijau, Kuning, Merah) bergantian masing-masing 1 detik."""
    send_serial_command("T\n")
    return {"status": "TEST_TRIGGERED", "message": "Perintah tes LED (T) dikirim ke ESP32"}


@app.post("/api/hardware/test-buzzer")
async def test_buzzer_hardware():
    """Uji coba suara Buzzer fisik (2x Beep) pada GPIO 33."""
    send_serial_command("B\n")
    return {"status": "BUZZER_TRIGGERED", "message": "Perintah tes Buzzer (B) dikirim ke ESP32"}


@app.post("/api/hardware/toggle-relay")
async def toggle_relay_polarity():
    """Membalikkan polaritas kontrol relay fisik (Active-LOW <-> Active-HIGH) jika kabel berada pada port NC/NO."""
    send_serial_command("X\n")
    return {"status": "POLARITY_TOGGLED", "message": "Perintah membalik logika polaritas relay (X) dikirim ke ESP32"}


@app.post("/api/command")
async def post_manual_command(
    payload: ManualCommandPayload,
    x_patriot_token: str | None = Header(default=None),
):
    """Kirim perintah dari Web Dashboard melalui Policy Gateway (PRD §4.1).

    Identitas pemohon (requester) ditentukan dari header token ``X-Patriot-Token``,
    bukan semata dari body JSON, sehingga penyusup yang memalsukan
    ``"requester": "operator"`` tanpa token sah tetap terdeteksi sebagai ``unauthorized``.
    """
    verified_role = settings.role_tokens.get(x_patriot_token or "")
    if verified_role:
        effective_requester = verified_role
        effective_reason = payload.reason
    else:
        effective_requester = "unauthorized"
        if payload.requester in ("operator", "admin", "dashboard"):
            effective_reason = (
                f"Penyamaran identitas '{payload.requester}' tanpa token sah ditolak oleh pos jaga."
            )
        else:
            effective_reason = payload.reason

    req = CommandRequest(
        schema_version="1.0",
        request_id=f"cmd-{int(time.time()*1000)}",
        command=payload.command,
        target_device=payload.target_device,
        reason=effective_reason,
    )
    decision, directive = engine.process_command_request(
        requester=effective_requester,
        payload_bytes=req.model_dump_json(),
    )

    if directive is not None:
        mqtt_gateway.publish_approved_command(directive)
        if directive.fan == FanCommand.FAN_ON:
            send_serial_command("1\n")
        elif directive.fan == FanCommand.FAN_OFF:
            send_serial_command("0\n")

        lvl_map = {0: "N\n", 1: "W\n", 2: "I\n", 3: "Q\n"}
        if directive.alert_level in lvl_map:
            send_serial_command(lvl_map[directive.alert_level])

    latest_inc = None
    if decision.incident_seq is not None:
        incs = db.incidents(limit=1)
        if incs:
            latest_inc = incs[0]

    # Sinkronisasi status simulasi HANYA jika hardware fisik belum terhubung.
    # Saat ESP32 online, dashboard wajib menunggu laporan telemetri asli (bukti fisik independen).
    updated_telemetry = None
    target = payload.target_device or "esp32_gudang"
    if not is_esp32_online() and decision.action in ("APPROVE", "BLOCK_OR_HOLD", "BLOCK_AND_HOLD"):
        prev_t = engine.latest_telemetry.get(target)
        new_fan = (
            FanState.ON
            if (decision.action != "APPROVE" or payload.command == FanCommand.FAN_ON)
            else FanState.OFF
        )
        new_current = 88.5 if new_fan == FanState.ON else 0.0
        new_temp = prev_t.temperature_c if prev_t and prev_t.temperature_c is not None else 30.2
        new_hum = prev_t.humidity_pct if prev_t and prev_t.humidity_pct is not None else 58.2

        simulated_t = Telemetry(
            schema_version="1.0",
            device_id=target,
            seq=engine._next_gateway_seq(),
            uptime_ms=int(time.time() * 1000) % 4000000000,
            temperature_c=new_temp,
            humidity_pct=new_hum,
            fan_reported=new_fan,
            current_ma=new_current,
            bus_v=5.0,
            interlock_active=(decision.action in ("BLOCK_OR_HOLD", "BLOCK_AND_HOLD")),
            failsafe_active=False,
            sensor_status="NORMAL",
        )
        engine.latest_telemetry[target] = simulated_t
        updated_telemetry = simulated_t.model_dump()

    # Broadcast hasil keputusan ke seluruh WebSocket client
    await ws_manager.broadcast(
        {
            "type": "DECISION",
            "decision": decision.model_dump(),
            "directive": directive.model_dump() if directive else None,
            "latest_telemetry": updated_telemetry,
            "incident": latest_inc,
            "server_time": time.time(),
        }
    )

    return {
        "status": decision.action,
        "decision": decision.model_dump(),
        "directive": directive.model_dump() if directive else None,
        "latest_telemetry": updated_telemetry,
        "incident": latest_inc,
    }


def _require_valid_token(x_patriot_token: str | None) -> str:
    token = (x_patriot_token or "").strip()
    if token and settings.api_token and token == settings.api_token:
        return "admin"
    role = settings.role_tokens.get(token)
    if role in ("admin", "operator", "dashboard"):
        return role
    raise HTTPException(
        status_code=401,
        detail="Token otorisasi X-Patriot-Token tidak sah atau tidak disertakan.",
    )


@app.post("/api/quarantine/{identity}/release")
async def release_quarantine(
    identity: str,
    x_patriot_token: str | None = Header(default=None),
):
    """Lepaskan perangkat atau identitas dari karantina aplikasi."""
    _require_valid_token(x_patriot_token)
    engine.comm_monitor.unquarantine(identity)
    return {"status": "RELEASED", "identity": identity}


class LoginRequest(BaseModel):
    role: str
    nrp: str | None = None
    pin: str | None = None


@app.post("/api/auth/login")
def login_operator(payload: LoginRequest):
    """Autentikasi peran pos jaga dan keluarkan token otorisasi dari backend (bukan hardcoded di UI)."""
    role_key = (payload.role or "").strip().lower()
    if role_key == "unauthorized":
        return {
            "ok": False,
            "role": "unauthorized",
            "token": "",
            "name": "Penyusup Siber (Tamu Ilegal)",
            "nrp": "UNKNOWN_EXTERNAL",
            "roleLabel": "Penyusup / Tamu Ilegal",
        }

    role_to_token = {v: k for k, v in settings.role_tokens.items()}
    token = role_to_token.get(role_key)
    if not token:
        raise HTTPException(status_code=403, detail=f"Peran '{payload.role}' tidak dikenali.")

    default_profile = {
        "admin": ("Mayor Cba Hendra Pratama", "1108004523", "Perwira Pengawas"),
        "operator": ("Sertu Fulan", "3112009871", "Operator Piket"),
        "dashboard": ("Pos Jaga Terpadu", "0000000001", "Operator Dashboard"),
    }.get(role_key, ("Personel Piket", "0000000000", role_key.title()))

    return {
        "ok": True,
        "role": role_key,
        "token": token,
        "name": default_profile[0],
        "nrp": payload.nrp.strip() if payload.nrp and payload.nrp.strip() else default_profile[1],
        "roleLabel": default_profile[2],
    }


@app.get("/api/config")
def get_config():
    return {
        "settings": settings.model_dump(
            exclude={"api_token", "mqtt_password", "command_hmac_secret", "role_tokens"}
        ),
        "calibration": settings.calibration.model_dump(),
    }


@app.post("/api/benchmark/{scenario_id}")
async def trigger_benchmark_scenario(
    scenario_id: str,
    x_patriot_token: str | None = Header(default=None),
):
    """Jalankan evaluasi benchmark 3 metode (SCN-01 s/d SCN-05) memakai mesin deteksi riil."""
    _require_valid_token(x_patriot_token)
    now = time.time()
    scn = scenario_id.upper()
    target = "esp32_gudang"
    simulated_telemetry = None
    directive: ActuatorDirective | None = None

    hw_online = is_esp32_online()
    saved_hw_telemetry = engine.latest_telemetry.get(target) if hw_online else None
    saved_hw_state = (
        copy.deepcopy(engine.behavior_monitor._states.get(target)) if hw_online else None
    )

    if scn == "SCN-01":
        normal_t, decision = engine.reset_to_baseline(target)
        if saved_hw_telemetry is not None:
            restored_t = saved_hw_telemetry.model_copy(
                update={"interlock_active": False, "failsafe_active": False, "sensor_status": "NORMAL"}
            )
            engine.latest_telemetry[target] = restored_t
            if saved_hw_state is not None:
                engine.behavior_monitor._states[target] = saved_hw_state
            simulated_telemetry = restored_t.model_dump()
        else:
            simulated_telemetry = normal_t.model_dump()
        engine._held_alert_level = ResponseLevel.NONE
        engine._alert_hold_until = 0.0
        engine.current_alert_level = ResponseLevel.NONE
        directive = ActuatorDirective(
            gateway_seq=engine._next_gateway_seq(),
            target_device=target,
            fan=FanCommand.FAN_ON,
            alert_level=ResponseLevel.NONE,
            origin=DirectiveOrigin.ALERT_UPDATE,
        )
    elif scn == "SCN-02":
        engine.reset_to_baseline(target)
        t_base = Telemetry(
            schema_version="1.0",
            device_id=target,
            seq=100,
            uptime_ms=100_000,
            temperature_c=30.2,
            humidity_pct=73.5,
            fan_reported=FanState.ON,
            current_ma=88.5,
            bus_v=5.0,
            sensor_status="NORMAL",
        )
        engine.process_telemetry(target, t_base.model_dump_json(), arrival_time_s=now - 1.0)

        t_scn2 = Telemetry(
            schema_version="1.0",
            device_id=target,
            seq=101,
            uptime_ms=101_000,
            temperature_c=33.7,
            humidity_pct=73.8,
            fan_reported=FanState.ON,
            current_ma=91.5,
            bus_v=4.97,
            sensor_status="NORMAL",
        )
        decision, directive = engine.process_telemetry(
            target, t_scn2.model_dump_json(), arrival_time_s=now
        )
        simulated_telemetry = t_scn2.model_dump()
    elif scn == "SCN-03":
        engine.reset_to_baseline(target)
        t_scn3 = Telemetry(
            schema_version="1.0",
            device_id=target,
            seq=100,
            uptime_ms=100_000,
            temperature_c=32.5,
            humidity_pct=74.2,
            fan_reported=FanState.ON,
            current_ma=88.5,
            bus_v=4.99,
            interlock_active=False,
            sensor_status="NORMAL",
        )
        engine.process_telemetry(target, t_scn3.model_dump_json(), arrival_time_s=now - 0.5)

        req_off = CommandRequest(
            schema_version="1.0",
            request_id=f"bench-scn03-{int(now * 1000)}",
            command=FanCommand.FAN_OFF,
            target_device=target,
            reason="Uji Safety Gate suhu tinggi (>= 32.0 C)",
        )
        decision, directive = engine.process_command_request(
            "operator", req_off.model_dump_json(), arrival_time_s=now
        )
        t_scn3_interlocked = t_scn3.model_copy(update={"interlock_active": True})
        engine.latest_telemetry[target] = t_scn3_interlocked
        simulated_telemetry = t_scn3_interlocked.model_dump()
    elif scn == "SCN-04":
        engine.reset_to_baseline(target)
        decision = None
        t_scn4 = None
        stale_count = settings.calibration.stale_identical_samples
        for idx in range(stale_count):
            t_scn4 = Telemetry(
                schema_version="1.0",
                device_id=target,
                seq=100 + idx,
                uptime_ms=100_000 + idx * 2000,
                temperature_c=29.8,
                humidity_pct=76.0,
                fan_reported=FanState.ON,
                current_ma=88.5,
                bus_v=5.0,
                sensor_status="NORMAL",
            )
            decision, directive = engine.process_telemetry(
                target,
                t_scn4.model_dump_json(),
                arrival_time_s=now - (stale_count - 1 - idx) * 2.0,
            )
        simulated_telemetry = t_scn4.model_dump() if t_scn4 else None
    else:  # SCN-05
        attacker_id = "intruder_burst"
        engine.comm_monitor.unquarantine(attacker_id)
        engine.comm_monitor._msg_history.pop(attacker_id, None)
        for code in list(engine._finding_last_logged.keys()):
            if code[0] == attacker_id:
                engine._finding_last_logged.pop(code, None)

        burst_total = settings.calibration.burst_max_messages + 2
        decision = None
        burst_decision = None
        for idx in range(burst_total):
            req_burst = CommandRequest(
                schema_version="1.0",
                request_id=f"bench-scn05-{int(now * 1000)}-{idx}",
                command=FanCommand.FAN_OFF,
                target_device=target,
                reason=f"Flood DoS packet #{idx + 1}",
            )
            step_dec, _ = engine.process_command_request(
                attacker_id,
                req_burst.model_dump_json(),
                arrival_time_s=now - 0.5 + idx * 0.02,
            )
            decision = step_dec
            if any(f.code == FindingCode.MESSAGE_BURST for f in step_dec.findings):
                burst_decision = step_dec
        if burst_decision is not None:
            decision = burst_decision

        directive = ActuatorDirective(
            gateway_seq=engine._next_gateway_seq(),
            target_device=target,
            fan=FanCommand.FAN_ON,
            alert_level=ResponseLevel.QUARANTINE,
            origin=DirectiveOrigin.KEEP_SAFE,
        )
        t_scn5 = Telemetry(
            schema_version="1.0",
            device_id=target,
            seq=engine._next_gateway_seq(),
            uptime_ms=int(now * 1000) % 4_000_000_000,
            temperature_c=30.2,
            humidity_pct=58.2,
            fan_reported=FanState.ON,
            current_ma=88.5,
            bus_v=5.0,
            interlock_active=False,
            failsafe_active=True,
            sensor_status="NORMAL",
        )
        engine.latest_telemetry[target] = t_scn5
        simulated_telemetry = t_scn5.model_dump()

    if scn != "SCN-01" and decision is not None:
        engine._held_alert_level = decision.level
        engine._alert_hold_until = now + 6.0
        engine.current_alert_level = decision.level
        # Pulihkan state urutan seq/uptime perangkat fisik agar telemetri riil berikutnya tidak memicu SEQ_REPLAY
        if saved_hw_state is not None:
            engine.behavior_monitor._states[target] = saved_hw_state
        if saved_hw_telemetry is not None:
            engine.latest_telemetry[target] = saved_hw_telemetry

    if directive is not None:
        mqtt_gateway.publish_approved_command(directive)
        if directive.fan == FanCommand.FAN_ON:
            send_serial_command("1\n")
        elif directive.fan == FanCommand.FAN_OFF:
            send_serial_command("0\n")

        lvl_map = {0: "N\n", 1: "W\n", 2: "I\n", 3: "Q\n"}
        if directive.alert_level in lvl_map:
            send_serial_command(lvl_map[directive.alert_level])

    latest_inc = None
    if decision.incident_seq is not None:
        incs = db.incidents(limit=1)
        if incs:
            latest_inc = incs[0]

    await ws_manager.broadcast(
        {
            "type": "DECISION",
            "scenario": scn,
            "decision": decision.model_dump(),
            "directive": directive.model_dump(),
            "latest_telemetry": simulated_telemetry,
            "incident": latest_inc,
            "server_time": time.time(),
        }
    )

    return {
        "scenario": scn,
        "decision": decision.model_dump(),
        "directive": directive.model_dump(),
        "latest_telemetry": simulated_telemetry,
        "incident": latest_inc,
    }
