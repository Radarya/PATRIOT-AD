"""Lapis 2: Perilaku Statistik Telemetri (PRD §5.2).

Memantau:
1. Urutan pesan (seq monoton naik, deteksi SEQ_REPLAY / rollback).
2. Uptime monoton naik (deteksi TIME_REGRESSION tanpa reboot wajar).
3. Deteksi lonjakan ekstrem via Z-Score pada jendela geser W=20:
   Z = |T_now - mean_W| / max(std_W, 0.1)
4. Laju perubahan suhu (dT/dt) > 1.5 °C/detik.
5. Deteksi telemetri beku/stale (nilai identik konstan selama 15 sampel).
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from ..config import Calibration
from ..schemas import Finding, FindingCode, Telemetry


@dataclass
class DeviceBehaviorState:
    last_seq: int | None = None
    last_uptime_ms: int | None = None
    last_timestamp_s: float | None = None
    last_temp_c: float | None = None
    last_boot_id: str | int | None = None

    # Sliding window untuk suhu: deque berisi float
    temp_window: deque[float] = field(default_factory=deque)

    # Pelacak nilai identik (stale detection)
    identical_temp_count: int = 0
    last_identical_value: float | None = None
    last_identical_humidity: float | None = None
    last_identical_current: float | None = None


@dataclass
class BehaviorResult:
    findings: list[Finding]
    z_score: float | None = None
    dtdt_c_per_s: float | None = None
    is_stale: bool = False


class TelemetryBehaviorMonitor:
    def __init__(self, cal: Calibration) -> None:
        self.cal = cal
        self._states: dict[str, DeviceBehaviorState] = {}

    def get_state(self, device_id: str) -> DeviceBehaviorState:
        if device_id not in self._states:
            self._states[device_id] = DeviceBehaviorState(
                temp_window=deque(maxlen=self.cal.zscore_window)
            )
        return self._states[device_id]

    def evaluate(self, t: Telemetry, arrival_time_s: float) -> BehaviorResult:
        state = self.get_state(t.device_id)
        findings: list[Finding] = []
        z_score_val: float | None = None
        dtdt_val: float | None = None

        # 1. Cek Reboot / Rekoneksi Perangkat vs Time Regression & Seq Replay
        is_reboot = False
        boot_changed = (
            t.boot_id is not None
            and state.last_boot_id is not None
            and str(t.boot_id) != str(state.last_boot_id)
        )
        if boot_changed:
            is_reboot = True
            state.temp_window.clear()
            state.last_temp_c = None
            state.last_timestamp_s = None
            state.identical_temp_count = 0
            state.last_identical_value = None
            state.last_identical_humidity = None
            state.last_identical_current = None
        elif state.last_uptime_ms is not None:
            # Jika uptime mundur tapi nilainya dalam batas rekoneksi/reboot wajar, atau transisi dari seq sintetis
            if (
                t.uptime_ms < state.last_uptime_ms
                and (
                    (t.uptime_ms <= self.cal.reboot_max_uptime_ms and t.seq <= self.cal.reboot_max_seq)
                    or (state.last_seq is not None and state.last_seq > 100_000 and t.seq < 100_000)
                )
            ):
                is_reboot = True
                # Reset tracking window & baseline suhu setelah reboot/rekoneksi agar tidak memicu dT/dt palsu
                state.temp_window.clear()
                state.last_temp_c = None
                state.last_timestamp_s = None
                state.identical_temp_count = 0
                state.last_identical_value = None
                state.last_identical_humidity = None
                state.last_identical_current = None
            elif t.uptime_ms < state.last_uptime_ms:
                findings.append(
                    Finding(
                        layer=2,
                        code=FindingCode.TIME_REGRESSION,
                        detail=(
                            f"Uptime mundur tanpa indikasi reboot: sebelum={state.last_uptime_ms}ms, "
                            f"sekarang={t.uptime_ms}ms."
                        ),
                        evidence={
                            "prev_uptime_ms": state.last_uptime_ms,
                            "current_uptime_ms": t.uptime_ms,
                        },
                    )
                )

        if not is_reboot and state.last_seq is not None:
            if t.seq <= state.last_seq:
                findings.append(
                    Finding(
                        layer=2,
                        code=FindingCode.SEQ_REPLAY,
                        detail=f"Deteksi nomor urut berulang atau mundur: sebelum={state.last_seq}, sekarang={t.seq}.",
                        evidence={"prev_seq": state.last_seq, "current_seq": t.seq},
                    )
                )

        # 2. Status Sensor DHT22 (Deteksi Fail-Safe Kabel Putus / Rusak)
        if t.sensor_status == "SENSOR_PUTUS" or (t.temperature_c is None and t.failsafe_active):
            findings.append(
                Finding(
                    layer=2,
                    code=FindingCode.SENSOR_DISCONNECTED,
                    detail="Sensor suhu DHT22 terputus atau gagal dibaca berturut-turut. Maket fisik masuk mode fail-safe (kipas dipaksa menyala).",
                    evidence={
                        "sensor_status": t.sensor_status or "SENSOR_PUTUS",
                        "failsafe_active": t.failsafe_active,
                        "temperature_c": t.temperature_c,
                    },
                )
            )

        # 3. Statistik Suhu (jika sensor suhu terbaca / tidak None)
        if t.temperature_c is not None:
            curr_temp = t.temperature_c

            # A. Laju Perubahan Suhu (dT/dt)
            if state.last_temp_c is not None and state.last_timestamp_s is not None:
                dt = arrival_time_s - state.last_timestamp_s
                if dt > 0.05:  # minimal 50ms untuk hindari division by zero
                    dT = abs(curr_temp - state.last_temp_c)
                    dtdt_val = round(dT / dt, 3)
                    if dtdt_val > self.cal.dtdt_limit_c_per_s:
                        findings.append(
                            Finding(
                                layer=2,
                                code=FindingCode.DTDT_EXCEEDED,
                                detail=(
                                    f"Laju perubahan suhu ekstrem dT/dt={dtdt_val:.2f}°C/s melebihi batas "
                                    f"{self.cal.dtdt_limit_c_per_s:.2f}°C/s (dT={dT:.2f}°C dalam {dt:.2f}s)."
                                ),
                                evidence={
                                    "dT": dT,
                                    "dt_s": round(dt, 2),
                                    "rate": dtdt_val,
                                    "limit": self.cal.dtdt_limit_c_per_s,
                                },
                            )
                        )

            # B. Z-Score pada Sliding Window
            if len(state.temp_window) >= self.cal.zscore_min_samples:
                window_list = list(state.temp_window)
                mean = sum(window_list) / len(window_list)
                variance = sum((x - mean) ** 2 for x in window_list) / len(window_list)
                std = math.sqrt(variance)
                effective_std = max(std, self.cal.zscore_std_floor)
                z_score_val = round(abs(curr_temp - mean) / effective_std, 2)

                if z_score_val > self.cal.zscore_limit:
                    findings.append(
                        Finding(
                            layer=2,
                            code=FindingCode.ZSCORE_SPIKE,
                            detail=(
                                f"Lonjakan Z-Score={z_score_val} (mean={mean:.2f}°C, std={std:.2f}°C, "
                                f"val={curr_temp:.2f}°C) melebihi batas {self.cal.zscore_limit}."
                            ),
                            evidence={
                                "z_score": z_score_val,
                                "mean": round(mean, 2),
                                "std": round(std, 2),
                                "val": curr_temp,
                                "limit": self.cal.zscore_limit,
                            },
                        )
                    )

            # Masukkan sampel ke sliding window
            state.temp_window.append(curr_temp)

            # C. Deteksi Telemetri Membeku / Basi (Stale)
            # Hanya dianggap membeku/replay jika suhu DAN sinyal analog lainnya (kelembapan & arus)
            # benar-benar identik statis tanpa jitter alami sensor fisik.
            same_temp = state.last_identical_value is not None and math.isclose(
                curr_temp, state.last_identical_value, abs_tol=0.001
            )
            same_hum = (
                t.humidity_pct == state.last_identical_humidity
                if (t.humidity_pct is None or state.last_identical_humidity is None)
                else math.isclose(t.humidity_pct, state.last_identical_humidity, abs_tol=0.001)
            )
            same_cur = (
                t.current_ma == state.last_identical_current
                if (t.current_ma is None or state.last_identical_current is None)
                else math.isclose(t.current_ma, state.last_identical_current, abs_tol=0.001)
            )

            if same_temp and same_hum and same_cur:
                state.identical_temp_count += 1
            else:
                state.identical_temp_count = 1
                state.last_identical_value = curr_temp
                state.last_identical_humidity = t.humidity_pct
                state.last_identical_current = t.current_ma

            # Jika sensor arus INA226 tidak terpasang (current_ma is None), hanya ada 2 kanal
            # kuantisasi 0.1°C yang wajar konstan di ruang tenang -> gunakan ambang longgar 300 sampel.
            # Jika semua sensor aktif, gunakan ambang ketat stale_identical_samples (15 sampel).
            effective_stale_threshold = (
                max(self.cal.stale_identical_samples * 20, 300)
                if t.current_ma is None
                else self.cal.stale_identical_samples
            )
            is_stale = state.identical_temp_count >= effective_stale_threshold
            if is_stale:
                findings.append(
                    Finding(
                        layer=2,
                        code=FindingCode.STALE_TELEMETRY,
                        detail=(
                            f"Telemetri dicurigai basi/replay: nilai suhu konstan persis {curr_temp:.2f}°C "
                            f"selama {state.identical_temp_count} sampel berturut-turut."
                        ),
                        evidence={
                            "stale_value": curr_temp,
                            "count": state.identical_temp_count,
                            "threshold": effective_stale_threshold,
                        },
                    )
                )
        else:
            is_stale = False

        # Perbarui state
        state.last_seq = t.seq
        state.last_uptime_ms = t.uptime_ms
        state.last_timestamp_s = arrival_time_s
        if t.boot_id is not None:
            state.last_boot_id = t.boot_id
        if t.temperature_c is not None:
            state.last_temp_c = t.temperature_c

        return BehaviorResult(
            findings=findings,
            z_score=z_score_val,
            dtdt_c_per_s=dtdt_val,
            is_stale=is_stale,
        )
