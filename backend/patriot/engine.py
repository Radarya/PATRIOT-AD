"""Policy Gateway Engine (PRD §4, §5, §6, §8).

Mengintegrasikan Mesin Deteksi 3 Lapis, Pengambilan Keputusan Deterministik,
Forensic Hash-Chain DB, dan Pembanding Benchmark (Metode A vs B vs C).
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from pydantic import ValidationError

from .config import Settings
from .detection.classifier import UNTRUSTED_TELEMETRY_CODES, classify
from .detection.layer1_comm import CommunicationMonitor
from .detection.layer2_behavior import TelemetryBehaviorMonitor
from .detection.layer3_physical import PhysicalConsistencyMonitor
from .forensic_db import ForensicDB
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
)


class PolicyEngine:
    def __init__(self, settings: Settings, db: ForensicDB) -> None:
        self.settings = settings
        self.cal = settings.calibration
        self.db = db

        self.comm_monitor = CommunicationMonitor(settings)
        self.behavior_monitor = TelemetryBehaviorMonitor(self.cal)
        self.physical_monitor = PhysicalConsistencyMonitor(self.cal)

        # Gateway sequence number monoton naik untuk ActuatorDirective (uint32-safe)
        self._gateway_seq: int = int(time.time()) % 1000000

        # Status terkini per perangkat (cache in-memory)
        self.latest_telemetry: dict[str, Telemetry] = {}
        self.latest_decision: dict[str, Decision] = {}
        self.current_alert_level: ResponseLevel = ResponseLevel.NONE
        self._alert_hold_until: float = 0.0
        self._held_alert_level: ResponseLevel = ResponseLevel.NONE

        # Pelacak cooldown temuan agar insiden tidak dibanjiri log berulang
        self._finding_last_logged: dict[tuple[str, FindingCode], float] = {}

        # Inisialisasi status baseline normal agar sistem tidak start dengan kondisi kosong/cacat
        self.reset_to_baseline(self.settings.default_actuator)

    def reset_to_baseline(self, device_id: str = "esp32_gudang") -> tuple[Telemetry, Decision]:
        """Kembalikan engine, monitor deteksi, dan status fisik ke baseline normal bersih (SCN-01)."""
        now = time.time()
        self.current_alert_level = ResponseLevel.NONE
        self._held_alert_level = ResponseLevel.NONE
        self._alert_hold_until = 0.0
        self._finding_last_logged.clear()

        # Reset Lapis 1: Komunikasi & Heartbeat
        self.comm_monitor._quarantined.clear()
        self.comm_monitor._msg_history.clear()
        self.comm_monitor.record_telemetry_time(device_id, now)

        # Reset Lapis 2: Statistik Perilaku
        bst = self.behavior_monitor.get_state(device_id)
        bst.last_seq = None
        bst.last_uptime_ms = None
        bst.last_timestamp_s = None
        bst.last_temp_c = None
        bst.identical_temp_count = 0
        bst.last_identical_value = None
        bst.last_identical_humidity = None
        bst.last_identical_current = None
        bst.temp_window.clear()

        # Reset Status Anomali & Kunci Alarm Gateway
        self._held_alert_level = ResponseLevel.NONE
        self._alert_hold_until = 0.0
        self.current_alert_level = ResponseLevel.NONE
        self._finding_last_logged.clear()

        # Reset Lapis 3: Bukti Fisik & Kesesuaian Status
        st = self.physical_monitor.get_state(device_id)
        st.expected_command = FanCommand.FAN_ON
        st.last_command_time_s = None
        st.state_mismatch_counter = 0
        st.no_current_counter = 0
        st.current_while_off_counter = 0
        st.fan_on_start_time_s = None
        st.fan_on_start_temp_c = None

        # Telemetri Baseline Normal (Kipas ON, Arus 88.5 mA, Suhu 30.2°C, Kelembapan 58.2%)
        normal_t = Telemetry(
            schema_version="1.0",
            device_id=device_id,
            seq=self._next_gateway_seq(),
            uptime_ms=3600000,
            temperature_c=30.2,
            humidity_pct=58.2,
            fan_reported=FanState.ON,
            current_ma=88.5,
            bus_v=5.0,
            interlock_active=False,
            failsafe_active=False,
            sensor_status="NORMAL",
        )
        self.latest_telemetry[device_id] = normal_t

        normal_dec = Decision(
            source_identity=device_id,
            event_type="TELEMETRY",
            target_device=device_id,
            classification=Classification.NORMAL,
            level=ResponseLevel.NONE,
            action="ACCEPT",
            findings=[],
            method_a_alarm=False,
            method_b_alarm=False,
            latency_ms=0.12,
        )
        self.latest_decision[device_id] = normal_dec

        return normal_t, normal_dec

    def _next_gateway_seq(self) -> int:
        self._gateway_seq += 1
        return self._gateway_seq

    def _is_finding_cooldown(self, device_id: str, code: FindingCode, now: float) -> bool:
        key = (device_id, code)
        last = self._finding_last_logged.get(key)
        cooldown = self.cal.finding_cooldown_s
        if last is not None and (now - last) < cooldown:
            return True
        self._finding_last_logged[key] = now
        return False

    def is_temperature_trusted(self, device_id: str) -> bool:
        """Cek apakah data suhu perangkat ini saat ini dapat dipercaya untuk Safety Gate."""
        dec = self.latest_decision.get(device_id)
        if dec is None:
            return True
        for f in dec.findings:
            if f.code in UNTRUSTED_TELEMETRY_CODES:
                return False
        return True

    def process_telemetry(
        self,
        topic_identity: str,
        payload_bytes: bytes | str,
        arrival_time_s: float | None = None,
    ) -> tuple[Decision, ActuatorDirective | None]:
        t0 = time.perf_counter()
        now = arrival_time_s if arrival_time_s is not None else time.time()
        findings: list[Finding] = []

        # 1. Lapis 1: Cek Message Burst dari identitas pengirim
        findings.extend(self.comm_monitor.check_message_burst(topic_identity, now))

        # 2. Parsing dan Validasi Skema (Pydantic v2 strict)
        try:
            raw_str = payload_bytes.decode("utf-8") if isinstance(payload_bytes, bytes) else payload_bytes
            data = json.loads(raw_str)
            telemetry = Telemetry.model_validate(data)
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as err:
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.SCHEMA_INVALID,
                    detail=f"Skema telemetri dari '{topic_identity}' tidak valid: {err}",
                    evidence={"raw": str(payload_bytes)[:200]},
                )
            )
            classification, level = classify(findings)
            decision = Decision(
                source_identity=topic_identity,
                event_type="TELEMETRY",
                target_device=topic_identity,
                classification=classification,
                level=level,
                action="REJECT_TELEMETRY",
                findings=findings,
                latency_ms=round((time.perf_counter() - t0) * 1000, 3),
            )
            # Catat insiden skema tidak valid ke DB
            rec = self.db.append_incident(
                source_identity=topic_identity,
                event_type="TELEMETRY",
                classification=classification.value,
                response_level=level.value,
                evidence={"findings": [f.model_dump() for f in findings]},
            )
            decision.incident_seq = rec["seq_id"]
            return decision, None

        # 3. Lapis 1: Validasi sumber dan catat waktu heartbeat
        findings.extend(self.comm_monitor.check_telemetry_source(topic_identity, telemetry))
        self.comm_monitor.record_telemetry_time(topic_identity, now)

        # 4. Lapis 2: Perilaku Statistik Telemetri (Urutan, Z-score, dT/dt, Stale)
        beh_result = self.behavior_monitor.evaluate(telemetry, now)
        findings.extend(beh_result.findings)

        # 5. Lapis 3: Bukti Fisik & Konsistensi Kontrol (Sensor arus INA226, respon suhu)
        if telemetry.interlock_active:
            self.physical_monitor.record_command(topic_identity, FanCommand.FAN_ON, now)
            if telemetry.temperature_c is not None:
                findings.append(
                    Finding(
                        layer=1,
                        code=FindingCode.UNSAFE_COMMAND,
                        detail=(
                            f"Autonomous Edge Safety Gate aktif: suhu gudang {telemetry.temperature_c:.1f} °C "
                            f">= {self.cal.safety_gate_temp_c:.1f} °C. Kipas dipaksa menyala mandiri (FAN_ON)."
                        ),
                        evidence={
                            "temperature_c": telemetry.temperature_c,
                            "safety_gate_temp_c": self.cal.safety_gate_temp_c,
                            "interlock_active": True,
                        },
                    )
                )
            elif not any(f.code == FindingCode.SENSOR_DISCONNECTED for f in findings):
                findings.append(
                    Finding(
                        layer=1,
                        code=FindingCode.SENSOR_DISCONNECTED,
                        detail="Autonomous Edge Interlock aktif (Mode Fail-Safe: sensor terputus). Kipas dipaksa menyala mandiri.",
                        evidence={
                            "interlock_active": True,
                            "failsafe_active": telemetry.failsafe_active,
                        },
                    )
                )
        physical_findings = self.physical_monitor.evaluate(telemetry, now)
        findings.extend(physical_findings)

        # 6. Klasifikasi Bukti & Level Respons Deterministik (PRD §6)
        classification, level = classify(findings)

        # 7. Pembanding Benchmark (PRD §8)
        # Metode A: hanya alarm jika suhu > method_a_temp_c (34.0 °C)
        method_a_alarm = (
            telemetry.temperature_c is not None and telemetry.temperature_c > self.cal.method_a_temp_c
        )
        # Metode B: hanya alarm jika protokol melanggar (di sini telemetri authenticated broker lolos)
        method_b_alarm = False

        # Update cache in-memory
        self.latest_telemetry[topic_identity] = telemetry
        self.current_alert_level = level

        # Simpan telemetri ke SQLite
        self.db.insert_telemetry(telemetry, accepted=(level != ResponseLevel.QUARANTINE))

        # Filter finding untuk pencatatan insiden (terapkan cooldown agar tidak duplikat setiap 2 detik)
        new_findings_to_log: list[Finding] = []
        for f in findings:
            if not self._is_finding_cooldown(topic_identity, f.code, now):
                new_findings_to_log.append(f)

        incident_seq: int | None = None
        if new_findings_to_log or level > ResponseLevel.NONE:
            evidence_dict = {
                "telemetry": telemetry.model_dump(),
                "findings": [f.model_dump() for f in findings],
                "z_score": beh_result.z_score,
                "dtdt": beh_result.dtdt_c_per_s,
            }
            rec = self.db.append_incident(
                source_identity=topic_identity,
                event_type="TELEMETRY",
                classification=classification.value,
                response_level=level.value,
                evidence=evidence_dict,
            )
            incident_seq = rec["seq_id"]

        decision = Decision(
            source_identity=topic_identity,
            event_type="TELEMETRY",
            target_device=topic_identity,
            classification=classification,
            level=level,
            action="ACCEPT" if level != ResponseLevel.QUARANTINE else "QUARANTINE",
            findings=findings,
            method_a_alarm=method_a_alarm,
            method_b_alarm=method_b_alarm,
            latency_ms=round((time.perf_counter() - t0) * 1000, 3),
            incident_seq=incident_seq,
        )
        self.latest_decision[topic_identity] = decision

        # Pertahankan alarm fisik selama 6 detik pada runtime nyata agar LED & Buzzer terbaca jelas
        effective_alert_level = level
        if arrival_time_s is None:
            if level > ResponseLevel.NONE:
                self._held_alert_level = level
                self._alert_hold_until = now + 6.0
            elif now < self._alert_hold_until:
                effective_alert_level = self._held_alert_level
                self.current_alert_level = effective_alert_level

        # Jika level indikator fisik berubah, kirim directive pembaruan alert_level ke ESP32
        directive = ActuatorDirective(
            gateway_seq=self._next_gateway_seq(),
            target_device=topic_identity,
            fan=None,
            alert_level=effective_alert_level,
            origin=DirectiveOrigin.ALERT_UPDATE,
        )

        return decision, directive

    def process_command_request(
        self,
        requester: str,
        payload_bytes: bytes | str,
        arrival_time_s: float | None = None,
    ) -> tuple[Decision, ActuatorDirective | None]:
        t0 = time.perf_counter()
        now = arrival_time_s if arrival_time_s is not None else time.time()
        findings: list[Finding] = []

        # 1. Lapis 1: Cek Message Burst dari pemohon perintah
        findings.extend(self.comm_monitor.check_message_burst(requester, now))

        # 2. Parsing dan Validasi Skema
        try:
            raw_str = payload_bytes.decode("utf-8") if isinstance(payload_bytes, bytes) else payload_bytes
            data = json.loads(raw_str)
            cmd_req = CommandRequest.model_validate(data)
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as err:
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.SCHEMA_INVALID,
                    detail=f"Skema perintah dari '{requester}' tidak valid: {err}",
                    evidence={"raw": str(payload_bytes)[:200]},
                )
            )
            classification, level = classify(findings)
            rec = self.db.append_incident(
                source_identity=requester,
                event_type="COMMAND",
                classification=classification.value,
                response_level=level.value,
                evidence={"findings": [f.model_dump() for f in findings]},
            )
            decision = Decision(
                source_identity=requester,
                event_type="COMMAND",
                classification=classification.value,
                level=level,
                action="REJECT_COMMAND",
                findings=findings,
                latency_ms=round((time.perf_counter() - t0) * 1000, 3),
                incident_seq=rec["seq_id"],
            )
            return decision, None

        target = cmd_req.target_device or self.settings.default_actuator
        latest_t = self.latest_telemetry.get(target)
        current_temp = latest_t.temperature_c if latest_t else None
        temp_trusted = self.is_temperature_trusted(target)

        # 3. Lapis 1: Evaluasi Kebijakan Otorisasi & Safety Gate
        policy_findings, allowed = self.comm_monitor.check_command_policy(
            requester=requester,
            cmd=cmd_req,
            latest_temp_c=current_temp,
            is_temp_trusted=temp_trusted,
        )
        findings.extend(policy_findings)

        classification, level = classify(findings)

        # 4. Pembanding Benchmark pada Skenario Perintah Ilegal (SCN-03)
        # Jika attacker sah kirim FAN_OFF saat suhu tinggi:
        # - Metode A: lolos jika suhu < 34.0 °C
        # - Metode B: LOLOS karena identitasnya sah di broker MQTT!
        # - Metode C (PATRIOT-AD): DITAHAN oleh Safety Gate!
        method_a_alarm = current_temp is not None and current_temp > self.cal.method_a_temp_c
        method_b_alarm = False  # Metode B tertipu karena kredensial sah!

        action = "APPROVE" if allowed else "BLOCK_OR_HOLD"
        directive: ActuatorDirective | None = None

        if allowed:
            # Perintah disetujui: teruskan ke topik patriot/approved/cmd/<target>
            self.physical_monitor.record_command(target, cmd_req.command, now)
            directive = ActuatorDirective(
                gateway_seq=self._next_gateway_seq(),
                target_device=target,
                fan=cmd_req.command,
                alert_level=level,
                origin=DirectiveOrigin.OPERATOR,
                request_id=cmd_req.request_id,
            )
        else:
            if arrival_time_s is None and level > ResponseLevel.NONE:
                self._held_alert_level = level
                self._alert_hold_until = now + 6.0
                self.current_alert_level = level

            # Jika ditahan oleh Safety Gate: kirim keep-safe FAN_ON paksa + LED Merah + Buzzer
            if any(f.code == FindingCode.UNSAFE_COMMAND for f in findings):
                self.physical_monitor.record_command(target, FanCommand.FAN_ON, now)
                directive = ActuatorDirective(
                    gateway_seq=self._next_gateway_seq(),
                    target_device=target,
                    fan=FanCommand.FAN_ON,  # Keep-safe override!
                    alert_level=ResponseLevel.BLOCK,  # LED Merah + Buzzer
                    origin=DirectiveOrigin.KEEP_SAFE,
                    request_id=cmd_req.request_id,
                )
            else:
                # Perintah ilegal (UNAUTHORIZED_COMMAND / MESSAGE_BURST): jangan ubah kipas, bunyikan alarm fisik!
                directive = ActuatorDirective(
                    gateway_seq=self._next_gateway_seq(),
                    target_device=target,
                    fan=None,
                    alert_level=level if level > ResponseLevel.NONE else ResponseLevel.BLOCK,
                    origin=DirectiveOrigin.ALERT_UPDATE,
                    request_id=cmd_req.request_id,
                )

        rec = self.db.append_incident(
            source_identity=requester,
            event_type="COMMAND",
            classification=classification.value,
            response_level=level.value,
            evidence={
                "command_request": cmd_req.model_dump(),
                "allowed": allowed,
                "findings": [f.model_dump() for f in findings],
                "current_temp": current_temp,
            },
        )

        decision = Decision(
            source_identity=requester,
            event_type="COMMAND",
            target_device=target,
            classification=classification,
            level=level,
            action=action,
            findings=findings,
            method_a_alarm=method_a_alarm,
            method_b_alarm=method_b_alarm,
            latency_ms=round((time.perf_counter() - t0) * 1000, 3),
            incident_seq=rec["seq_id"],
        )

        return decision, directive

    def check_heartbeats(self, now: float | None = None) -> list[Decision]:
        t = now if now is not None else time.time()
        findings = self.comm_monitor.check_heartbeats(t)
        decisions: list[Decision] = []

        for f in findings:
            dev = f.evidence.get("device_id", "unknown")
            if not self._is_finding_cooldown(dev, f.code, t):
                classification, level = classify([f])
                rec = self.db.append_incident(
                    source_identity=dev,
                    event_type="HEARTBEAT",
                    classification=classification.value,
                    response_level=level.value,
                    evidence={"finding": f.model_dump()},
                )
                decisions.append(
                    Decision(
                        source_identity=dev,
                        event_type="HEARTBEAT",
                        target_device=dev,
                        classification=classification,
                        level=level,
                        action="ALERT_HEARTBEAT_DROP",
                        findings=[f],
                        incident_seq=rec["seq_id"],
                    )
                )

        return decisions
