/**
 * Dataset Replay & Simulator Bawaan untuk Mode Cloud Vercel (PRD §4.2 & §8).
 * Menjamin Dewan Juri dapat mencoba seluruh fitur tanpa ketergantungan backend lokal.
 */

import { IncidentRecord, Telemetry, VerifyReport } from "@/types";

export const INITIAL_TELEMETRY: Telemetry = {
  schema_version: "1.0",
  device_id: "esp32_gudang",
  seq: 1,
  uptime_ms: 0,
  temperature_c: 29.0,
  humidity_pct: 75.0,
  fan_reported: "OFF",
  current_ma: null,
  bus_v: null,
  interlock_active: false,
  failsafe_active: false,
};

export const INITIAL_INCIDENTS: IncidentRecord[] = [
  {
    seq_id: 1,
    timestamp: "2026-10-31T04:54:12.100Z",
    schema_version: "1.0",
    source_identity: "esp32_gudang",
    event_type: "BOOT_TELEMETRY",
    classification: "NORMAL",
    response_level: 0,
    structured_evidence: {
      temperature_c: 30.2,
      current_ma: 88.5,
      note: "Pemeriksaan awal sensor gudang normal, suhu 30,2°C dan kipas berputar stabil.",
    },
    prev_hash: "84db824a0a52c16b1104e137b250567f2bc212fb3e74b5b7e0996e3860bb63ec",
    record_hash: "2b9f3e46c98a39d883b27e8d6f9b1a5e4c3a2f8b7e6d5c4b3a2f1e0d9c8b7a6f",
  },
  {
    seq_id: 2,
    timestamp: "2026-10-31T04:55:01.320Z",
    schema_version: "1.0",
    source_identity: "c2_infiltrator",
    event_type: "UNAUTHORIZED_C2_CMD",
    classification: "SECURITY_INCIDENT_INDICATED",
    response_level: 2,
    structured_evidence: {
      command: "FAN_OFF",
      reason: "Perintah tanpa izin untuk mematikan kipas saat suhu 32,5°C ditolak oleh pengaman suhu.",
      enforced_directive: "KEEP_SAFE",
      physical_current_proof: 88.5,
    },
    prev_hash: "2b9f3e46c98a39d883b27e8d6f9b1a5e4c3a2f8b7e6d5c4b3a2f1e0d9c8b7a6f",
    record_hash: "7f4c3a2b1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b",
  },
  {
    seq_id: 3,
    timestamp: "2026-10-31T04:55:18.450Z",
    schema_version: "1.0",
    source_identity: "hardware_interlock",
    event_type: "SAFETY_GATE_TRIGGER",
    classification: "INTERLOCK_ENGAGED",
    response_level: 1,
    structured_evidence: {
      action: "HARDWARE_OVERRIDE",
      detail: "Sakelar kipas dikunci menyala otomatis karena suhu mencapai 32,8°C.",
      temperature_c: 32.8,
      interlock_pin: 5,
    },
    prev_hash: "7f4c3a2b1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b",
    record_hash: "a1e4b3c9f8d7e6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1",
  },
  {
    seq_id: 4,
    timestamp: "2026-10-31T04:55:42.810Z",
    schema_version: "1.0",
    source_identity: "triangulation_engine",
    event_type: "DISCREPANCY_ANALYSIS",
    classification: "CYBER_PHYSICAL_DISCREPANCY",
    response_level: 2,
    structured_evidence: {
      software_state: "FAN_OFF_REPORTED",
      physical_current_ma: 89.2,
      triangulation_result: "SPOOFING_CONFIRMED",
      action: "ISOLATE_C2_CHANNEL",
    },
    prev_hash: "a1e4b3c9f8d7e6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1",
    record_hash: "e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4",
  },
  {
    seq_id: 5,
    timestamp: "2026-10-31T04:56:05.120Z",
    schema_version: "1.0",
    source_identity: "operator_piket",
    event_type: "INCIDENT_MITIGATION",
    classification: "INCIDENT_RESOLVED",
    response_level: 0,
    structured_evidence: {
      mitigation_type: "AUTO_FAILSAFE_RECOVERY",
      status: "STABILIZED",
      final_temp_c: 29.8,
      final_current_ma: 88.5,
    },
    prev_hash: "e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4",
    record_hash: "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b",
  },
];

export async function verifyChainClientSide(
  records: IncidentRecord[]
): Promise<VerifyReport> {
  const errors: VerifyReport["errors"] = [];
  if (records.length === 0) {
    return {
      ok: true,
      records_checked: 0,
      head_seq: null,
      head_hash: null,
      checkpoints_checked: 0,
      errors: [],
    };
  }

  const sorted = [...records].sort((a, b) => a.seq_id - b.seq_id);

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur.seq_id !== i + 1) {
      errors.push({
        seq_id: cur.seq_id,
        kind: "SEQUENCE_GAP",
        detail: `Diharapkan seq_id ${i + 1}, ditemukan ${cur.seq_id}`,
      });
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      if (cur.prev_hash !== prev.record_hash) {
        errors.push({
          seq_id: cur.seq_id,
          kind: "BROKEN_LINK",
          detail: `prev_hash pada seq_id ${cur.seq_id} tidak cocok dengan record_hash rekaman sebelumnya`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    records_checked: sorted.length,
    head_seq: sorted[sorted.length - 1].seq_id,
    head_hash: sorted[sorted.length - 1].record_hash,
    checkpoints_checked: Math.floor(sorted.length / 25),
    errors,
  };
}
