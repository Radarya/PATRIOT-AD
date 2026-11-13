import { useEffect, useRef } from "react";
import type { TelemetryPoint } from "@/components/LiveTelemetryChart";
import {
  BASELINE_HUMIDITY_PCT,
  BASELINE_TEMP_C,
  GENESIS_HASH,
  NOMINAL_FAN_CURRENT_MA,
  SAFETY_GATE_THRESHOLD_C,
  computeIncidentHash,
} from "@/lib/constants";
import { IncidentRecord, ResponseLevel, Telemetry } from "@/types";

interface UseSimulationParams {
  hardwareConnectedRef: React.MutableRefObject<boolean>;
  currentScenario: string;
  currentScenarioRef: React.MutableRefObject<string>;
  alertLevelRef: React.MutableRefObject<ResponseLevel>;
  isAnomaly: boolean;
  telemetry: Telemetry | null;
  setTelemetry: React.Dispatch<React.SetStateAction<Telemetry | null>>;
  setTelemetryHistory: React.Dispatch<React.SetStateAction<TelemetryPoint[]>>;
  setAlertLevel: React.Dispatch<React.SetStateAction<ResponseLevel>>;
  setLastCommand: React.Dispatch<React.SetStateAction<string>>;
  setCurrentScenario: React.Dispatch<React.SetStateAction<string>>;
  setIncidents: React.Dispatch<React.SetStateAction<IncidentRecord[]>>;
  onTriggerScenario: (scenarioId: string) => void;
}

/**
 * Kelola ticker simulasi termodinamika lokal & demo sabotase saat ESP32 fisik tidak terhubung.
 */
