"""Lapis 1: Komunikasi & Kebijakan Perintah (PRD §5.1 & §6.2).

Memantau:
1. Otorisasi perintah berdasarkan role/username broker.
2. Safety Gate: menahan perintah FAN_OFF jika suhu lingkungan melebihi ambang batas keselamatan.
3. Interval pesan: deteksi Message Burst (> N pesan per detik) dan karantina pengirim.
4. Heartbeat Drop: perangkat sensor tidak mengirim telemetri lebih dari ambang batas waktu.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any

from ..config import Calibration, Settings
from ..schemas import (
    CommandRequest,
    DirectiveOrigin,
    FanCommand,
    Finding,
    FindingCode,
    ResponseLevel,
    Telemetry,
)


class CommunicationMonitor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.cal: Calibration = settings.calibration
        # Device tracking: device_id -> float (monotonic timestamp)
        self._last_telemetry_time: dict[str, float] = {}
        # Message burst tracking: identity -> deque of timestamps
        self._msg_history: dict[str, deque[float]] = defaultdict(deque)
        # Quarantined identities: identity -> timestamp quarantine started
        self._quarantined: dict[str, float] = {}

    def is_quarantined(self, identity: str) -> bool:
        return identity in self._quarantined

    def quarantine(self, identity: str) -> None:
        self._quarantined[identity] = time.monotonic()

    def unquarantine(self, identity: str) -> None:
        self._quarantined.pop(identity, None)

    def check_message_burst(self, identity: str, now: float | None = None) -> list[Finding]:
        """Periksa apakah suatu identitas mengirim pesan terlalu rapat (message burst)."""
        t = now if now is not None else time.monotonic()
        findings: list[Finding] = []

        if self.is_quarantined(identity):
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.QUARANTINED_SOURCE,
                    detail=f"Identitas '{identity}' berada dalam daftar karantina.",
                    evidence={"identity": identity},
                )
            )
            return findings

        history = self._msg_history[identity]
        history.append(t)
        window = self.cal.burst_window_s
        while history and history[0] < t - window:
            history.popleft()

        if len(history) > self.cal.burst_max_messages:
            self.quarantine(identity)
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.MESSAGE_BURST,
                    detail=(
                        f"Message burst dari '{identity}': {len(history)} pesan "
                        f"dalam {window:.1f} detik (batas {self.cal.burst_max_messages})."
                    ),
                    evidence={
                        "identity": identity,
                        "count": len(history),
                        "window_s": window,
                        "limit": self.cal.burst_max_messages,
                    },
                )
            )

        return findings

    def check_telemetry_source(self, topic_identity: str, payload: Telemetry) -> list[Finding]:
        """Validasi bahwa identitas di topik dan payload konsisten serta terdaftar."""
        findings: list[Finding] = []

        if topic_identity not in self.settings.telemetry_devices:
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.UNKNOWN_DEVICE,
                    detail=f"Perangkat telemetri '{topic_identity}' tidak terdaftar.",
                    evidence={"topic_identity": topic_identity},
                )
            )

        if payload.device_id != topic_identity:
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.IDENTITY_MISMATCH,
                    detail=(
                        f"Mismatch identitas: topik='{topic_identity}', "
                        f"payload device_id='{payload.device_id}'."
                    ),
                    evidence={
                        "topic_identity": topic_identity,
                        "payload_device_id": payload.device_id,
                    },
                )
            )

        return findings

    def record_telemetry_time(self, device_id: str, now: float | None = None) -> None:
        self._last_telemetry_time[device_id] = now if now is not None else time.monotonic()

    def check_heartbeats(self, now: float | None = None) -> list[Finding]:
        """Cek apakah ada perangkat terdaftar yang mengalami timeout pengiriman data."""
        t = now if now is not None else time.monotonic()
        findings: list[Finding] = []
        timeout = self.cal.heartbeat_timeout_s

        for dev in self.settings.telemetry_devices:
            last = self._last_telemetry_time.get(dev)
            if last is not None and (t - last) > timeout:
                findings.append(
                    Finding(
                        layer=1,
                        code=FindingCode.HEARTBEAT_DROP,
                        detail=f"Perangkat '{dev}' tidak mengirim telemetri selama {t - last:.1f}s (batas {timeout:.1f}s).",
                        evidence={"device_id": dev, "elapsed_s": round(t - last, 2), "timeout_s": timeout},
                    )
                )

        return findings

    def check_command_policy(
        self,
        requester: str,
        cmd: CommandRequest,
        latest_temp_c: float | None,
        is_temp_trusted: bool = True,
    ) -> tuple[list[Finding], bool]:
        """Evaluasi izin perintah dan gerbang keselamatan (Safety Gate).

        Mengembalikan (findings, allowed).
        Jika allowed == False, perintah TIDAK boleh diteruskan ke aktuator.
        """
        findings: list[Finding] = []

        # 1. Cek karantina
        if self.is_quarantined(requester):
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.QUARANTINED_SOURCE,
                    detail=f"Permintaan perintah ditolak: '{requester}' sedang dikarantina.",
                    evidence={"requester": requester, "command": cmd.command.value},
                )
            )
            return findings, False

        # 2. Cek izin perintah
        allowed_cmds = self.settings.command_permissions.get(requester)
        if allowed_cmds is None or cmd.command.value not in allowed_cmds:
            findings.append(
                Finding(
                    layer=1,
                    code=FindingCode.UNAUTHORIZED_COMMAND,
                    detail=f"Identitas '{requester}' tidak berhak mengeksekusi {cmd.command.value}.",
                    evidence={
                        "requester": requester,
                        "command": cmd.command.value,
                        "allowed": list(allowed_cmds) if allowed_cmds else [],
                    },
                )
            )
            return findings, False

        # 3. Safety Gate: jika perintah FAN_OFF
        if cmd.command == FanCommand.FAN_OFF:
            threshold = self.cal.safety_gate_temp_c
            if latest_temp_c is not None and (latest_temp_c > threshold or not is_temp_trusted):
                reason = (
                    f"suhu saat ini {latest_temp_c:.1f}°C > ambang batas {threshold:.1f}°C"
                    if (latest_temp_c > threshold)
                    else "integritas telemetri suhu sedang tidak terpercaya (fail-safe)"
                )
                findings.append(
                    Finding(
                        layer=1,
                        code=FindingCode.UNSAFE_COMMAND,
                        detail=f"Safety Gate: Perintah FAN_OFF dari '{requester}' ditahan karena {reason}.",
                        evidence={
                            "requester": requester,
                            "command": cmd.command.value,
                            "temperature_c": latest_temp_c,
                            "threshold_c": threshold,
                            "is_temp_trusted": is_temp_trusted,
                        },
                    )
                )
                return findings, False

        return findings, True
