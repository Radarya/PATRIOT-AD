"""Skema pesan PATRIOT-AD (Pydantic v2).

Semua pesan dari jaringan divalidasi ketat (``extra="forbid"``, NaN/Inf ditolak,
rentang nilai sesuai batas fisik sensor) sebelum menyentuh mesin deteksi.

Identitas pengirim TIDAK pernah diambil dari payload: identitas berasal dari
segmen terakhir topik MQTT (``patriot/telemetry/<identity>``), yang dijamin oleh
ACL broker hanya dapat ditulis oleh ``username`` yang sama.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_lib
from enum import Enum, IntEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import get_command_hmac_secret

SCHEMA_VERSION = "1.0"
IDENTITY_PATTERN = r"^[a-z0-9_]{1,32}$"

_STRICT_MESSAGE = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class FanState(str, Enum):
    ON = "ON"
    OFF = "OFF"


class FanCommand(str, Enum):
    FAN_ON = "FAN_ON"
    FAN_OFF = "FAN_OFF"

    @property
    def expected_state(self) -> FanState:
        return FanState.ON if self is FanCommand.FAN_ON else FanState.OFF


class Classification(str, Enum):
    """Tingkat bukti (PRD §6.1)."""

    NORMAL = "NORMAL"
    SENSOR_FAULT_SUSPECTED = "SENSOR_FAULT_SUSPECTED"
    TELEMETRY_INTEGRITY_SUSPECTED = "TELEMETRY_INTEGRITY_SUSPECTED"
    SECURITY_INCIDENT_INDICATED = "SECURITY_INCIDENT_INDICATED"
    CONFIRMED_IN_TEST_SCENARIO = "CONFIRMED_IN_TEST_SCENARIO"


class ResponseLevel(IntEnum):
    """Respons bertingkat (PRD §6.2), sekaligus level indikator fisik di ESP32.

    0 = LED Hijau, 1 = LED Kuning, 2 = LED Merah + Buzzer,
    3 = LED Merah + Buzzer + ESP32 dikunci ke mode fail-safe.
    """

    NONE = 0
    WARNING = 1
    BLOCK = 2
    QUARANTINE = 3


class FindingCode(str, Enum):
    # Lapis 1 – komunikasi & kebijakan perintah
    MESSAGE_BURST = "MESSAGE_BURST"
    HEARTBEAT_DROP = "HEARTBEAT_DROP"
    QUARANTINED_SOURCE = "QUARANTINED_SOURCE"
    SCHEMA_INVALID = "SCHEMA_INVALID"
    UNKNOWN_DEVICE = "UNKNOWN_DEVICE"
    IDENTITY_MISMATCH = "IDENTITY_MISMATCH"
    UNAUTHORIZED_COMMAND = "UNAUTHORIZED_COMMAND"
    UNSAFE_COMMAND = "UNSAFE_COMMAND"
    # Lapis 2 – perilaku statistik telemetri
    SEQ_REPLAY = "SEQ_REPLAY"
    TIME_REGRESSION = "TIME_REGRESSION"
    ZSCORE_SPIKE = "ZSCORE_SPIKE"
    DTDT_EXCEEDED = "DTDT_EXCEEDED"
    STALE_TELEMETRY = "STALE_TELEMETRY"
    SENSOR_DISCONNECTED = "SENSOR_DISCONNECTED"
    # Lapis 3 – konsistensi kontrol & bukti fisik
    FAN_NO_CURRENT = "FAN_NO_CURRENT"
    FAN_CURRENT_WHILE_OFF = "FAN_CURRENT_WHILE_OFF"
    STATE_MISMATCH = "STATE_MISMATCH"
    TEMP_RISING_WHILE_FAN_ON = "TEMP_RISING_WHILE_FAN_ON"


# ---------------------------------------------------------------------------
# Pesan jaringan
# ---------------------------------------------------------------------------


class Telemetry(BaseModel):
    """Telemetri dari ESP32 / simulator di ``patriot/telemetry/<device>``.

    ``uptime_ms`` adalah ``millis()`` ESP32 (tanpa RTC/NTP karena offline-first).
    Nilai sensor ``null`` berarti pembacaan gagal (mis. DHT22 belum terbaca).
    """

    model_config = _STRICT_MESSAGE

    schema_version: Literal["1.0"]
    device_id: str = Field(pattern=IDENTITY_PATTERN)
    seq: int = Field(ge=0, le=2**32 - 1)
    uptime_ms: int = Field(ge=0, le=2**32 - 1)
    temperature_c: float | None = Field(default=None, ge=-40.0, le=80.0)
    humidity_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    fan_reported: FanState
    current_ma: float | None = Field(default=None, ge=-100.0, le=1000.0)
    bus_v: float | None = Field(default=None, ge=0.0, le=36.0)
    interlock_active: bool = False
    failsafe_active: bool = False
    sensor_status: Literal["NORMAL", "SENSOR_PUTUS"] | None = "NORMAL"
    boot_id: str | int | None = None


class CommandRequest(BaseModel):
    """Permintaan perintah di ``patriot/request/cmd/<identity>``."""

    model_config = _STRICT_MESSAGE

    schema_version: Literal["1.0"]
    request_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    command: FanCommand
    target_device: str | None = Field(default=None, pattern=IDENTITY_PATTERN)
    reason: str | None = Field(default=None, max_length=200)


class DirectiveOrigin(str, Enum):
    OPERATOR = "OPERATOR"
    KEEP_SAFE = "KEEP_SAFE"
    ALERT_UPDATE = "ALERT_UPDATE"
    RESYNC = "RESYNC"


def compute_directive_hmac(
    gateway_seq: int,
    target_device: str,
    fan: FanCommand | str | None,
    alert_level: ResponseLevel | int,
    origin: DirectiveOrigin | str,
    secret: str | None = None,
) -> str:
    key = (secret or get_command_hmac_secret()).encode("utf-8")
    if isinstance(fan, FanCommand):
        fan_token = fan.value
    elif isinstance(fan, str) and fan in ("FAN_ON", "FAN_OFF"):
        fan_token = fan
    else:
        fan_token = "NONE"
    lvl_int = int(alert_level.value if isinstance(alert_level, ResponseLevel) else alert_level)
    orig_str = origin.value if isinstance(origin, DirectiveOrigin) else str(origin)
    canonical = f"{int(gateway_seq)}:{target_device}:{fan_token}:{lvl_int}:{orig_str}"
    return hmac_lib.new(key, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


class ActuatorDirective(BaseModel):
    """Perintah yang disetujui gateway, dikirim ke ``patriot/approved/cmd/<device>``.

    ``gateway_seq`` naik monoton (berbasis waktu) agar ESP32 dapat menolak replay.
    ``hmac`` adalah tanda tangan HMAC-SHA256 agar ESP32 menolak paket tanpa otorisasi gateway.
    ``fan`` bernilai ``null`` bila directive hanya memperbarui level indikator.
    """

    model_config = ConfigDict(frozen=True)

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    gateway_seq: int = Field(ge=0)
    target_device: str = Field(pattern=IDENTITY_PATTERN)
    fan: FanCommand | None = None
    alert_level: ResponseLevel
    origin: DirectiveOrigin
    request_id: str | None = None
    hmac: str = ""

    @model_validator(mode="before")
    @classmethod
    def _populate_hmac(cls, values: Any) -> Any:
        if isinstance(values, dict) and not values.get("hmac"):
            values = dict(values)
            values["hmac"] = compute_directive_hmac(
                gateway_seq=values.get("gateway_seq", 0),
                target_device=values.get("target_device", "esp32_gudang"),
                fan=values.get("fan"),
                alert_level=values.get("alert_level", 0),
                origin=values.get("origin", "OPERATOR"),
            )
        return values


# ---------------------------------------------------------------------------
# Hasil deteksi
# ---------------------------------------------------------------------------


class Finding(BaseModel):
    model_config = ConfigDict(frozen=True)

    layer: Literal[1, 2, 3]
    code: FindingCode
    detail: str
    evidence: dict[str, Any] = Field(default_factory=dict)


class Decision(BaseModel):
    """Keputusan deterministik untuk satu pesan / satu evaluasi periodik."""

    source_identity: str
    event_type: Literal["TELEMETRY", "COMMAND", "HEARTBEAT", "ADMIN"]
    target_device: str | None = None
    classification: Classification
    level: ResponseLevel
    action: str
    findings: list[Finding] = Field(default_factory=list)
    method_a_alarm: bool = False
    method_b_alarm: bool = False
    latency_ms: float = 0.0
    incident_seq: int | None = None


# ---------------------------------------------------------------------------
# Forensic verifier
# ---------------------------------------------------------------------------


class ChainError(BaseModel):
    seq_id: int | None
    kind: Literal[
        "SEQUENCE_GAP",
        "BROKEN_LINK",
        "HASH_MISMATCH",
        "CHECKPOINT_MISMATCH",
        "MISSING_RECORD",
        "TRUNCATION",
        "CHECKPOINT_CORRUPT",
    ]
    detail: str


class VerifyReport(BaseModel):
    ok: bool
    records_checked: int
    head_seq: int | None
    head_hash: str | None
    checkpoints_checked: int
    errors: list[ChainError] = Field(default_factory=list)
