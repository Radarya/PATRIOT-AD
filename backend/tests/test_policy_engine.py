"""Unit test komprehensif PATRIOT-AD Backend.

Menguji:
1. Hash-Chained Forensic Log & Verifier (PRD §7)
2. Lapis 1: Komunikasi & Safety Gate (PRD §5.1, §6.2)
3. Lapis 2: Statistik Telemetri & Z-Score & Stale (PRD §5.2)
4. Lapis 3: Sensor Arus INA226 & Konsistensi Fisik (PRD §5.3)
5. 5 Skenario Uji Benchmark (SCN-01 s/d SCN-05) (PRD §8.2)
6. REST API Endpoints & Health Check
"""

import json
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from patriot.config import Calibration, Settings
from patriot.engine import PolicyEngine
from patriot.forensic_db import GENESIS_HASH, ForensicDB
from patriot.schemas import (
    Classification,
    CommandRequest,
    FanCommand,
    FanState,
    FindingCode,
    ResponseLevel,
    Telemetry,
)
from patriot.api import app


@pytest.fixture
def test_db(tmp_path: Path) -> ForensicDB:
    db_file = tmp_path / "test_forensic.db"
    cp_file = tmp_path / "test_checkpoints.jsonl"
    return ForensicDB(db_file, cp_file, checkpoint_every=3)


@pytest.fixture
def engine(test_db: ForensicDB) -> PolicyEngine:
    settings = Settings(
        mqtt_enabled=False,
        calibration=Calibration(
            safety_gate_temp_c=32.0,
            interlock_temp_c=33.0,
            method_a_temp_c=34.0,
            fan_active_current_ma=40.0,
            burst_max_messages=5,
            stale_identical_samples=5,
            fan_debounce_samples=1,
            state_mismatch_grace_samples=1,
        ),
    )
    return PolicyEngine(settings, test_db)


# ===========================================================================
# 1. Forensic Hash-Chain & Verifier
# ===========================================================================


def test_forensic_chain_integrity(test_db: ForensicDB):
    # Tambah 5 insiden
    for i in range(1, 6):
        rec = test_db.append_incident(
            source_identity="test_device",
            event_type="TEST",
            classification="NORMAL",
            response_level=0,
            evidence={"sample_id": i},
        )
        assert rec["seq_id"] == i
        if i == 1:
            assert rec["prev_hash"] == GENESIS_HASH

    report = test_db.verify_chain()
    assert report.ok is True
    assert report.records_checked == 5
    assert report.head_seq == 5
    assert report.checkpoints_checked == 1  # Checkpoint di seq 3


def test_forensic_chain_detects_tampering(test_db: ForensicDB):
    for i in range(1, 4):
        test_db.append_incident(
            source_identity="test_device",
            event_type="TEST",
            classification="NORMAL",
            response_level=0,
            evidence={"val": i},
        )

    # Rusak isi database langsung lewat sqlite (simulasi hacker mengubah data)
    test_db._conn.execute(
        "UPDATE incidents SET classification = 'TAMPERED' WHERE seq_id = 2"
    )

    report = test_db.verify_chain()
    assert report.ok is False
    assert any(err.kind == "HASH_MISMATCH" and err.seq_id == 2 for err in report.errors)


# ===========================================================================
# 2. SCN-01: Normal Operation (Pemanasan Alami & Kipas Aktif Normal)
# ===========================================================================


def test_scn_01_normal_telemetry(engine: PolicyEngine):
    t_payload = {
        "schema_version": "1.0",
        "device_id": "esp32_gudang",
        "seq": 1,
        "uptime_ms": 1000,
        "temperature_c": 30.5,
        "humidity_pct": 75.0,
        "fan_reported": "OFF",
        "current_ma": 0.0,
        "bus_v": 5.0,
    }
    decision, directive = engine.process_telemetry("esp32_gudang", json.dumps(t_payload))
    assert decision.classification == Classification.NORMAL
    assert decision.level == ResponseLevel.NONE
    assert decision.method_a_alarm is False
    assert decision.method_b_alarm is False


# ===========================================================================
# 3. SCN-02: Sensor Fault (Lonjakan Ekstrem / Z-Score / dT/dt)
# ===========================================================================