export function useSimulation({
  hardwareConnectedRef,
  currentScenario,
  currentScenarioRef,
  alertLevelRef,
  isAnomaly,
  telemetry,
  setTelemetry,
  setTelemetryHistory,
  setAlertLevel,
  setLastCommand,
  setCurrentScenario,
  setIncidents,
  onTriggerScenario,
}: UseSimulationParams) {
  const sabotageTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      // Jika hardware ESP32 fisik terhubung (link lokal aktif), jangan timpa telemetri sensor riil
      if (hardwareConnectedRef.current) return;

      setTelemetry((prev) => {
        if (!prev) return prev;
        const activeScenario = currentScenarioRef.current;

        // SKENARIO KHUSUS SCN-04: Replay Attack (Telemetri Beku 29.8°C tanpa jitter/varians)
        if (activeScenario === "SCN-04") {
          return {
            ...prev,
            temperature_c: 29.8,
            humidity_pct: 76.0,
            current_ma: NOMINAL_FAN_CURRENT_MA,
            fan_reported: "ON",
            interlock_active: false,
            failsafe_active: false,
          };
        }

        // SKENARIO KHUSUS SCN-05: Message Burst / DoS Attack (Simpul pengirim dikarantina)
        if (activeScenario === "SCN-05") {
          return {
            ...prev,
            temperature_c: BASELINE_TEMP_C,
            humidity_pct: BASELINE_HUMIDITY_PCT,
            current_ma: NOMINAL_FAN_CURRENT_MA,
            fan_reported: "ON",
            interlock_active: false,
            failsafe_active: true,
          };
        }

        const isFanOff = prev.fan_reported === "OFF";
        let newTemp = prev.temperature_c ?? BASELINE_TEMP_C;
        let newHum = prev.humidity_pct ?? BASELINE_HUMIDITY_PCT;

        if (isFanOff) {
          newTemp = Math.round((newTemp + 0.2) * 10) / 10;
          if (newHum < 72.0) {
            newHum = Math.round((newHum + 0.1) * 10) / 10;
          }
          try {
            localStorage.setItem("patriot_temperature", String(newTemp));
          } catch {}

          // INTERLOCK FISIK OTOMATIS: Jika suhu mencapai 32.0°C, Safety Gate mandiri menyalakan kipas
          if (newTemp >= SAFETY_GATE_THRESHOLD_C) {
            setLastCommand("KEEP_SAFE (INTERLOCK FISIK)");
            setAlertLevel(ResponseLevel.BLOCK);

            const nowIso = new Date().toISOString();
            setIncidents((prevInc) => {
              const prevHash =
                prevInc.length > 0 ? prevInc[0].record_hash : GENESIS_HASH;
              const seqId = prevInc.length + 1;
              const evidence = {
                temperature_c: newTemp,
                reason: `Interlock Otomatis: Suhu gudang mencapai ${newTemp}°C (>= ${SAFETY_GATE_THRESHOLD_C.toFixed(1)}°C)! Kipas diaktifkan paksa secara otonom demi keamanan amunisi.`,
              };
              const recordHash = computeIncidentHash(
                seqId,
                nowIso,
                "esp32_gudang",
                "TELEMETRY",
                "SECURITY_INCIDENT_INDICATED",
                2,
                evidence,
                prevHash
              );
              return [
                {
                  seq_id: seqId,
                  timestamp: nowIso,
                  schema_version: "1.0",
                  source_identity: "esp32_gudang",
                  event_type: "TELEMETRY",
                  classification: "SECURITY_INCIDENT_INDICATED",
                  response_level: 2,
                  structured_evidence: evidence,
                  prev_hash: prevHash,
                  record_hash: recordHash,
                },
                ...prevInc,
              ];
            });

            try {
              localStorage.setItem("patriot_fan_state", "ON");
            } catch {}

            return {
              ...prev,
              temperature_c: newTemp,
              humidity_pct: newHum,
              fan_reported: "ON",
              current_ma: NOMINAL_FAN_CURRENT_MA,
              interlock_active: true,
            };
          }

          return {
            ...prev,
            temperature_c: newTemp,
            humidity_pct: newHum,
            current_ma: 0.0,
            interlock_active: false,
          };
        } else {
          if (newTemp > BASELINE_TEMP_C) {
            newTemp = Math.round((newTemp - 0.2) * 10) / 10;
          } else if (newTemp < 30.0) {
            newTemp = Math.round((newTemp + 0.1) * 10) / 10;
          }

          if (newHum > 58.6) {
            newHum = Math.round((newHum - 0.2) * 10) / 10;
          } else if (newHum < 57.8) {
            newHum = Math.round((newHum + 0.2) * 10) / 10;
          }

          const t = Date.now() / 2500;
          const waveT = Math.sin(t) * 0.45;
          const waveI = Math.cos(t) * 2.2;
          const jitterT = (Math.random() - 0.5) * 0.08;
          const jitterI = (Math.random() - 0.5) * 0.6;
          const liveTemp = Math.round((newTemp + waveT + jitterT) * 10) / 10;
          const liveCurrent =
            Math.round((NOMINAL_FAN_CURRENT_MA + waveI + jitterI) * 10) / 10;

          try {
            localStorage.setItem("patriot_temperature", String(liveTemp));
          } catch {}

          const currentAlert = alertLevelRef.current;
          const isHealed =
            liveTemp <= 31.0 &&
            (currentScenarioRef.current === "SCN-01" ||
              currentScenarioRef.current === "SCN-03") &&
            (currentAlert > ResponseLevel.NONE || Boolean(prev.interlock_active));

          if (isHealed) {
            setAlertLevel(ResponseLevel.NONE);
            setLastCommand("FAN_ON");
            setCurrentScenario("SCN-01");
            currentScenarioRef.current = "SCN-01";
            try {
              localStorage.setItem("patriot_scenario", "SCN-01");
              localStorage.setItem("patriot_fan_state", "ON");
              localStorage.setItem("patriot_temperature", String(liveTemp));
            } catch {}
          }

          return {
            ...prev,
            temperature_c: liveTemp,
            humidity_pct: newHum,
            current_ma: liveCurrent,
            interlock_active: liveTemp >= SAFETY_GATE_THRESHOLD_C,
          };
        }
      });
    }, 1500);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (sabotageTimerRef.current) clearTimeout(sabotageTimerRef.current);
    };
  }, []);

  const handleStartSabotageDemo = () => {
    // Mode Hardware Riil: tidak ada simulasi tiruan
    if (hardwareConnectedRef.current) return;

    if (isAnomaly || currentScenario !== "SCN-01") {
      if (sabotageTimerRef.current) clearTimeout(sabotageTimerRef.current);
      onTriggerScenario("SCN-01");
      return;
    }

    if (sabotageTimerRef.current) clearTimeout(sabotageTimerRef.current);

    setCurrentScenario("SCN-03");
    setAlertLevel(ResponseLevel.WARNING);
    setLastCommand("FAN_OFF (DISABOTASE PENYERANG)");

    const now0 = new Date();
    const time0 = now0.toTimeString().split(" ")[0];

    setTelemetry({
      schema_version: "1.0",
      device_id: "esp32_gudang",
      seq: (telemetry?.seq ?? 100) + 1,
      uptime_ms: (telemetry?.uptime_ms ?? 0) + 1000,
      temperature_c: 30.5,
      humidity_pct: 75.8,
      fan_reported: "OFF",
      current_ma: 0.0,
      bus_v: 5.0,
      interlock_active: false,
      failsafe_active: false,
    });

    setTelemetryHistory((prev) => [
      ...prev.slice(1),
      { timeStr: time0, temp: 30.5, current: 0.0, humidity: 75.8 },
    ]);

    try {
      localStorage.setItem("patriot_fan_state", "OFF");
      localStorage.setItem("patriot_temperature", "30.5");
    } catch {}

    sabotageTimerRef.current = setTimeout(() => {
      const time1 = new Date().toTimeString().split(" ")[0];
      setTelemetry((prev) =>
        prev
          ? {
              ...prev,
              temperature_c: 31.2,
              humidity_pct: 76.2,
              current_ma: 0.0,
              fan_reported: "OFF",
              interlock_active: false,
            }
          : prev
      );
      setTelemetryHistory((prev) => [
        ...prev.slice(1),
        { timeStr: time1, temp: 31.2, current: 0.0, humidity: 76.2 },
      ]);

      sabotageTimerRef.current = setTimeout(() => {
        const time2 = new Date().toTimeString().split(" ")[0];
        setTelemetry((prev) =>
          prev
            ? {
                ...prev,
                temperature_c: 31.9,
                humidity_pct: 76.6,
                current_ma: 0.0,
                fan_reported: "OFF",
                interlock_active: false,
              }
            : prev
        );
        setTelemetryHistory((prev) => [
          ...prev.slice(1),
          { timeStr: time2, temp: 31.9, current: 0.0, humidity: 76.6 },
        ]);

        sabotageTimerRef.current = setTimeout(() => {
          const time3 = new Date().toTimeString().split(" ")[0];
          setAlertLevel(ResponseLevel.BLOCK);
          setLastCommand("KEEP_SAFE (INTERLOCK FISIK MANDIRI)");
          setTelemetry((prev) =>
            prev
              ? {
                  ...prev,
                  temperature_c: 32.3,
                  humidity_pct: 77.0,
                  current_ma: NOMINAL_FAN_CURRENT_MA,
                  fan_reported: "ON",
                  interlock_active: true,
                }
              : prev
          );
          setTelemetryHistory((prev) => [
            ...prev.slice(1),
            {
              timeStr: time3,
              temp: 32.3,
              current: NOMINAL_FAN_CURRENT_MA,
              humidity: 77.0,
            },
          ]);

          try {
            localStorage.setItem("patriot_fan_state", "ON");
            localStorage.setItem("patriot_temperature", "32.3");
          } catch {}

          const nowIso = new Date().toISOString();
          setIncidents((prevInc) => {
            const prevHash = prevInc[0]?.record_hash || GENESIS_HASH;
            const seqId = prevInc.length + 1;
            const evidence = {
              temperature_c: 32.3,
              threshold: SAFETY_GATE_THRESHOLD_C,
              reason:
                "Interlock Mandiri Terpicu: Suhu 32.3°C melebihi batas 32.0°C! Mikrokontroler memotong kontrol penyerang & menyalakan paksa kipas secara otonom.",
              action: "FORCE_FAN_ON",
            };
            const recordHash = computeIncidentHash(
              seqId,
              nowIso,
              "esp32_gudang",
              "SAFETY_GATE_TRIGGERED",
              "SECURITY_INCIDENT_INDICATED",
              2,
              evidence,
              prevHash
            );
            return [
              {
                seq_id: seqId,
                timestamp: nowIso,
                schema_version: "1.0",
                source_identity: "esp32_gudang",
                event_type: "SAFETY_GATE_TRIGGERED",
                classification: "SECURITY_INCIDENT_INDICATED",
                response_level: 2,
                structured_evidence: evidence,
                prev_hash: prevHash,
                record_hash: recordHash,
              },
              ...prevInc,
            ];
          });

          sabotageTimerRef.current = setTimeout(() => {
            const time4 = new Date().toTimeString().split(" ")[0];
            setTelemetry((prev) =>
              prev
                ? {
                    ...prev,
                    temperature_c: 31.4,
                    current_ma: NOMINAL_FAN_CURRENT_MA,
                    fan_reported: "ON",
                    interlock_active: true,
                  }
                : prev
            );
            setTelemetryHistory((prev) => [
              ...prev.slice(1),
              {
                timeStr: time4,
                temp: 31.4,
                current: NOMINAL_FAN_CURRENT_MA,
                humidity: 76.5,
              },
            ]);

            sabotageTimerRef.current = setTimeout(() => {
              const time5 = new Date().toTimeString().split(" ")[0];
              setTelemetry((prev) =>
                prev
                  ? {
                      ...prev,
                      temperature_c: BASELINE_TEMP_C,
                      current_ma: NOMINAL_FAN_CURRENT_MA,
                      fan_reported: "ON",
                      interlock_active: false,
                    }
                  : prev
              );
              setTelemetryHistory((prev) => [
                ...prev.slice(1),
                {
                  timeStr: time5,
                  temp: BASELINE_TEMP_C,
                  current: NOMINAL_FAN_CURRENT_MA,
                  humidity: BASELINE_HUMIDITY_PCT,
                },
              ]);
              setAlertLevel(ResponseLevel.NONE);
              setLastCommand("FAN_ON (NORMAL)");
              setCurrentScenario("SCN-01");
              try {
                localStorage.setItem("patriot_scenario", "SCN-01");
                localStorage.setItem("patriot_fan_state", "ON");
                localStorage.setItem(
                  "patriot_temperature",
                  String(BASELINE_TEMP_C)
                );
              } catch {}
            }, 2000);
          }, 2000);
        }, 1500);
      }, 1500);
    }, 1500);
  };

  return { handleStartSabotageDemo };
}
