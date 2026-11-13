"""Konfigurasi terpusat PATRIOT-AD.

Semua parameter kalibrasi testbed (PRD §5.4) dikumpulkan di sini agar dapat
diubah tanpa menyentuh logika deteksi. Nilai dapat ditimpa lewat environment
variable atau file ``backend/.env``:

- ``PATRIOT_<NAMA_FIELD>``       untuk field :class:`Settings`
- ``PATRIOT_CAL_<NAMA_FIELD>``   untuk field :class:`Calibration`

Contoh: ``PATRIOT_MQTT_HOST=192.168.1.10`` atau ``PATRIOT_CAL_SAFETY_GATE_TEMP_C=32.5``.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
SETTINGS_PREFIX = "PATRIOT_"
CALIBRATION_PREFIX = "PATRIOT_CAL_"

# Field bertipe koleksi yang di environment ditulis sebagai daftar dipisah koma.
_CSV_FIELDS = {"telemetry_devices", "cors_origins"}


class Calibration(BaseModel):
    """Parameter kalibrasi testbed (PRD §5.4).

    Ambang suhu disesuaikan dengan baseline ruangan hasil uji DHT22 aktual
    (29,3–31,1 °C pada 30–31 Okt 2026). Ambang PRD awal 30/31 °C berada di bawah
    suhu ruangan sehingga kipas akan menyala terus dan setiap ``FAN_OFF`` akan
    ditahan. Selisih antar-ambang (+1 °C interlock, +2 °C Metode A) dipertahankan.
    """

    model_config = ConfigDict(frozen=True)

    # --- Lapis 1: komunikasi ---
    telemetry_period_s: float = Field(default=2.0, gt=0)
    heartbeat_timeout_s: float = Field(default=5.0, gt=0)
    burst_window_s: float = Field(default=1.0, gt=0)
    burst_max_messages: int = Field(default=10, ge=1)

    # --- Lapis 2: perilaku statistik telemetri ---
    zscore_window: int = Field(default=20, ge=3)
    zscore_min_samples: int = Field(default=10, ge=3)
    zscore_limit: float = Field(default=5.0, gt=0)
    zscore_std_floor: float = Field(default=0.1, gt=0)
    dtdt_limit_c_per_s: float = Field(default=1.5, gt=0)
    stale_identical_samples: int = Field(default=15, ge=2)
    reboot_max_seq: int = Field(default=30, ge=0)
    reboot_max_uptime_ms: int = Field(default=120_000, ge=0)

    # --- Lapis 3: konsistensi kontrol & bukti fisik ---
    safety_gate_temp_c: float = 32.0
    interlock_temp_c: float = 33.0
    method_a_temp_c: float = 34.0
    fan_active_current_ma: float = Field(default=40.0, gt=0)
    fan_debounce_samples: int = Field(default=2, ge=1)
    state_mismatch_grace_samples: int = Field(default=3, ge=1)
    temp_response_window_s: float = Field(default=25.0, gt=0)
    temp_response_rise_c: float = Field(default=1.0, gt=0)

    # --- Manajemen insiden & indikator ---
    finding_cooldown_s: float = Field(default=30.0, ge=0)
    alert_hold_s: float = Field(default=30.0, ge=0)


def _read_env_file(path: Path) -> dict[str, str]:
    """Parser ``.env`` minimal (KEY=VALUE, komentar ``#``). Tidak menimpa env asli."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


_EPHEMERAL_SECRETS: dict[str, str] = {}


def _ephemeral_secret(name: str, nbytes: int = 24) -> str:
    """Kunci sementara per-proses saat .env belum dibuat (menghindari literal rahasia di repo)."""
    val = _EPHEMERAL_SECRETS.get(name)
    if val is None:
        val = secrets.token_hex(nbytes)
        _EPHEMERAL_SECRETS[name] = val
    return val


def _env_val(key: str, default: str = "") -> str:
    """Ambil nilai konfigurasi dari os.environ, lalu backend/.env, lalu default."""
    return os.environ.get(key) or _read_env_file(ENV_FILE).get(key) or default


def get_command_hmac_secret() -> str:
    """Ambil secret HMAC-SHA256 dari env/.env atau kunci ephemeral per-proses."""
    return _env_val("PATRIOT_COMMAND_HMAC_SECRET") or _ephemeral_secret("hmac", 32)


def _default_permissions() -> dict[str, frozenset[str]]:
    return {
        "operator": frozenset({"FAN_ON", "FAN_OFF"}),
        "admin": frozenset({"FAN_ON", "FAN_OFF"}),
        "dashboard": frozenset({"FAN_ON", "FAN_OFF"}),
        "technician": frozenset({"FAN_ON"}),
    }


def _default_role_tokens() -> dict[str, str]:
    tokens: dict[str, str] = {}
    op_tok = _env_val("PATRIOT_TOKEN_OPERATOR") or _ephemeral_secret("role_operator", 16)
    adm_tok = _env_val("PATRIOT_TOKEN_ADMIN") or _ephemeral_secret("role_admin", 16)
    dash_tok = _env_val("PATRIOT_TOKEN_DASHBOARD") or _ephemeral_secret("role_dashboard", 16)
    tokens[op_tok] = "operator"
    tokens[adm_tok] = "admin"
    tokens[dash_tok] = "dashboard"
    return tokens


class Settings(BaseModel):
    """Pengaturan runtime gateway."""

    model_config = ConfigDict(frozen=True)

    mqtt_enabled: bool = True
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_username: str = "patriot_gateway"
    mqtt_password: str = Field(default_factory=lambda: _env_val("PATRIOT_MQTT_PASSWORD", ""))
    mqtt_client_id: str = "patriot-gateway"
    mqtt_keepalive_s: int = Field(default=15, ge=5)

    db_path: Path = BACKEND_DIR / "data" / "forensic.db"
    checkpoint_path: Path = BACKEND_DIR / "data" / "checkpoints.jsonl"
    checkpoint_every: int = Field(default=25, ge=1)

    telemetry_devices: frozenset[str] = frozenset({"esp32_gudang", "simulator"})
    default_actuator: str = "esp32_gudang"
    command_permissions: dict[str, frozenset[str]] = Field(default_factory=_default_permissions)

    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )
    api_token: str = Field(default_factory=lambda: _env_val("PATRIOT_API_TOKEN") or _ephemeral_secret("api_token", 16))
    command_hmac_secret: str = Field(default_factory=get_command_hmac_secret)
    role_tokens: dict[str, str] = Field(default_factory=_default_role_tokens)

    calibration: Calibration = Field(default_factory=Calibration)


def _collect(fields: dict[str, Any], prefix: str, env: dict[str, str]) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    for name in fields:
        raw = env.get(f"{prefix}{name.upper()}")
        if raw is None:
            continue
        if name in _CSV_FIELDS:
            overrides[name] = [item.strip() for item in raw.split(",") if item.strip()]
        else:
            overrides[name] = raw
    return overrides


def load_settings(env_file: Path | None = ENV_FILE, **overrides: Any) -> Settings:
    """Bangun :class:`Settings` dari default ← ``.env`` ← environment ← argumen."""
    env: dict[str, str] = {}
    if env_file is not None:
        env.update(_read_env_file(env_file))
    env.update(os.environ)

    calibration = Calibration.model_validate(
        _collect(Calibration.model_fields, CALIBRATION_PREFIX, env)
    )
    data = _collect(
        {k: v for k, v in Settings.model_fields.items() if k != "calibration"},
        SETTINGS_PREFIX,
        env,
    )
    data["calibration"] = calibration
    data.update(overrides)
    return Settings.model_validate(data)
