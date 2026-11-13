"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Telemetry, ResponseLevel } from "@/types";
import { Activity, Radio } from "lucide-react";

export interface TelemetryPoint {
  timeStr: string;
  temp: number;
  current: number;
  humidity: number;
}

export interface LiveTelemetryChartProps {
  telemetry: Telemetry | null;
  alertLevel: ResponseLevel;
  safetyGateThreshold?: number;
  theme?: "dark" | "light";
  isAnomaly?: boolean;
  history?: TelemetryPoint[];
}

// Undulating initial baseline to provide authentic live oscilloscope wave immediately on load
export const getDynamicInitialTelemetry = (): TelemetryPoint[] => {
  const now = Date.now();
  const points: TelemetryPoint[] = [];
  for (let i = 19; i >= 0; i--) {
    const d = new Date(now - i * 1500);
    const timeStr = d.toTimeString().split(" ")[0];
    const wave = Math.sin((20 - i) / 2) * 0.45;
    points.push({
      timeStr,
      temp: Math.round((30.2 + wave) * 10) / 10,
      current: Math.round((88.5 + Math.cos(i) * 1.5) * 10) / 10,
      humidity: 58.2,
    });
  }
  return points;
};

export const INITIAL_TELEMETRY_POINTS: TelemetryPoint[] = [
  { timeStr: "00:00:00", temp: 30.0, current: 88.5, humidity: 58.2 },
  { timeStr: "00:00:01", temp: 30.2, current: 89.2, humidity: 58.3 },
  { timeStr: "00:00:03", temp: 30.5, current: 90.1, humidity: 58.5 },
  { timeStr: "00:00:04", temp: 30.7, current: 89.6, humidity: 58.4 },
  { timeStr: "00:00:06", temp: 30.4, current: 88.2, humidity: 58.1 },
  { timeStr: "00:00:07", temp: 30.1, current: 87.5, humidity: 58.0 },
  { timeStr: "00:00:09", temp: 29.8, current: 87.8, humidity: 58.2 },
  { timeStr: "00:00:10", temp: 29.9, current: 88.5, humidity: 58.3 },
  { timeStr: "00:00:12", temp: 30.2, current: 89.4, humidity: 58.4 },
  { timeStr: "00:00:13", temp: 30.4, current: 90.0, humidity: 58.5 },
  { timeStr: "00:00:15", temp: 30.6, current: 89.1, humidity: 58.3 },
  { timeStr: "00:00:16", temp: 30.5, current: 88.3, humidity: 58.2 },
  { timeStr: "00:00:18", temp: 30.2, current: 88.0, humidity: 58.1 },
  { timeStr: "00:00:19", temp: 30.0, current: 88.7, humidity: 58.2 },
  { timeStr: "00:00:21", temp: 30.1, current: 89.2, humidity: 58.3 },
  { timeStr: "00:00:22", temp: 30.3, current: 88.9, humidity: 58.2 },
  { timeStr: "00:00:24", temp: 30.5, current: 88.4, humidity: 58.4 },
  { timeStr: "00:00:25", temp: 30.4, current: 88.6, humidity: 58.3 },
  { timeStr: "00:00:27", temp: 30.2, current: 88.5, humidity: 58.1 },
  { timeStr: "00:00:28", temp: 30.2, current: 88.5, humidity: 58.2 },
];

