"""Klasifikasi bukti & level respons berbasis tabel aturan deterministik.

Tidak ada skor numerik arbitrer (PRD §3 "Di Luar Cakupan"). Aturan dievaluasi
berurutan; aturan pertama yang cocok menentukan hasil. Kombinasi temuan dari
lapis berbeda menaikkan tingkat bukti, sesuai PRD §6.1:

1. Banjir pesan / sumber dikarantina          → SECURITY_INCIDENT_INDICATED, Level 3
2. Identitas/perintah tidak sah atau melanggar
   batas keselamatan                           → SECURITY_INCIDENT_INDICATED, Level 2
3. Pesan tidak sesuai skema                    → TELEMETRY_INTEGRITY_SUSPECTED, Level 2 (ditolak)
4. Masalah urutan/waktu/basi/inkonsistensi
   fisik (sendiri atau bersama anomali data)   → TELEMETRY_INTEGRITY_SUSPECTED, Level 1
5. Hanya anomali statistik data                → SENSOR_FAULT_SUSPECTED, Level 1
6. Tidak ada temuan                            → NORMAL, Level 0
"""

from __future__ import annotations

from collections.abc import Iterable

from ..schemas import Classification, Finding, FindingCode, ResponseLevel

QUARANTINE_CODES = frozenset({FindingCode.MESSAGE_BURST, FindingCode.QUARANTINED_SOURCE})
SECURITY_BLOCK_CODES = frozenset(
    {
        FindingCode.UNKNOWN_DEVICE,
        FindingCode.IDENTITY_MISMATCH,
        FindingCode.UNAUTHORIZED_COMMAND,
        FindingCode.UNSAFE_COMMAND,
    }
)
SCHEMA_CODES = frozenset({FindingCode.SCHEMA_INVALID})
INTEGRITY_CODES = frozenset(
    {
        FindingCode.HEARTBEAT_DROP,
        FindingCode.SEQ_REPLAY,
        FindingCode.TIME_REGRESSION,
        FindingCode.STALE_TELEMETRY,
        FindingCode.FAN_NO_CURRENT,
        FindingCode.FAN_CURRENT_WHILE_OFF,
        FindingCode.STATE_MISMATCH,
        FindingCode.TEMP_RISING_WHILE_FAN_ON,
    }
)
STATISTICAL_CODES = frozenset(
    {FindingCode.ZSCORE_SPIKE, FindingCode.DTDT_EXCEEDED, FindingCode.SENSOR_DISCONNECTED}
)

#: Temuan yang membuat suhu dari perangkat tidak layak dipercaya untuk Safety Gate.
UNTRUSTED_TELEMETRY_CODES = (
    INTEGRITY_CODES
    | QUARANTINE_CODES
    | frozenset(
        {
            FindingCode.UNKNOWN_DEVICE,
            FindingCode.IDENTITY_MISMATCH,
            FindingCode.SENSOR_DISCONNECTED,
        }
    )
)


def classify(findings: Iterable[Finding]) -> tuple[Classification, ResponseLevel]:
    codes = {f.code for f in findings}
    if codes & QUARANTINE_CODES:
        return Classification.SECURITY_INCIDENT_INDICATED, ResponseLevel.QUARANTINE
    if codes & SECURITY_BLOCK_CODES:
        return Classification.SECURITY_INCIDENT_INDICATED, ResponseLevel.BLOCK
    if codes & SCHEMA_CODES:
        return Classification.TELEMETRY_INTEGRITY_SUSPECTED, ResponseLevel.BLOCK
    if codes & INTEGRITY_CODES:
        return Classification.TELEMETRY_INTEGRITY_SUSPECTED, ResponseLevel.WARNING
    if codes & STATISTICAL_CODES:
        return Classification.SENSOR_FAULT_SUSPECTED, ResponseLevel.WARNING
    return Classification.NORMAL, ResponseLevel.NONE


def finding_level(finding: Finding) -> ResponseLevel:
    return classify([finding])[1]