def test_scn_02_sensor_fault_zscore(engine: PolicyEngine):
    # Kirim 10 sampel baseline stabil 30.0 °C
    for s in range(1, 11):
        payload = {
            "schema_version": "1.0",
            "device_id": "esp32_gudang",
            "seq": s,
            "uptime_ms": s * 2000,
            "temperature_c": 30.0,
            "humidity_pct": 75.0,
            "fan_reported": "OFF",
            "current_ma": 0.0,
            "bus_v": 5.0,
        }
        engine.process_telemetry("esp32_gudang", json.dumps(payload), arrival_time_s=s * 2.0)

    # Sampel 11: Sensor melompat tiba-tiba ke 45.0 °C
    spike_payload = {
        "schema_version": "1.0",
        "device_id": "esp32_gudang",
        "seq": 11,
        "uptime_ms": 22000,
        "temperature_c": 45.0,
        "humidity_pct": 75.0,
        "fan_reported": "OFF",
        "current_ma": 0.0,
        "bus_v": 5.0,
    }
    decision, _ = engine.process_telemetry(
        "esp32_gudang", json.dumps(spike_payload), arrival_time_s=22.0
    )
    assert decision.classification == Classification.SENSOR_FAULT_SUSPECTED
    assert decision.level == ResponseLevel.WARNING
    assert any(f.code == FindingCode.ZSCORE_SPIKE for f in decision.findings)


def test_sensor_disconnected_failsafe(engine: PolicyEngine):
    payload = {
        "schema_version": "1.0",
        "device_id": "esp32_gudang",
        "seq": 1,
        "uptime_ms": 2000,
        "temperature_c": None,
        "humidity_pct": None,
        "fan_reported": "ON",
        "current_ma": 80.0,
        "bus_v": 5.0,
        "interlock_active": True,
        "failsafe_active": True,
        "sensor_status": "SENSOR_PUTUS",
    }
    decision, _ = engine.process_telemetry("esp32_gudang", json.dumps(payload))
    assert decision.classification == Classification.SENSOR_FAULT_SUSPECTED
    assert decision.level == ResponseLevel.WARNING
    assert any(f.code == FindingCode.SENSOR_DISCONNECTED for f in decision.findings)


# ===========================================================================
# 4. SCN-03: Kredensial Sah Mengirim FAN_OFF saat Suhu Tinggi (Safety Gate)
# ===========================================================================


def test_scn_03_safety_gate_blocks_unsafe_fan_off(engine: PolicyEngine):
    # Set ekspektasi awal kipas memang sedang aktif (FAN_ON)
    engine.physical_monitor.record_command("esp32_gudang", FanCommand.FAN_ON, 10.0)

    # Simulasikan suhu gudang sedang 32.5 °C (> safety_gate_temp_c 32.0 °C)
    t_payload = {
        "schema_version": "1.0",
        "device_id": "esp32_gudang",
        "seq": 1,
        "uptime_ms": 1000,
        "temperature_c": 32.5,
        "humidity_pct": 75.0,
        "fan_reported": "ON",
        "current_ma": 88.5,
        "bus_v": 5.0,
    }
    engine.process_telemetry("esp32_gudang", json.dumps(t_payload), arrival_time_s=10.0)

    # Operator sah (kredensial valid) mengirim perintah FAN_OFF
    cmd_payload = {
        "schema_version": "1.0",
        "request_id": "req-001",
        "command": "FAN_OFF",
        "target_device": "esp32_gudang",
    }
    decision, directive = engine.process_command_request("operator", json.dumps(cmd_payload), arrival_time_s=11.0)

    # Perintah harus DITAHAN (Safety Gate), kirim keep-safe FAN_ON paksa + Level Merah
    assert decision.action == "BLOCK_OR_HOLD"
    assert decision.level == ResponseLevel.BLOCK
    assert decision.classification == Classification.SECURITY_INCIDENT_INDICATED
    assert any(f.code == FindingCode.UNSAFE_COMMAND for f in decision.findings)

    # Directive harus memuat KEEP_SAFE FAN_ON!
    assert directive is not None
    assert directive.fan == FanCommand.FAN_ON
    assert directive.alert_level == ResponseLevel.BLOCK


