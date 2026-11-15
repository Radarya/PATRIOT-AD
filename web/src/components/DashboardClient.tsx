"use client";

import React, { useState, useEffect, useRef } from "react";
import PatriotLogo from "@/components/PatriotLogo";
import TacticalHeader from "@/components/TacticalHeader";
import InstrumentCluster from "@/components/InstrumentCluster";
import CyberPhysicalProof from "@/components/CyberPhysicalProof";
import BenchmarkMatrix from "@/components/BenchmarkMatrix";
import ForensicAuditViewer from "@/components/ForensicAuditViewer";
import CommandConsole from "@/components/CommandConsole";
import TerminalFeed from "@/components/TerminalFeed";
import LiveTelemetryChart, {
  INITIAL_TELEMETRY_POINTS,
  TelemetryPoint,
  getDynamicInitialTelemetry,
} from "@/components/LiveTelemetryChart";
import { TacticalLockScreen } from "@/components/TacticalLockScreen";
import { TacticalLoadingScreen } from "@/components/TacticalLoadingScreen";

import {
  Telemetry,
  IncidentRecord,
  ResponseLevel,
  ViewMode,
  Decision,
  FanCommand,
  TacticalUser,
} from "@/types";
import { INITIAL_TELEMETRY, INITIAL_INCIDENTS } from "@/lib/mockData";
import {
  BASELINE_TEMP_C,
  GENESIS_HASH,
  NOMINAL_FAN_CURRENT_MA,
  SAFETY_GATE_THRESHOLD_C,
  computeIncidentHash,
} from "@/lib/constants";
import { buildScenarioSimulation } from "@/lib/scenarios";
import { useSimulation } from "@/lib/useSimulation";
import { useTelemetrySocket } from "@/lib/useTelemetrySocket";

interface DashboardClientProps {
  initialTheme?: "dark" | "light";
  initialTab?: ViewMode;
  initialScenario?: string;
}

