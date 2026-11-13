/**
 * Definisi tipe data PATRIOT-AD untuk Web Dashboard.
 * Sinkron 100% dengan Pydantic v2 schemas di backend/patriot/schemas.py.
 */

export type FanState = "ON" | "OFF";
export type FanCommand = "FAN_ON" | "FAN_OFF";

export type Classification =
  | "NORMAL"
  | "SENSOR_FAULT_SUSPECTED"
  | "TELEMETRY_INTEGRITY_SUSPECTED"
  | "SECURITY_INCIDENT_INDICATED"
  | "CONFIRMED_IN_TEST_SCENARIO";

export enum ResponseLevel {
  NONE = 0,
  WARNING = 1,
  BLOCK = 2,
  QUARANTINE = 3,
}

export interface Telemetry {
  schema_version: "1.0";
  device_id: string;
  seq: number;
  uptime_ms: number;
  temperature_c: number | null;
  humidity_pct: number | null;
  fan_reported: FanState;
  current_ma: number | null;
  bus_v: number | null;
  interlock_active: boolean;
  failsafe_active: boolean;
  sensor_status?: "NORMAL" | "SENSOR_PUTUS";
}

export interface Finding {
  layer: 1 | 2 | 3;
  code: string;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface Decision {
  source_identity: string;
  event_type: "TELEMETRY" | "COMMAND" | "HEARTBEAT" | "ADMIN";
  target_device?: string;
  classification: Classification;
  level: ResponseLevel;
  action: string;
  findings: Finding[];
  method_a_alarm: boolean;
  method_b_alarm: boolean;
  latency_ms: number;
  incident_seq?: number;
}

export interface ActuatorDirective {
  schema_version: "1.0";
  gateway_seq: number;
  target_device: string;
  fan: FanCommand | null;
  alert_level: ResponseLevel;
  origin: "OPERATOR" | "KEEP_SAFE" | "ALERT_UPDATE" | "RESYNC";
  request_id?: string;
}

export interface IncidentRecord {
  seq_id: number;
  timestamp: string;
  schema_version: string;
  source_identity: string;
  event_type: string;
  classification: string;
  response_level: number;
  structured_evidence: Record<string, unknown>;
  prev_hash: string;
  record_hash: string;
}

export interface VerifyReport {
  ok: boolean;
  records_checked: number;
  head_seq: number | null;
  head_hash: string | null;
  checkpoints_checked: number;
  errors: Array<{
    seq_id: number | null;
    kind: string;
    detail: string;
  }>;
}

export type ViewMode = "MONITORING" | "BENCHMARK" | "FORENSIC";

export interface TacticalUser {
  name: string;
  nrp: string;
  role: "operator" | "admin" | "unauthorized";
  roleLabel: string;
  loginTime: string;
  token?: string;
}
