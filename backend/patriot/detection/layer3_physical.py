"""Lapis 3: Konsistensi Kontrol dan Bukti Fisik (PRD §5.3).

Membandingkan secara kontinu:
1. `command_state`: Perintah terakhir yang disetujui gateway (FAN_ON / FAN_OFF).
2. `reported_state`: Status kipas yang dilaporkan ESP32 (t.fan_reported).
3. `physical_proof` (Bukti fisik independen):
   - Sensor arus INA226:
     * Kipas ON normal: arus ~60–110 mA (> fan_active_current_ma, 40 mA).
     * Kipas OFF: arus ~0 mA (< fan_active_current_ma).
   - Respon suhu DHT22:
     * Jika kipas ON terus-menerus selama > 25 detik, suhu seharusnya stabil atau turun.
     * Jika suhu naik >= 1.0 °C, deteksi anomali respon termal.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

from ..config import Calibration
from ..schemas import FanCommand, FanState, Finding, FindingCode, Telemetry


@dataclass
class DevicePhysicalState:
    expected_command: FanCommand = FanCommand.FAN_ON
    last_command_time_s: float | None = None
    state_mismatch_counter: int = 0
    no_current_counter: int = 0
    current_while_off_counter: int = 0

    # Pelacak respon suhu saat kipas aktif
    fan_on_start_time_s: float | None = None
    fan_on_start_temp_c: float | None = None


class PhysicalConsistencyMonitor:
    def __init__(self, cal: Calibration) -> None:
        self.cal = cal
        self._states: dict[str, DevicePhysicalState] = {}

    def get_state(self, device_id: str) -> DevicePhysicalState:
        if device_id not in self._states:
            self._states[device_id] = DevicePhysicalState()
        return self._states[device_id]

    def record_command(self, device_id: str, command: FanCommand, timestamp_s: float) -> None:
        st = self.get_state(device_id)
        st.expected_command = command
        st.last_command_time_s = timestamp_s
        # Reset counters on new command
        st.state_mismatch_counter = 0

    def evaluate(self, t: Telemetry, arrival_time_s: float) -> list[Finding]:
        st = self.get_state(t.device_id)
        findings: list[Finding] = []

        # Sinkronisasi ekspektasi awal sebelum ada perintah eksplisit dari gateway
        if st.last_command_time_s is None:
            st.expected_command = (
                FanCommand.FAN_ON if t.fan_reported == FanState.ON else FanCommand.FAN_OFF
            )

        expected_fan_state = st.expected_command.expected_state
        has_current_sensor = t.current_ma is not None

        # 1. Cek Kesesuaian Status (State Mismatch)
        # Jika ESP32 melaporkan interlock mandiri aktif, status ON dianggap sah dari interlock lokal
        if t.interlock_active and t.fan_reported == FanState.ON:
            st.state_mismatch_counter = 0
        elif t.fan_reported != expected_fan_state:
            st.state_mismatch_counter += 1
            if st.state_mismatch_counter >= self.cal.state_mismatch_grace_samples:
                findings.append(
                    Finding(
                        layer=3,
                        code=FindingCode.STATE_MISMATCH,
                        detail=(
                            f"Status aktuator tidak sesuai perintah gateway: diharapkan={expected_fan_state.value}, "
                            f"dilaporkan={t.fan_reported.value} selama {st.state_mismatch_counter} sampel berturut-turut."
                        ),
                        evidence={
                            "expected": expected_fan_state.value,
                            "reported": t.fan_reported.value,
                            "counter": st.state_mismatch_counter,
                        },
                    )
                )
        else:
            st.state_mismatch_counter = 0

        # 2. Bukti Fisik Sensor Arus INA226
        if has_current_sensor:
            current = t.current_ma or 0.0
            is_drawing_current = current >= self.cal.fan_active_current_ma

            # Kasus A: Kipas seharusnya/dilaporkan ON, tetapi arus ~0 mA (kabel putus, kipas macet, relay gagal)
            if t.fan_reported == FanState.ON or expected_fan_state == FanState.ON:
                if not is_drawing_current:
                    st.no_current_counter += 1
                    if st.no_current_counter >= self.cal.fan_debounce_samples:
                        findings.append(
                            Finding(
                                layer=3,
                                code=FindingCode.FAN_NO_CURRENT,
                                detail=(
                                    f"Kegagalan fisik Kipas (INA226): Kipas berstatus ON, tetapi arus hanya "
                                    f"{current:.2f} mA (ambang batas aktif >= {self.cal.fan_active_current_ma} mA)."
                                ),
                                evidence={
                                    "fan_reported": t.fan_reported.value,
                                    "current_ma": current,
                                    "threshold_ma": self.cal.fan_active_current_ma,
                                    "counter": st.no_current_counter,
                                },
                            )
                        )
                else:
                    st.no_current_counter = 0
            else:
                st.no_current_counter = 0

            # Kasus B: Kipas OFF, tetapi arus terdeteksi mengalir (short circuit atau kipas berputar liar)
            if t.fan_reported == FanState.OFF and expected_fan_state == FanState.OFF:
                if is_drawing_current:
                    st.current_while_off_counter += 1
                    if st.current_while_off_counter >= self.cal.fan_debounce_samples:
                        findings.append(
                            Finding(
                                layer=3,
                                code=FindingCode.FAN_CURRENT_WHILE_OFF,
                                detail=(
                                    f"Anomali arus INA226: Kipas berstatus OFF, tetapi terdeteksi arus "
                                    f"{current:.2f} mA mengalir ke jalur 5V."
                                ),
                                evidence={
                                    "current_ma": current,
                                    "threshold_ma": self.cal.fan_active_current_ma,
                                    "counter": st.current_while_off_counter,
                                },
                            )
                        )
                else:
                    st.current_while_off_counter = 0
            else:
                st.current_while_off_counter = 0

        # 3. Respon Termal saat Kipas Berputar (DHT22)
        if t.fan_reported == FanState.ON and t.temperature_c is not None:
            if st.fan_on_start_time_s is None:
                st.fan_on_start_time_s = arrival_time_s
                st.fan_on_start_temp_c = t.temperature_c
            else:
                elapsed_s = arrival_time_s - st.fan_on_start_time_s
                if (
                    elapsed_s >= self.cal.temp_response_window_s
                    and st.fan_on_start_temp_c is not None
                ):
                    temp_diff = t.temperature_c - st.fan_on_start_temp_c
                    if temp_diff >= self.cal.temp_response_rise_c:
                        findings.append(
                            Finding(
                                layer=3,
                                code=FindingCode.TEMP_RISING_WHILE_FAN_ON,
                                detail=(
                                    f"Anomali respon pendinginan: Kipas aktif selama {elapsed_s:.1f}s, "
                                    f"tetapi suhu tetap naik {temp_diff:+.1f}°C (dari {st.fan_on_start_temp_c:.1f}°C "
                                    f"ke {t.temperature_c:.1f}°C)."
                                ),
                                evidence={
                                    "elapsed_s": round(elapsed_s, 1),
                                    "start_temp_c": st.fan_on_start_temp_c,
                                    "current_temp_c": t.temperature_c,
                                    "diff_c": round(temp_diff, 2),
                                },
                            )
                        )
                    # Geser jendela pembanding agar saat suhu kembali stabil/turun, status anomali pulih wajar
                    st.fan_on_start_time_s = arrival_time_s
                    st.fan_on_start_temp_c = t.temperature_c
                elif st.fan_on_start_temp_c is not None and t.temperature_c < st.fan_on_start_temp_c:
                    # Suhu menurun (pendinginan bekerja efektif) -> perbarui acuan suhu terendah
                    st.fan_on_start_temp_c = t.temperature_c
        else:
            st.fan_on_start_time_s = None
            st.fan_on_start_temp_c = None

        return findings