export default function DashboardClient({
  initialTheme = "dark",
  initialTab = "MONITORING",
  initialScenario = "SCN-01",
}: DashboardClientProps) {
  const [theme, setTheme] = useState<"dark" | "light">(initialTheme);
  const [activeView, setActiveView] = useState<ViewMode>(initialTab);

  const [telemetry, setTelemetry] = useState<Telemetry | null>(INITIAL_TELEMETRY);
  const [alertLevel, setAlertLevel] = useState<ResponseLevel>(ResponseLevel.NONE);
  const [incidents, setIncidents] = useState<IncidentRecord[]>(INITIAL_INCIDENTS);
  const [activeDecision, setActiveDecision] = useState<Decision | null>(null);
  const [lastCommand, setLastCommand] = useState<string>("FAN_ON");
  const [currentScenario, setCurrentScenario] = useState<string>(initialScenario);
  const [isTampered, setIsTampered] = useState<boolean>(false);
  const [isLocked, setIsLocked] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<TacticalUser>({
    name: "Sertu Fulan",
    nrp: "3112009871",
    role: "operator",
    roleLabel: "Operator Piket",
    loginTime: "13:00:00",
  });

  // Cek sesi login tersimpan di browser agar tidak perlu login ulang setiap refresh
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const savedAuth = sessionStorage.getItem("patriot_session_auth");
        if (savedAuth) {
          const parsed = JSON.parse(savedAuth);
          if (parsed && parsed.name === "Sertu Raditya") {
            parsed.name = "Sertu Fulan";
            sessionStorage.setItem("patriot_session_auth", JSON.stringify(parsed));
          }
          setCurrentUser(parsed);
          setIsLocked(false);
        } else {
          setIsLocked(true);
        }
      } catch {
        setIsLocked(true);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleAuthenticate = (user: TacticalUser) => {
    setCurrentUser(user);
    setIsLocked(false);
    setIsLoading(true);
    try {
      sessionStorage.setItem("patriot_session_auth", JSON.stringify(user));
    } catch {}

    if (user.role === "unauthorized") {
      const nowIso = new Date().toISOString();
      const prevHash = incidents[0]?.record_hash || GENESIS_HASH;
      const seqId = incidents.length + 1;
      const evidence = {
        nrp: user.nrp,
        name: user.name,
        reason: "Akses ilegal: Percobaan manipulasi konsol oleh akun tamu tak berizin",
        action_taken: "DISABLE_ACTUATOR_CONTROLS",
      };
      const recordHash = computeIncidentHash(
        seqId,
        nowIso,
        "TAMU_ILEGAL",
        "UNAUTHORIZED_LOGIN_ATTEMPT",
        "INTRUSION_DETECTED",
        2,
        evidence,
        prevHash
      );
      const intrusionIncident: IncidentRecord = {
        seq_id: seqId,
        timestamp: nowIso,
        schema_version: "1.0",
        source_identity: "TAMU_ILEGAL",
        event_type: "UNAUTHORIZED_LOGIN_ATTEMPT",
        classification: "INTRUSION_DETECTED",
        response_level: 2,
        structured_evidence: evidence,
        prev_hash: prevHash,
        record_hash: recordHash,
      };
      setIncidents((prev) => [intrusionIncident, ...prev]);
    }
  };

  const alertLevelRef = useRef<ResponseLevel>(alertLevel);
  useEffect(() => {
    alertLevelRef.current = alertLevel;
  }, [alertLevel]);

  const currentScenarioRef = useRef<string>(currentScenario);
  useEffect(() => {
    currentScenarioRef.current = currentScenario;
  }, [currentScenario]);
  const scenarioHoldUntilRef = useRef<number>(0);
  const scenarioResetTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [telemetryHistory, setTelemetryHistory] =
    useState<TelemetryPoint[]>(INITIAL_TELEMETRY_POINTS);
  const hasSeededRealHistoryRef = useRef<boolean>(false);

  const { wsConnectedRef, hardwareConnected, hardwareConnectedRef } =
    useTelemetrySocket({
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
    });

  // Sinkronisasi riwayat telemetri awal dengan jam nyata saat konsol pertama kali dimuat
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTelemetryHistory(getDynamicInitialTelemetry());
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pulihkan tema & tab aktif dari penyimpanan lokal saat mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const savedTheme = localStorage.getItem("patriot_theme") as
          | "dark"
          | "light"
          | null;
        if (
          savedTheme &&
          (savedTheme === "light" || savedTheme === "dark") &&
          savedTheme !== theme
        ) {
          setTheme(savedTheme);
        }

        const sp = new URLSearchParams(window.location.search);
        const urlTab = sp.get("tab")?.toUpperCase() as ViewMode;
        const validTabs: ViewMode[] = ["MONITORING", "BENCHMARK", "FORENSIC"];
        if (urlTab && validTabs.includes(urlTab)) {
          setActiveView(urlTab);
        } else {
          const savedView = localStorage.getItem("patriot_active_view") as ViewMode;
          if (savedView && validTabs.includes(savedView)) {
            setActiveView(savedView);
          }
        }

        setCurrentScenario("SCN-01");
        setAlertLevel(ResponseLevel.NONE);
        setLastCommand("FAN_ON");
        try {
          localStorage.setItem("patriot_scenario", "SCN-01");
          localStorage.setItem("patriot_fan_state", "ON");
          localStorage.setItem("patriot_temperature", String(BASELINE_TEMP_C));
          document.cookie = "patriot_scenario=SCN-01; path=/; max-age=31536000; SameSite=Lax";
        } catch {}
      } catch {}
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sinkronisasi titik grafik telemetri setiap telemetry berubah
  useEffect(() => {
    if (!telemetry) return;
    const now = Date.now();
    const timeStr = new Date(now).toTimeString().split(" ")[0];
    const liveTemp = telemetry.temperature_c ?? 0.0;
    const liveCurrent = telemetry.current_ma ?? 0.0;
    const liveHum = telemetry.humidity_pct ?? 0.0;

    if (
      hardwareConnectedRef.current &&
      !hasSeededRealHistoryRef.current &&
      telemetry.temperature_c !== null
    ) {
      hasSeededRealHistoryRef.current = true;
      const seeded: TelemetryPoint[] = [];
      for (let i = 19; i >= 0; i--) {
        const tStr = new Date(now - i * 2000).toTimeString().split(" ")[0];
        seeded.push({
          timeStr: tStr,
          temp: liveTemp,
          current: liveCurrent,
          humidity: liveHum,
        });
      }
      setTelemetryHistory(seeded);
      return;
    }

    setTelemetryHistory((prev) => [
      ...prev.slice(1),
      {
        timeStr,
        temp: liveTemp,
        current: liveCurrent,
        humidity: liveHum,
      },
    ]);
  }, [telemetry, hardwareConnectedRef]);

  const isSystemAnomaly =
    alertLevel > ResponseLevel.NONE ||
    Boolean(telemetry?.interlock_active) ||
    Boolean(telemetry?.failsafe_active);

  const effectiveTheme: "dark" | "light" | "dark-anomaly" | "light-anomaly" =
    isSystemAnomaly
      ? theme === "light"
        ? "light-anomaly"
        : "dark-anomaly"
      : theme;

  const isLight = effectiveTheme === "light" || effectiveTheme === "light-anomaly";
  const isAnomaly = isSystemAnomaly;

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("patriot_theme", next);
        document.cookie = `patriot_theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
        const root = document.documentElement;
        root.classList.remove(next === "dark" ? "light" : "dark");
        root.classList.add(next);
        root.setAttribute("data-theme", next);
      } catch {}
      return next;
    });
  };

  const handleViewChange = (view: ViewMode) => {
    setActiveView(view);
    try {
      localStorage.setItem("patriot_active_view", view);
      document.cookie = `patriot_active_view=${view}; path=/; max-age=31536000; SameSite=Lax`;
      const url = new URL(window.location.href);
      url.searchParams.set("tab", view.toLowerCase());
      window.history.replaceState(null, "", url.toString());
    } catch {}
  };

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", effectiveTheme);
    if (isLight) {
      root.classList.remove("dark");
      root.classList.add("light");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }
  }, [effectiveTheme, isLight]);

  const resolveGatewayToken = async (role: string): Promise<string | undefined> => {
    if (currentUser.token) return currentUser.token;
    if (role === "unauthorized" || !wsConnectedRef.current) return undefined;
    try {
      const host =
        typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const authRes = await fetch(`http://${host}:8000/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, nrp: currentUser.nrp }),
      });
      if (authRes.ok) {
        const authData = await authRes.json();
        if (typeof authData.token === "string" && authData.token.length > 0) {
          const updatedUser = { ...currentUser, token: authData.token };
          setCurrentUser(updatedUser);
          try {
            sessionStorage.setItem("patriot_session_auth", JSON.stringify(updatedUser));
          } catch {}
          return authData.token;
        }
      }
    } catch {}
    return undefined;
  };

  const triggerScenarioRef = useRef<(id: string) => void>(() => {});

  const handleTriggerScenario = (scenarioId: string) => {
    setCurrentScenario(scenarioId);
    currentScenarioRef.current = scenarioId;

    if (scenarioResetTimerRef.current) {
      clearTimeout(scenarioResetTimerRef.current);
      scenarioResetTimerRef.current = null;
    }

    if (scenarioId !== "SCN-01") {
      scenarioResetTimerRef.current = setTimeout(() => {
        triggerScenarioRef.current("SCN-01");
      }, 8000);
    }

    scenarioHoldUntilRef.current = scenarioId === "SCN-01" ? 0 : Date.now() + 8000;

    if (wsConnectedRef.current) {
      void (async () => {
        try {
          const host =
            typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
          const authToken = await resolveGatewayToken(currentUser.role);
          const headers: Record<string, string> = {};
          if (authToken && currentUser.role !== "unauthorized") {
            headers["X-Patriot-Token"] = authToken;
          }
          await fetch(`http://${host}:8000/api/benchmark/${scenarioId}`, {
            method: "POST",
            headers,
          });
        } catch (err) {
          console.error("Benchmark API error:", err);
        }
      })();
    }

    const sim = buildScenarioSimulation(scenarioId, telemetry, incidents);
    setAlertLevel(sim.alertLevel);
    setLastCommand(sim.lastCommand);
    setTelemetry(sim.telemetry);
    setActiveDecision(sim.activeDecision);
    if (sim.staleHistory) {
      setTelemetryHistory(sim.staleHistory);
    }
    if (scenarioId === "SCN-01") {
      scenarioHoldUntilRef.current = 0;
      try {
        localStorage.setItem("patriot_fan_state", "ON");
        localStorage.setItem("patriot_temperature", String(BASELINE_TEMP_C));
      } catch {}
    }
    if (sim.newIncident) {
      setIncidents((prev) => [sim.newIncident!, ...prev]);
    }

    try {
      localStorage.setItem("patriot_scenario", scenarioId);
      document.cookie = `patriot_scenario=${scenarioId}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}
  };

  useEffect(() => {
    triggerScenarioRef.current = handleTriggerScenario;
  });

  const { handleStartSabotageDemo } = useSimulation({
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
    onTriggerScenario: handleTriggerScenario,
  });

  const handleSendCommand = async (cmd: FanCommand, role: string) => {
    const host =
      typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";

    const authToken = await resolveGatewayToken(role);
    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken && role !== "unauthorized") {
      reqHeaders["X-Patriot-Token"] = authToken;
    }

    const temp = telemetry?.temperature_c ?? BASELINE_TEMP_C;
    const isHot = temp >= SAFETY_GATE_THRESHOLD_C;

    if (role === "unauthorized") {
      setAlertLevel(ResponseLevel.BLOCK);
      setLastCommand(`DITOLAK (${cmd} - PENYUSUP)`);
      try {
        await fetch(`http://${host}:8000/api/command`, {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify({
            requester: role,
            target_device: "esp32_gudang",
            command: cmd,
            reason: `Percobaan perintah ${cmd} tanpa token resmi`,
          }),
        });
      } catch {}
      return;
    }

    if (cmd === "FAN_OFF" && isHot) {
      handleTriggerScenario("SCN-03");
      return;
    }

    try {
      const res = await fetch(`http://${host}:8000/api/command`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({
          requester: role,
          target_device: "esp32_gudang",
          command: cmd,
          reason: `Perintah ${cmd} oleh ${role}`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.decision) {
          setActiveDecision(data.decision);
          if (data.decision.level !== undefined) {
            setAlertLevel(data.decision.level);
          }
          if (
            data.decision.action === "BLOCK_OR_HOLD" ||
            data.decision.action === "BLOCK_AND_HOLD"
          ) {
            setLastCommand("KEEP_SAFE (FAN_ON)");
            if (!hardwareConnectedRef.current) {
              setTelemetry((prev) =>
                prev
                  ? {
                      ...prev,
                      fan_reported: "ON",
                      current_ma: NOMINAL_FAN_CURRENT_MA,
                      interlock_active: true,
                    }
                  : null
              );
            }
            return;
          } else {
            setLastCommand(cmd);
          }
        }
        if (data.latest_telemetry && !hardwareConnectedRef.current) {
          setTelemetry(data.latest_telemetry as Telemetry);
        }
      }
    } catch (err) {
      console.error("Gagal mengirim perintah ke backend gateway:", err);
    }

    if (!hardwareConnectedRef.current) {
      if (cmd === "FAN_ON") {
        setLastCommand("FAN_ON");
        setAlertLevel(ResponseLevel.NONE);
        setTelemetry((prev) =>
          prev
            ? {
                ...prev,
                fan_reported: "ON",
                current_ma: NOMINAL_FAN_CURRENT_MA,
                interlock_active: false,
                failsafe_active: false,
              }
            : null
        );
        try {
          localStorage.setItem("patriot_fan_state", "ON");
        } catch {}
      } else if (cmd === "FAN_OFF") {
        setLastCommand("FAN_OFF");
        setTelemetry((prev) =>
          prev
            ? {
                ...prev,
                fan_reported: "OFF",
                current_ma: 0.0,
              }
            : null
        );
        try {
          localStorage.setItem("patriot_fan_state", "OFF");
        } catch {}
      }
    }
  };

  return (
    <div
      data-theme={effectiveTheme}
      className={`flex flex-col min-h-screen transition-colors duration-150 ${
        isLight
          ? isAnomaly
            ? "bg-[#F7EDED] text-[#1E293B]"
            : "bg-[#EEF2F6] text-[#1E293B]"
          : isAnomaly
          ? "bg-[#181215] text-[#E2E8F0]"
          : "bg-[#111722] text-[#E2E8F0]"
      }`}
    >
      <TacticalHeader
        activeView={activeView}
        onViewChange={handleViewChange}
        onTriggerDemo={handleStartSabotageDemo}
        theme={theme}
        onToggleTheme={toggleTheme}
        isAnomaly={isAnomaly || currentScenario !== "SCN-01"}
        isHardwareMode={hardwareConnected}
        onLockConsole={() => {
          try {
            sessionStorage.removeItem("patriot_session_auth");
          } catch {}
          setIsLocked(true);
        }}
      />

      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 py-5 flex flex-col gap-4">
        <div
          className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
            isLight ? "border-slate-200" : "border-slate-700/20"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`text-xs font-bold uppercase ${
                isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
              }`}
            >
              GUDANG AMUNISI
            </span>

            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-md uppercase ${
                currentScenario === "SCN-05" || alertLevel === ResponseLevel.QUARANTINE
                  ? "bg-red-500/20 text-[#D13B4B]"
                  : currentScenario === "SCN-04"
                  ? "bg-amber-500/20 text-amber-500"
                  : currentScenario === "SCN-03" || telemetry?.interlock_active
                  ? "bg-red-500/20 text-[#D13B4B]"
                  : currentScenario === "SCN-02"
                  ? "bg-amber-500/20 text-amber-500"
                  : lastCommand.includes("DISABOTASE") || lastCommand.includes("DITOLAK")
                  ? "bg-red-500/20 text-[#D13B4B]"
                  : "bg-[#2CA58D]/20 text-[#2CA58D]"
              }`}
            >
              {currentScenario === "SCN-05" || alertLevel === ResponseLevel.QUARANTINE
                ? "SERANGAN SPAM DIBLOKIR"
                : currentScenario === "SCN-04"
                ? "DATA SENSOR MENCURIGAKAN"
                : currentScenario === "SCN-03" || telemetry?.interlock_active
                ? "PENGAMAN SUHU AKTIF"
                : currentScenario === "SCN-02"
                ? "PERINGATAN SUHU NAIK CEPAT"
                : lastCommand.includes("DISABOTASE") || lastCommand.includes("DITOLAK")
                ? "PERINTAH PENYUSUP DITOLAK"
                : "KONDISI AMAN"}
            </span>
          </div>

          <div
            className={`flex items-center gap-2 text-xs ${
              isLight ? "text-[#475569]" : "text-[#94A3B8]"
            }`}
          >
            <span>Petugas:</span>
            <span
              className={`font-semibold ${
                isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
              }`}
            >
              {currentUser.name}
            </span>
            <span>•</span>
            <span
              className={`font-semibold ${
                currentUser.role === "unauthorized"
                  ? "text-[#D13B4B]"
                  : currentUser.role === "admin"
                  ? isLight
                    ? "text-[#2B5B9E]"
                    : "text-[#3B76D4]"
                  : "text-[#2CA58D]"
              }`}
            >
              {currentUser.roleLabel}
            </span>
          </div>
        </div>

        <div
          key="monitoring"
          className={
            activeView === "MONITORING"
              ? "flex flex-col gap-4 animate-fade-up"
              : "hidden"
          }
        >
          <InstrumentCluster
            telemetry={telemetry}
            alertLevel={alertLevel}
            safetyGateThreshold={SAFETY_GATE_THRESHOLD_C}
            theme={theme}
            isAnomaly={isAnomaly}
            tempHistory={telemetryHistory.map((p) => p.temp)}
            humHistory={telemetryHistory.map((p) => p.humidity)}
            currentHistory={telemetryHistory.map((p) => p.current)}
            isTampered={isTampered}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            <div className="lg:col-span-7 flex flex-col h-full">
              <CyberPhysicalProof
                telemetry={telemetry}
                lastCommand={lastCommand}
                alertLevel={alertLevel}
                theme={theme}
                isAnomaly={isAnomaly}
              />
            </div>

            <div className="lg:col-span-5 flex flex-col h-full">
              <CommandConsole
                currentTemp={telemetry?.temperature_c ?? BASELINE_TEMP_C}
                safetyThreshold={SAFETY_GATE_THRESHOLD_C}
                fanState={telemetry?.fan_reported ?? "ON"}
                onSendCommand={handleSendCommand}
                alertLevel={alertLevel}
                theme={theme}
                isAnomaly={isAnomaly}
                currentUser={currentUser}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            <div className="lg:col-span-6 flex flex-col">
              <TerminalFeed
                alertLevel={alertLevel}
                currentTemp={telemetry?.temperature_c ?? BASELINE_TEMP_C}
                currentMa={telemetry?.current_ma ?? 0.0}
                lastCommand={lastCommand}
                scenarioId={currentScenario}
                theme={theme}
                isAnomaly={isAnomaly}
              />
            </div>

            <div className="lg:col-span-6 flex flex-col">
              <LiveTelemetryChart
                telemetry={telemetry}
                alertLevel={alertLevel}
                safetyGateThreshold={SAFETY_GATE_THRESHOLD_C}
                theme={theme}
                isAnomaly={isAnomaly}
                history={telemetryHistory}
              />
            </div>
          </div>
        </div>

        <div
          key="benchmark"
          className={
            activeView === "BENCHMARK"
              ? "flex flex-col gap-6 animate-fade-up"
              : "hidden"
          }
        >
          <BenchmarkMatrix
            onTriggerScenario={handleTriggerScenario}
            currentScenario={currentScenario}
            activeDecision={activeDecision}
            theme={theme}
            isAnomaly={isAnomaly}
          />

          <CyberPhysicalProof
            telemetry={telemetry}
            lastCommand={lastCommand}
            alertLevel={alertLevel}
            theme={theme}
            isAnomaly={isAnomaly}
          />
        </div>

        <div
          key="forensic"
          className={
            activeView === "FORENSIC"
              ? "flex flex-col gap-6 animate-fade-up"
              : "hidden"
          }
        >
          <ForensicAuditViewer
            records={incidents}
            onTriggerTamper={() => setIsTampered(true)}
            onResetChain={() => setIsTampered(false)}
            isTampered={isTampered}
            theme={theme}
            isAnomaly={isAnomaly}
            currentUser={currentUser}
          />
        </div>
      </main>

      <footer
        className={`mt-auto border-t py-6 text-xs transition-colors duration-200 ${
          isAnomaly
            ? isLight
              ? "bg-[#FCF8F8] border-[#E7CCD1] text-[#1E293B]"
              : "bg-[#23191D] border-[#3D2930] text-[#E2E8F0]"
            : isLight
            ? "bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B]"
            : "bg-[#111722] border-[#222E42] text-[#E2E8F0]"
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <PatriotLogo className="w-5 h-5" />
            <span className="font-bold tracking-tight">PATRIOT-AD</span>
            <span className="hidden md:inline text-[#94A3B8]">
              | Platform Analisis Trafik &amp; Respons Infrastruktur Operasional Terpadu - Angkatan Darat · Tim yANDEre
            </span>
          </div>

          <div className="text-center sm:text-right text-xs text-[#94A3B8]">
            Pusat Pertahanan Siber &amp; Pengawasan Operasional Gudang Amunisi TNI-AD
          </div>
        </div>
      </footer>

      <TacticalLockScreen
        isOpen={isLocked}
        onAuthenticate={handleAuthenticate}
        theme={isLight ? "light" : "dark"}
      />

      {isLoading && !isLocked && (
        <TacticalLoadingScreen
          theme={theme}
          onComplete={() => setIsLoading(false)}
        />
      )}
    </div>
  );
}