# ===========================================================================
# 5. SCN-04: Telemetri Membeku / Replay Stale
# ===========================================================================


def test_scn_04_stale_telemetry_detected(engine: PolicyEngine):
    # Kirim nilai identik persis 5 kali (threshold test: 5)
    decision = None
    for s in range(1, 6):
        payload = {
            "schema_version": "1.0",
            "device_id": "esp32_gudang",
            "seq": s,
            "uptime_ms": s * 2000,
            "temperature_c": 28.50,
            "humidity_pct": 70.0,
            "fan_reported": "OFF",
            "current_ma": 0.0,
            "bus_v": 5.0,
        }
        decision, _ = engine.process_telemetry("esp32_gudang", json.dumps(payload), arrival_time_s=s * 2.0)

    assert decision is not None
    assert decision.classification == Classification.TELEMETRY_INTEGRITY_SUSPECTED
    assert any(f.code == FindingCode.STALE_TELEMETRY for f in decision.findings)


# ===========================================================================
# 6. SCN-05: Message Burst (Banjir Pesan & Karantina Otomatis)
# ===========================================================================


def test_scn_05_message_burst_triggers_quarantine(engine: PolicyEngine):
    # Kirim 7 pesan dalam 1 detik (batas burst_max_messages = 5)
    now = 100.0
    decisions = []
    for s in range(1, 8):
        payload = {
            "schema_version": "1.0",
            "device_id": "esp32_gudang",
            "seq": s,
            "uptime_ms": s * 10,
            "temperature_c": 30.0,
            "humidity_pct": 75.0,
            "fan_reported": "OFF",
            "current_ma": 0.0,
            "bus_v": 5.0,
        }
        dec, _ = engine.process_telemetry(
            "esp32_gudang", json.dumps(payload), arrival_time_s=now + (s * 0.05)
        )
        decisions.append(dec)

    # Pastikan MESSAGE_BURST terpicu
    all_findings = [f.code for d in decisions for f in d.findings]
    assert FindingCode.MESSAGE_BURST in all_findings
    # Pastikan status akhir dikarantina
    assert decisions[-1].level == ResponseLevel.QUARANTINE
    assert engine.comm_monitor.is_quarantined("esp32_gudang") is True


# ===========================================================================
# 7. Bukti Fisik INA226: Kipas Dilaporkan ON tapi Arus 0 mA
# ===========================================================================


def test_ina226_fan_no_current_detected(engine: PolicyEngine):
    payload = {
        "schema_version": "1.0",
        "device_id": "esp32_gudang",
        "seq": 1,
        "uptime_ms": 1000,
        "temperature_c": 30.0,
        "humidity_pct": 75.0,
        "fan_reported": "ON",
        "current_ma": 0.0,  # Arus 0 padahal fan reported ON!
        "bus_v": 5.0,
    }
    decision, _ = engine.process_telemetry("esp32_gudang", json.dumps(payload))
    assert decision.classification == Classification.TELEMETRY_INTEGRITY_SUSPECTED
    assert any(f.code == FindingCode.FAN_NO_CURRENT for f in decision.findings)


# ===========================================================================
# 8. REST API Verification Endpoint
# ===========================================================================


def test_api_health_and_verify():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "HEALTHY"
    assert data["db_ok"] is True

    verify_res = client.get("/api/forensic/verify")
    assert verify_res.status_code == 200
    vdata = verify_res.json()
    assert vdata["ok"] is True


