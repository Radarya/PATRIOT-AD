import { useEffect, useRef, useState } from "react";
import {
  BASELINE_HUMIDITY_PCT,
  BASELINE_TEMP_C,
  NOMINAL_FAN_CURRENT_MA,
} from "@/lib/constants";
import { Decision, IncidentRecord, ResponseLevel, Telemetry } from "@/types";

interface UseTelemetrySocketParams {
  currentScenarioRef: React.MutableRefObject<string>;
  scenarioHoldUntilRef: React.MutableRefObject<number>;
  scenarioResetTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  hasSeededRealHistoryRef: React.MutableRefObject<boolean>;
  setTelemetry: React.Dispatch<React.SetStateAction<Telemetry | null>>;
  setAlertLevel: React.Dispatch<React.SetStateAction<ResponseLevel>>;
  setIncidents: React.Dispatch<React.SetStateAction<IncidentRecord[]>>;
  setActiveDecision: React.Dispatch<React.SetStateAction<Decision | null>>;
  setLastCommand: React.Dispatch<React.SetStateAction<string>>;
  setCurrentScenario: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Kelola koneksi WebSocket ke Backend Policy Gateway beserta watchdog deteksi ESP32 fisik.
 */
export function useTelemetrySocket({
  currentScenarioRef,
  scenarioHoldUntilRef,
  scenarioResetTimerRef,
  hasSeededRealHistoryRef,
  setTelemetry,
  setAlertLevel,
  setIncidents,
  setActiveDecision,
  setLastCommand,
  setCurrentScenario,
}: UseTelemetrySocketParams) {
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const wsConnectedRef = useRef(wsConnected);
  useEffect(() => {
    wsConnectedRef.current = wsConnected;
  }, [wsConnected]);

  const [hardwareConnected, setHardwareConnected] = useState<boolean>(false);
  const hardwareConnectedRef = useRef(hardwareConnected);
  useEffect(() => {
    hardwareConnectedRef.current = hardwareConnected;
  }, [hardwareConnected]);
  const hardwareWatchdogRef = useRef<NodeJS.Timeout | null>(null);

  const markHardwareHeartbeat = () => {
    setHardwareConnected(true);
    hardwareConnectedRef.current = true;
    if (hardwareWatchdogRef.current) {
      clearTimeout(hardwareWatchdogRef.current);
    }
    hardwareWatchdogRef.current = setTimeout(() => {
      setHardwareConnected(false);
      hardwareConnectedRef.current = false;
    }, 8000);
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      try {
        if (
          typeof window !== "undefined" &&
          window.location.protocol === "https:"
        ) {
          setWsConnected(false);
          setHardwareConnected(false);
          hardwareConnectedRef.current = false;
          return;
        }
        const host =
          typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
        ws = new WebSocket(`ws://${host}:8000/ws`);

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "INIT") {
              if (data.hardware_connected) {
                markHardwareHeartbeat();
                if (data.telemetry) {
                  const espData = (data.telemetry["esp32_gudang"] ||
                    Object.values(data.telemetry)[0]) as Telemetry | undefined;
                  if (espData) {
                    setTelemetry(espData);
                    setLastCommand(
                      espData.interlock_active
                        ? "KEEP_SAFE (INTERLOCK FISIK)"
                        : espData.fan_reported === "OFF"
                        ? "FAN_OFF"
                        : "FAN_ON"
                    );
                  } else {
                    setLastCommand("FAN_ON");
                  }
                } else {
                  setLastCommand("FAN_ON");
                }
                if (data.alert_level !== undefined) {
                  setAlertLevel(data.alert_level);
                }
              } else {
                setHardwareConnected(false);
                hardwareConnectedRef.current = false;
                hasSeededRealHistoryRef.current = false;
                setTelemetry({
                  schema_version: "1.0",
                  device_id: "esp32_gudang",
                  seq: 100,
                  uptime_ms: 3600000,
                  temperature_c: BASELINE_TEMP_C,
                  humidity_pct: BASELINE_HUMIDITY_PCT,
                  fan_reported: "ON",
                  current_ma: NOMINAL_FAN_CURRENT_MA,
                  bus_v: 5.0,
                  interlock_active: false,
                  failsafe_active: false,
                });
                setLastCommand("FAN_ON");
                setAlertLevel(ResponseLevel.NONE);
                setCurrentScenario("SCN-01");
              }
              if (
                data.recent_incidents &&
                Array.isArray(data.recent_incidents) &&
                data.recent_incidents.length > 0
              ) {
                setIncidents(data.recent_incidents);
              }
            } else if (data.type === "HARDWARE_STATUS") {
              if (data.hardware_connected) {
                markHardwareHeartbeat();
              } else {
                setHardwareConnected(false);
                hardwareConnectedRef.current = false;
                hasSeededRealHistoryRef.current = false;
              }
            } else if (data.type === "DECISION") {
              if (Date.now() < scenarioHoldUntilRef.current && !data.scenario) {
                return;
              }

              if (data.hardware_connected !== undefined) {
                if (data.hardware_connected) {
                  markHardwareHeartbeat();
                } else {
                  setHardwareConnected(false);
                  hardwareConnectedRef.current = false;
                  hasSeededRealHistoryRef.current = false;
                }
              }
              if (data.latest_telemetry) {
                if (data.latest_telemetry.device_id === "esp32_gudang") {
                  markHardwareHeartbeat();
                  setTelemetry(data.latest_telemetry as Telemetry);
                  if (
                    currentScenarioRef.current === "SCN-01" &&
                    data.decision?.event_type !== "COMMAND"
                  ) {
                    setLastCommand(
                      data.latest_telemetry.interlock_active
                        ? "KEEP_SAFE (INTERLOCK FISIK)"
                        : data.latest_telemetry.fan_reported === "OFF"
                        ? "FAN_OFF"
                        : "FAN_ON"
                    );
                  }
                } else if (!hardwareConnectedRef.current) {
                  setTelemetry(data.latest_telemetry as Telemetry);
                }
              }
              if (data.incident) {
                setIncidents((prev) =>
                  prev.some((i) => i.seq_id === data.incident.seq_id)
                    ? prev
                    : [data.incident, ...prev.slice(0, 30)]
                );
              }
              if (data.scenario) {
                setCurrentScenario(data.scenario);
                currentScenarioRef.current = data.scenario;
                if (data.scenario === "SCN-01") {
                  setAlertLevel(ResponseLevel.NONE);
                  setLastCommand("FAN_ON");
                  scenarioHoldUntilRef.current = 0;
                  if (scenarioResetTimerRef.current) {
                    clearTimeout(scenarioResetTimerRef.current);
                    scenarioResetTimerRef.current = null;
                  }
                  if (!hardwareConnectedRef.current) {
                    setTelemetry({
                      schema_version: "1.0",
                      device_id: "esp32_gudang",
                      seq: 101,
                      uptime_ms: 3600000,
                      temperature_c: BASELINE_TEMP_C,
                      humidity_pct: BASELINE_HUMIDITY_PCT,
                      fan_reported: "ON",
                      current_ma: NOMINAL_FAN_CURRENT_MA,
                      bus_v: 5.0,
                      interlock_active: false,
                      failsafe_active: false,
                    });
                  }
                } else if (data.scenario === "SCN-02") {
                  setLastCommand("ALERT (ANOMALI dT/dt)");
                } else if (data.scenario === "SCN-03") {
                  setLastCommand("KEEP_SAFE (FAN_ON)");
                } else if (data.scenario === "SCN-04") {
                  setLastCommand("AUDIT (REPLAY DETECTED)");
                } else if (data.scenario === "SCN-05") {
                  setLastCommand("QUARANTINE (ISOLASI DOS)");
                }
              } else if (
                data.decision &&
                data.decision.event_type === "COMMAND" &&
                (data.decision.level ?? 0) >= 2
              ) {
                setLastCommand("FAN_OFF (DITOLAK - AKSES ILEGAL)");
              }
              if (data.decision) {
                setActiveDecision(data.decision);
                if (data.decision.level !== undefined) {
                  setAlertLevel(data.decision.level);
                }
              }
            } else if (data.event === "TELEMETRY" && data.payload) {
              if (data.payload.device_id === "esp32_gudang") {
                markHardwareHeartbeat();
              }
              setTelemetry(data.payload);
              if (
                currentScenarioRef.current === "SCN-01" &&
                data.payload.current_ma !== undefined
              ) {
                setLastCommand(
                  data.payload.current_ma >= 40.0 ? "FAN_ON" : "FAN_OFF"
                );
              }
            } else if (data.event === "DECISION" && data.payload) {
              setActiveDecision(data.payload);
              if (data.payload.level !== undefined) {
                setAlertLevel(data.payload.level);
              }
            } else if (data.event === "INCIDENT" && data.payload) {
              setIncidents((prev) => [data.payload, ...prev.slice(0, 30)]);
            }
          } catch (e) {
            console.error("WS error", e);
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          setHardwareConnected(false);
          hardwareConnectedRef.current = false;
          reconnectTimer = setTimeout(connect, 4000);
        };

        ws.onerror = () => {
          setWsConnected(false);
          if (ws) ws.close();
        };
      } catch {
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (hardwareWatchdogRef.current) clearTimeout(hardwareWatchdogRef.current);
      if (ws) ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    wsConnected,
    wsConnectedRef,
    hardwareConnected,
    hardwareConnectedRef,
  };
}