export default function LiveTelemetryChart({
  telemetry,
  alertLevel,
  safetyGateThreshold = 32.0,
  theme = "dark",
  isAnomaly = false,
  history,
}: LiveTelemetryChartProps) {
  const isLight = theme === "light";
  const [selectedChannel, setSelectedChannel] = useState<
    "both" | "temp" | "humidity" | "current"
  >("both");

  const currentTemp = telemetry?.temperature_c ?? 30.2;
  const currentMa = telemetry?.current_ma ?? 0.0;
  const currentHum = telemetry?.humidity_pct ?? 58.2;

  const [internalHistory, setInternalHistory] = useState<TelemetryPoint[]>(INITIAL_TELEMETRY_POINTS);
  const activeHistory = history || internalHistory;

  useEffect(() => {
    if (history) return;
    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = now.toTimeString().split(" ")[0];

      // Realistic sensor airflow wave + electrical motor ripple
      const t = Date.now() / 2500;
      const waveT = Math.sin(t) * 0.45;
      const waveI = Math.cos(t) * 2.2;
      const jitterT = (Math.random() - 0.5) * 0.08;
      const jitterI = (Math.random() - 0.5) * 0.6;
      const jitterH = (Math.random() - 0.5) * 0.2;

      const liveTemp = Math.round((currentTemp + waveT + jitterT) * 10) / 10;
      const liveCurrent =
        currentMa < 40 ? 0.0 : Math.round((currentMa + waveI + jitterI) * 10) / 10;
      const liveHum = Math.round((currentHum + jitterH) * 10) / 10;

      setInternalHistory((prev) => {
        const next = [...prev.slice(1)];
        next.push({
          timeStr,
          temp: liveTemp,
          current: liveCurrent,
          humidity: liveHum,
        });
        return next;
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [currentTemp, currentMa, currentHum, history]);

  const stats = useMemo(() => {
    if (activeHistory.length < 2) {
      return {
        dt_dt: "0.00",
        minT: currentTemp,
        maxT: currentTemp,
        avgCurrent: currentMa,
        avgHum: currentHum,
      };
    }
    const temps = activeHistory.map((p) => p.temp);
    const currents = activeHistory.map((p) => p.current);
    const hums = activeHistory.map((p) => p.humidity);

    const firstT = temps[0];
    const lastT = temps[temps.length - 1];
    const dt_dt = ((lastT - firstT) / (activeHistory.length * 1.5)).toFixed(2);

    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const avgCurrent =
      currents.reduce((acc, c) => acc + c, 0) / currents.length;
    const avgHum = hums.reduce((acc, h) => acc + h, 0) / hums.length;

    return { dt_dt, minT, maxT, avgCurrent, avgHum };
  }, [activeHistory, currentTemp, currentMa, currentHum]);

  const svgWidth = 600;
  const svgHeight = 180;
  const padding = { top: 18, right: 35, bottom: 25, left: 35 };

  const plotW = svgWidth - padding.left - padding.right;
  const plotH = svgHeight - padding.top - padding.bottom;

  // Focused dynamic range so normal +/-0.5°C variations are clearly visible waves (not flat!)
  const minTempScale = 25.0;
  const maxTempScale = 36.0;
  const minCurScale = 0;
  const maxCurScale = 120;
  const minHumScale = 30;
  const maxHumScale = 100;

  const getX = (idx: number) => {
    const total = activeHistory.length - 1 || 1;
    return padding.left + (idx / total) * plotW;
  };

  const getYTemp = (tempVal: number) => {
    const clamped = Math.max(minTempScale, Math.min(maxTempScale, tempVal));
    const ratio = (clamped - minTempScale) / (maxTempScale - minTempScale);
    return padding.top + plotH - ratio * plotH;
  };

  const getYCur = (curVal: number) => {
    const clamped = Math.max(minCurScale, Math.min(maxCurScale, curVal));
    const ratio = (clamped - minCurScale) / (maxCurScale - minCurScale);
    return padding.top + plotH - ratio * plotH;
  };

  const getYHum = (humVal: number) => {
    const clamped = Math.max(minHumScale, Math.min(maxHumScale, humVal));
    const ratio = (clamped - minHumScale) / (maxHumScale - minHumScale);
    return padding.top + plotH - ratio * plotH;
  };

  const tempPoints = useMemo(() => {
    return activeHistory
      .map((p, idx) => `${getX(idx).toFixed(1)},${getYTemp(p.temp).toFixed(1)}`)
      .join(" ");
  }, [activeHistory]);

  const currentPoints = useMemo(() => {
    return activeHistory
      .map((p, idx) => `${getX(idx).toFixed(1)},${getYCur(p.current).toFixed(1)}`)
      .join(" ");
  }, [activeHistory]);

  const humidityPoints = useMemo(() => {
    return activeHistory
      .map((p, idx) => `${getX(idx).toFixed(1)},${getYHum(p.humidity).toFixed(1)}`)
      .join(" ");
  }, [activeHistory]);

  const thresholdY = getYTemp(safetyGateThreshold);
  const isTempViolated = currentTemp >= safetyGateThreshold;

  const cardBg = isAnomaly
    ? isLight
      ? "bg-[#FCF8F8] border-[#E7CCD1] text-[#1E293B]"
      : "bg-[#23191D] border-[#3D2930] text-[#E2E8F0]"
    : isLight
    ? "bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B]"
    : "bg-[#192231] border-[#222E42] text-[#E2E8F0]";

  return (
    <div
      className={`rounded-xl border p-5 flex flex-col justify-between transition-colors shadow-sm ${cardBg}`}
    >
      {/* Title & Live Status Bar */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isLight ? "border-slate-200" : "border-slate-700/20"
      }`}>
        <div className="flex items-center gap-2.5">
          <Activity className={`w-5 h-5 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
          <div>
            <h3 className="text-lg font-bold tracking-tight">
              Grafik Suhu, Kelembapan &amp; Arus Kipas
            </h3>
            <p className={`text-xs ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>
              Pantauan langsung suhu gudang (°C), kelembapan (%RH), dan arus listrik kipas (mA)
            </p>
          </div>
        </div>

        {/* Channel Selector Toggle */}
        <div className="flex items-center gap-2">
          <div className={`flex items-center p-1 rounded-lg ${isLight ? "bg-[#E2E8F0]" : "bg-[#222E42]"}`}>
            <button
              onClick={() => setSelectedChannel("both")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                selectedChannel === "both"
                  ? isLight
                    ? "bg-[#2B5B9E] text-white shadow-sm"
                    : "bg-[#3B76D4] text-white shadow-sm"
                  : isLight
                  ? "text-[#475569] hover:text-[#1E293B]"
                  : "text-[#94A3B8] hover:text-[#E2E8F0]"
              }`}
            >
              Semua
            </button>
            <button
              onClick={() => setSelectedChannel("temp")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                selectedChannel === "temp"
                  ? isLight
                    ? "bg-[#2B5B9E] text-white shadow-sm"
                    : "bg-[#3B76D4] text-white shadow-sm"
                  : isLight
                  ? "text-[#475569] hover:text-[#1E293B]"
                  : "text-[#94A3B8] hover:text-[#E2E8F0]"
              }`}
            >
              Suhu
            </button>
            <button
              onClick={() => setSelectedChannel("humidity")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                selectedChannel === "humidity"
                  ? isLight
                    ? "bg-[#2B5B9E] text-white shadow-sm"
                    : "bg-[#3B76D4] text-white shadow-sm"
                  : isLight
                  ? "text-[#475569] hover:text-[#1E293B]"
                  : "text-[#94A3B8] hover:text-[#E2E8F0]"
              }`}
            >
              Kelembapan
            </button>
            <button
              onClick={() => setSelectedChannel("current")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                selectedChannel === "current"
                  ? isLight
                    ? "bg-[#2B5B9E] text-white shadow-sm"
                    : "bg-[#3B76D4] text-white shadow-sm"
                  : isLight
                  ? "text-[#475569] hover:text-[#1E293B]"
                  : "text-[#94A3B8] hover:text-[#E2E8F0]"
              }`}
            >
              Arus
            </button>
          </div>

          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#2CA58D]/15 text-[#2CA58D] text-xs font-bold">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>LIVE</span>
          </span>
        </div>
      </div>

      {/* SVG Chart Canvas */}
      <div className="w-full my-3 overflow-hidden">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-44 select-none overflow-visible"
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
            const y = padding.top + r * plotH;
            return (
              <line
                key={`grid-${i}`}
                x1={padding.left}
                y1={y}
                x2={svgWidth - padding.right}
                y2={y}
                stroke={isLight ? "#E2E8F0" : "#222E42"}
                strokeDasharray="3 3"
              />
            );
          })}

          {/* 32.0°C Safety Gate Interlock Threshold Line */}
          {(selectedChannel === "both" || selectedChannel === "temp") && (
            <g>
              <line
                x1={padding.left}
                y1={thresholdY}
                x2={svgWidth - padding.right}
                y2={thresholdY}
                stroke="#D13B4B"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <text
                x={svgWidth - padding.right}
                y={thresholdY - 4}
                textAnchor="end"
                className="text-[10px] font-bold fill-[#D13B4B]"
              >
                Batas Aman: {safetyGateThreshold.toFixed(1)}°C
              </text>
            </g>
          )}

          {/* Telemetry Curves */}
          {(selectedChannel === "both" || selectedChannel === "humidity") && (
            <polyline
              fill="none"
              stroke={isLight ? "#D97706" : "#F59E0B"}
              strokeWidth="2"
              strokeDasharray="5 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={humidityPoints}
            />
          )}

          {(selectedChannel === "both" || selectedChannel === "current") && (
            <polyline
              fill="none"
              stroke={isLight ? "#2B5B9E" : "#3B76D4"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={currentPoints}
            />
          )}

          {(selectedChannel === "both" || selectedChannel === "temp") && (
            <polyline
              fill="none"
              stroke={isTempViolated ? "#D13B4B" : "#2CA58D"}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={tempPoints}
            />
          )}

          {/* Current Live Dots */}
          {activeHistory.length > 0 && (
            <>
              {(selectedChannel === "both" || selectedChannel === "temp") && (
                <circle
                  cx={getX(activeHistory.length - 1)}
                  cy={getYTemp(activeHistory[activeHistory.length - 1].temp)}
                  r="4.5"
                  fill={isTempViolated ? "#D13B4B" : "#2CA58D"}
                  stroke={isLight ? "#FFFFFF" : "#192231"}
                  strokeWidth="2"
                />
              )}
              {(selectedChannel === "both" || selectedChannel === "humidity") && (
                <circle
                  cx={getX(activeHistory.length - 1)}
                  cy={getYHum(activeHistory[activeHistory.length - 1].humidity)}
                  r="4"
                  fill={isLight ? "#D97706" : "#F59E0B"}
                  stroke={isLight ? "#FFFFFF" : "#192231"}
                  strokeWidth="1.5"
                />
              )}
              {(selectedChannel === "both" || selectedChannel === "current") && (
                <circle
                  cx={getX(activeHistory.length - 1)}
                  cy={getYCur(activeHistory[activeHistory.length - 1].current)}
                  r="4"
                  fill={isLight ? "#2B5B9E" : "#3B76D4"}
                  stroke={isLight ? "#FFFFFF" : "#192231"}
                  strokeWidth="1.5"
                />
              )}
            </>
          )}

          {/* X-Axis Timestamps */}
          {activeHistory.length > 0 && (
            <>
              <text
                x={padding.left}
                y={svgHeight - 6}
                textAnchor="start"
                suppressHydrationWarning
                className={`font-mono text-xs ${isLight ? "fill-[#64748B]" : "fill-[#94A3B8]"}`}
              >
                {activeHistory[0].timeStr}
              </text>
              <text
                x={svgWidth - padding.right}
                y={svgHeight - 6}
                textAnchor="end"
                suppressHydrationWarning
                className={`font-mono text-xs font-bold ${isLight ? "fill-[#64748B]" : "fill-[#94A3B8]"}`}
              >
                {activeHistory[activeHistory.length - 1].timeStr}
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Operational Metrics Sub-strip: text-lg font-bold font-mono with proper light/dark contrast */}
      <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t ${
        isLight ? "border-slate-200" : "border-slate-700/20"
      }`}>
        <div className="flex flex-col">
          <span className={`text-xs uppercase font-semibold ${isLight ? "text-[#334155]" : "text-[#94A3B8]"}`}>
            Suhu Gudang
          </span>
          <span
            className={`text-lg font-bold font-mono tabular-nums ${
              isTempViolated
                ? "text-[#D13B4B]"
                : isLight
                ? "text-[#0F172A]"
                : "text-[#2CA58D]"
            }`}
          >
            {currentTemp.toFixed(1)} °C
          </span>
          <span className={`text-[11px] font-mono ${isLight ? "text-[#64748B]" : "text-[#94A3B8]"}`}>
            {stats.minT.toFixed(1)}° - {stats.maxT.toFixed(1)}°C ({stats.dt_dt}°/s)
          </span>
        </div>

        <div className="flex flex-col">
          <span className={`text-xs uppercase font-semibold ${isLight ? "text-[#334155]" : "text-[#94A3B8]"}`}>
            Kelembapan
          </span>
          <span className={`text-lg font-bold font-mono tabular-nums ${
            isLight ? "text-[#D97706]" : "text-[#F59E0B]"
          }`}>
            {currentHum.toFixed(1)} %RH
          </span>
          <span className={`text-[11px] font-mono ${isLight ? "text-[#64748B]" : "text-[#94A3B8]"}`}>
            Rata-rata: {stats.avgHum.toFixed(1)} %RH
          </span>
        </div>

        <div className="flex flex-col">
          <span className={`text-xs uppercase font-semibold ${isLight ? "text-[#334155]" : "text-[#94A3B8]"}`}>
            Arus Kipas
          </span>
          <span className={`text-lg font-bold font-mono tabular-nums ${
            isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"
          }`}>
            {currentMa.toFixed(1)} mA
          </span>
          <span className={`text-[11px] font-mono ${isLight ? "text-[#64748B]" : "text-[#94A3B8]"}`}>
            Rata-rata: {stats.avgCurrent.toFixed(1)} mA
          </span>
        </div>

        <div className="flex flex-col">
          <span className={`text-xs uppercase font-semibold ${isLight ? "text-[#334155]" : "text-[#94A3B8]"}`}>
            Pengaman Suhu
          </span>
          <span
            className={`text-base font-bold ${
              isTempViolated ? "text-[#D13B4B]" : "text-[#2CA58D]"
            }`}
          >
            {isTempViolated ? "AKTIF MENGUNCI" : "SIAGA NORMAL"}
          </span>
          <span className={`text-[11px] font-mono ${isLight ? "text-[#64748B]" : "text-[#94A3B8]"}`}>
            Batas Interlock: {safetyGateThreshold.toFixed(1)} °C
          </span>
        </div>
      </div>
    </div>
  );
}
