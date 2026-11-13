import type { TelemetryPoint } from "@/components/LiveTelemetryChart";
import {
  BASELINE_HUMIDITY_PCT,
  BASELINE_TEMP_C,
  GENESIS_HASH,
  NOMINAL_FAN_CURRENT_MA,
  SAFETY_GATE_THRESHOLD_C,
  computeIncidentHash,
} from "@/lib/constants";
import {
  Decision,
  IncidentRecord,
  ResponseLevel,
  Telemetry,
} from "@/types";

export interface ScenarioSimulationResult {
  alertLevel: ResponseLevel;
  lastCommand: string;
  telemetry: Telemetry;
  activeDecision: Decision;
  staleHistory?: TelemetryPoint[];
  newIncident?: IncidentRecord;
}

/**
 * Bangun state simulasi lokal untuk skenario SCN-01 s/d SCN-05 dan catatan insiden SHA-256.
 */
export function buildScenarioSimulation(
  scenarioId: string,
  prevTelemetry: Telemetry | null,
  prevIncidents: IncidentRecord[]
): ScenarioSimulationResult {
  const nowIso = new Date().toISOString();
  const prevHash =
    prevIncidents.length > 0 ? prevIncidents[0].record_hash : GENESIS_HASH;
  const nextSeq = (prevTelemetry?.seq ?? 100) + 1;
  const nextUptime = (prevTelemetry?.uptime_ms ?? 0) + 1000;

  let alertLevel: ResponseLevel = ResponseLevel.NONE;
  let lastCommand = "FAN_ON";
  let telemetry: Telemetry;
  let activeDecision: Decision;
  let staleHistory: TelemetryPoint[] | undefined;

  switch (scenarioId) {
    case "SCN-02":
      alertLevel = ResponseLevel.WARNING;
      lastCommand = "ALERT (ANOMALI dT/dt)";
      telemetry = {
        schema_version: "1.0",
        device_id: "esp32_gudang",
        seq: nextSeq,
        uptime_ms: nextUptime,
        temperature_c: 33.7,
        humidity_pct: 73.8,
        fan_reported: "ON",
        current_ma: 91.5,
        bus_v: 4.97,
        interlock_active: false,
        failsafe_active: false,
      };
      activeDecision = {
        source_identity: "esp32_gudang",
        event_type: "TELEMETRY",
        classification: "SENSOR_FAULT_SUSPECTED",
        level: ResponseLevel.WARNING,
        action: "ALERT",
        findings: [
          {
            layer: 2,
            code: "TEMP_RATE_LIMIT_EXCEEDED",
            detail: "dT/dt = +3.5°C/s (Manipulasi Suhu Cepat)",
            evidence: { dt_dt: 3.5 },
          },
        ],
        method_a_alarm: false,
        method_b_alarm: false,
        latency_ms: 0.28,
      };
      break;

    case "SCN-03":
      alertLevel = ResponseLevel.BLOCK;
      lastCommand = "KEEP_SAFE (FAN_ON)";
      telemetry = {
        schema_version: "1.0",
        device_id: "esp32_gudang",
        seq: nextSeq,
        uptime_ms: nextUptime,
        temperature_c: 32.5,
        humidity_pct: 74.2,
        fan_reported: "ON",
        current_ma: NOMINAL_FAN_CURRENT_MA,
        bus_v: 4.99,
        interlock_active: true,
        failsafe_active: false,
      };
      activeDecision = {
        source_identity: "operator",
        event_type: "COMMAND",
        target_device: "esp32_gudang",
        classification: "SECURITY_INCIDENT_INDICATED",
        level: ResponseLevel.BLOCK,
        action: "BLOCK_AND_HOLD",
        findings: [
          {
            layer: 1,
            code: "SAFETY_GATE_HOLD",
            detail: `Perintah FAN_OFF dicegat: suhu gudang 32.5°C >= ${SAFETY_GATE_THRESHOLD_C.toFixed(1)}°C`,
            evidence: { temp_c: 32.5, threshold_c: SAFETY_GATE_THRESHOLD_C },
          },
        ],
        method_a_alarm: false,
        method_b_alarm: false,
        latency_ms: 0.35,
      };
      break;

    case "SCN-04": {
      alertLevel = ResponseLevel.WARNING;
      lastCommand = "AUDIT (REPLAY DETECTED)";
      const nowStale = Date.now();
      staleHistory = [];
      for (let i = 19; i >= 0; i--) {
        const d = new Date(nowStale - i * 1500);
        staleHistory.push({
          timeStr: d.toTimeString().split(" ")[0],
          temp: 29.8,
          current: NOMINAL_FAN_CURRENT_MA,
          humidity: 76.0,
        });
      }
      telemetry = {
        schema_version: "1.0",
        device_id: "esp32_gudang",
        seq: nextSeq,
        uptime_ms: nextUptime,
        temperature_c: 29.8,
        humidity_pct: 76.0,
        fan_reported: "ON",
        current_ma: NOMINAL_FAN_CURRENT_MA,
        bus_v: 5.0,
        interlock_active: false,
        failsafe_active: false,
      };
      activeDecision = {
        source_identity: "esp32_gudang",
        event_type: "TELEMETRY",
        classification: "TELEMETRY_INTEGRITY_SUSPECTED",
        level: ResponseLevel.WARNING,
        action: "AUDIT",
        findings: [
          {
            layer: 2,
            code: "STALE_TELEMETRY",
            detail:
              "15 sampel telemetri identik 29.8°C tanpa variasi fisik (Replay Attack)",
            evidence: { stale_count: 15 },
          },
        ],
        method_a_alarm: false,
        method_b_alarm: false,
        latency_ms: 0.19,
      };
      break;
    }

    case "SCN-05":
      alertLevel = ResponseLevel.QUARANTINE;
      lastCommand = "QUARANTINE (ISOLASI DOS)";
      telemetry = {
        schema_version: "1.0",
        device_id: "intruder_burst",
        seq: nextSeq,
        uptime_ms: nextUptime,
        temperature_c: BASELINE_TEMP_C,
        humidity_pct: BASELINE_HUMIDITY_PCT,
        fan_reported: "ON",
        current_ma: NOMINAL_FAN_CURRENT_MA,
        bus_v: 5.0,
        interlock_active: false,
        failsafe_active: true,
      };
      activeDecision = {
        source_identity: "intruder_burst",
        event_type: "COMMAND",
        classification: "SECURITY_INCIDENT_INDICATED",
        level: ResponseLevel.QUARANTINE,
        action: "QUARANTINE",
        findings: [
          {
            layer: 1,
            code: "MESSAGE_BURST",
            detail:
              "Laju perintah 12 pesan/detik melampaui batas burst DoS (>10 req/s)",
            evidence: { count: 12 },
          },
        ],
        method_a_alarm: false,
        method_b_alarm: false,
        latency_ms: 0.42,
      };
      break;

    case "SCN-01":
    default:
      alertLevel = ResponseLevel.NONE;
      lastCommand = "FAN_ON";
      telemetry = {
        schema_version: "1.0",
        device_id: "esp32_gudang",
        seq: nextSeq,
        uptime_ms: nextUptime,
        temperature_c: BASELINE_TEMP_C,
        humidity_pct: BASELINE_HUMIDITY_PCT,
        fan_reported: "ON",
        current_ma: NOMINAL_FAN_CURRENT_MA,
        bus_v: 5.0,
        interlock_active: false,
        failsafe_active: false,
      };
      activeDecision = {
        source_identity: "esp32_gudang",
        event_type: "TELEMETRY",
        classification: "NORMAL",
        level: ResponseLevel.NONE,
        action: "ACCEPT",
        findings: [],
        method_a_alarm: false,
        method_b_alarm: false,
        latency_ms: 0.12,
      };
      break;
  }

  let newIncident: IncidentRecord | undefined;
  if (scenarioId !== "SCN-01") {
    const sourceId = scenarioId === "SCN-05" ? "intruder_burst" : "esp32_gudang";
    const eventType = scenarioId === "SCN-03" ? "COMMAND" : "TELEMETRY";
    const classification =
      scenarioId === "SCN-02"
        ? "SENSOR_FAULT_SUSPECTED"
        : scenarioId === "SCN-04"
        ? "TELEMETRY_INTEGRITY_SUSPECTED"
        : "SECURITY_INCIDENT_INDICATED";
    const responseLevel =
      scenarioId === "SCN-02" || scenarioId === "SCN-04"
        ? 1
        : scenarioId === "SCN-03"
        ? 2
        : 3;
    const seqId = prevIncidents.length + 1;
    const evidence: Record<string, unknown> = {
      scenario: scenarioId,
      reason:
        scenarioId === "SCN-03"
          ? "Perintah FAN_OFF diblokir oleh Safety Gate saat suhu 32.5°C"
          : scenarioId === "SCN-02"
          ? "Laju perubahan suhu melonjak +3.5°C/s melampaui batas fisik"
          : scenarioId === "SCN-04"
          ? "Replay Attack terdeteksi: 15 telemetri beku tanpa variasi fisik"
          : scenarioId === "SCN-05"
          ? "Message burst DoS terdeteksi: sumber intruder_burst diisolasi dan dikarantina"
          : `Pemicu skenario ${scenarioId}`,
    };
    const recordHash = computeIncidentHash(
      seqId,
      nowIso,
      sourceId,
      eventType,
      classification,
      responseLevel,
      evidence,
      prevHash
    );
    newIncident = {
      seq_id: seqId,
      timestamp: nowIso,
      schema_version: "1.0",
      source_identity: sourceId,
      event_type: eventType,
      classification,
      response_level: responseLevel,
      structured_evidence: evidence,
      prev_hash: prevHash,
      record_hash: recordHash,
    };
  }

  return {
    alertLevel,
    lastCommand,
    telemetry,
    activeDecision,
    staleHistory,
    newIncident,
  };
}