def test_api_command_execution():
    client = TestClient(app)
    op_token = client.post("/api/auth/login", json={"role": "operator"}).json()["token"]
    # 1. Perintah resmi dengan X-Patriot-Token valid
    res = client.post(
        "/api/command",
        headers={"X-Patriot-Token": op_token},
        json={"command": "FAN_ON", "requester": "operator", "target_device": "esp32_gudang"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in ("APPROVE", "BLOCK_AND_HOLD")
    assert "decision" in data
    assert "directive" in data
    assert data["directive"] is not None
    assert len(data["directive"].get("hmac", "")) == 64

    # 2. Pemalsuan identitas "operator" tanpa header X-Patriot-Token harus DITOLAK
    spoof_res = client.post(
        "/api/command",
        json={"command": "FAN_OFF", "requester": "operator", "target_device": "esp32_gudang"},
    )
    assert spoof_res.status_code == 200
    sdata = spoof_res.json()
    assert sdata["status"] == "BLOCK_OR_HOLD"
    assert sdata["decision"]["action"] == "BLOCK_OR_HOLD"
    assert any(f["code"] == "UNAUTHORIZED_COMMAND" for f in sdata["decision"]["findings"])


def test_api_quarantine_and_export():
    client = TestClient(app)
    # Tanpa token harus ditolak (401)
    unauth_res = client.post("/api/quarantine/intruder_test/release")
    assert unauth_res.status_code == 401

    token = client.post("/api/auth/login", json={"role": "admin"}).json()["token"]
    # Test release quarantine dengan token sah
    q_res = client.post(
        "/api/quarantine/intruder_test/release",
        headers={"X-Patriot-Token": token},
    )
    assert q_res.status_code == 200
    assert q_res.json()["status"] == "RELEASED"

    # Test export
    exp_res = client.get("/api/forensic/export")
    assert exp_res.status_code == 200
    export_data = exp_res.json()
    assert "genesis_hash" in export_data
    assert isinstance(export_data["records"], list)

    # Test status
    stat_res = client.get("/api/status")
    assert stat_res.status_code == 200


def test_auth_login_and_config_redaction():
    client = TestClient(app)

    op_res = client.post("/api/auth/login", json={"role": "operator"})
    assert op_res.status_code == 200
    op_data = op_res.json()
    assert op_data["ok"] is True
    assert op_data["role"] == "operator"
    assert op_data["token"]

    bad_res = client.post("/api/auth/login", json={"role": "unauthorized"})
    assert bad_res.status_code == 200
    assert bad_res.json()["ok"] is False
    assert bad_res.json()["token"] == ""

    cfg_res = client.get("/api/config")
    assert cfg_res.status_code == 200
    cfg_settings = cfg_res.json()["settings"]
    for secret_key in ("api_token", "mqtt_password", "command_hmac_secret", "role_tokens"):
        assert secret_key not in cfg_settings


def test_benchmark_scenarios_run_real_detectors():
    client = TestClient(app)
    unauth_res = client.post("/api/benchmark/SCN-02")
    assert unauth_res.status_code == 401

    token = client.post("/api/auth/login", json={"role": "admin"}).json()["token"]
    headers = {"X-Patriot-Token": token}
    expected_findings = {
        "SCN-02": "DTDT_EXCEEDED",
        "SCN-03": "UNSAFE_COMMAND",
        "SCN-04": "STALE_TELEMETRY",
        "SCN-05": "MESSAGE_BURST",
    }
    try:
        for scn_id, expected_code in expected_findings.items():
            res = client.post(f"/api/benchmark/{scn_id}", headers=headers)
            assert res.status_code == 200, f"{scn_id} failed: {res.text}"
            payload = res.json()
            assert "decision" in payload
            findings = payload["decision"].get("findings", [])
            codes = [f.get("code") for f in findings]
            assert expected_code in codes, f"{scn_id} expected {expected_code}, got {codes}"
    finally:
        client.post("/api/benchmark/SCN-01", headers=headers)


def test_boot_id_reboot_resets_sequence(engine: PolicyEngine):
    p1 = Telemetry(
        schema_version="1.0",
        device_id="esp32_gudang",
        boot_id=111,
        seq=50,
        uptime_ms=500_000,
        temperature_c=26.5,
        humidity_pct=55.0,
        fan_reported=FanState.OFF,
        current_ma=0.0,
    ).model_dump_json()
    d1, _ = engine.process_telemetry("esp32_gudang", p1, arrival_time_s=1000.0)
    assert d1.level == ResponseLevel.NONE

    p2 = Telemetry(
        schema_version="1.0",
        device_id="esp32_gudang",
        boot_id=222,
        seq=1,
        uptime_ms=2_000,
        temperature_c=26.6,
        humidity_pct=55.1,
        fan_reported=FanState.OFF,
        current_ma=0.0,
    ).model_dump_json()
    d2, _ = engine.process_telemetry("esp32_gudang", p2, arrival_time_s=1002.0)
    assert d2.findings == []
    assert d2.level == ResponseLevel.NONE

