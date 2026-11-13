"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Telemetry, ResponseLevel } from "@/types";
import { Thermometer, Droplets, Zap, ShieldCheck, ShieldAlert } from "lucide-react";

interface InstrumentClusterProps {
  telemetry: Telemetry | null;
  alertLevel: ResponseLevel;
  safetyGateThreshold: number;
  theme?: "dark" | "light";
  isAnomaly?: boolean;
  tempHistory?: number[];
  humHistory?: number[];
  currentHistory?: number[];
  isTampered?: boolean;
}

// Helper SVG Sparkline Component (Ultra-lightweight, zero-slop, native SVG)
function SparklineArea({
  data,
  color,
  fillId,
  height = 36,
  domain,
}: {
  data: number[];
  color: string;
  fillId: string;
  height?: number;
  domain?: [number, number];
}) {
  const min = domain ? domain[0] : Math.min(...data);
  const max = domain ? domain[1] : Math.max(...data);
  const range = max - min || 1;
  const width = 160;

  const points = data
    .map((val, idx) => {
      const clamped = Math.max(min, Math.min(max, val));
      const x = (idx / (data.length - 1 || 1)) * width;
      const y = height - ((clamped - min) / range) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const areaD = `M 0,${height} L ${points} L ${width},${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-9 overflow-hidden"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${fillId})`} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default function InstrumentCluster({
  telemetry,
  alertLevel,
  safetyGateThreshold = 32.0,
  theme = "dark",
  isAnomaly = false,
  tempHistory,
  humHistory,
  currentHistory,
  isTampered = false,
}: InstrumentClusterProps) {
  const isLight = theme === "light";
  const temp = telemetry?.temperature_c ?? 0.0;
  const humidity = telemetry?.humidity_pct ?? 0.0;
  const isCurrentConnected =
    telemetry?.current_ma !== null && telemetry?.current_ma !== undefined;
  const current = telemetry?.current_ma ?? 0.0;

  const isTempCritical = temp >= safetyGateThreshold;
  const isTempNear = temp >= safetyGateThreshold - 1.5 && !isTempCritical;
  const isTempLow = temp < 15.0;

  const isHighHumidity = humidity > 65.0; // Standar munisi: >65% memicu korosi selongsong & degradasi propelan
  const isLowHumidity = humidity < 40.0;

  // Real-time dynamic rolling history for sparklines (fallback when not passed from parent)
  const [internalTemp, setInternalTemp] = useState<number[]>([
    temp - 0.05, temp, temp - 0.02, temp + 0.05, temp, temp - 0.03, temp + 0.04, temp
  ]);
  const [internalHum, setInternalHum] = useState<number[]>([
    humidity - 0.1, humidity, humidity + 0.1, humidity, humidity - 0.05, humidity + 0.05, humidity
  ]);
  const [internalCurr, setInternalCurr] = useState<number[]>([
    current - 0.2, current, current + 0.3, current, current - 0.1, current + 0.2, current
  ]);

  useEffect(() => {
    if (!tempHistory) {
      setInternalTemp((prev) => [...prev.slice(1), temp]);
    }
  }, [temp, tempHistory]);

  useEffect(() => {
    if (!humHistory) {
      setInternalHum((prev) => [...prev.slice(1), humidity]);
    }
  }, [humidity, humHistory]);

  useEffect(() => {
    if (!currentHistory) {
      setInternalCurr((prev) => [...prev.slice(1), current]);
    }
  }, [current, currentHistory]);

  const activeTempHistory = useMemo(() => {
    if (tempHistory && tempHistory.length >= 2) return tempHistory;
    return internalTemp;
  }, [tempHistory, internalTemp]);

  const activeHumHistory = useMemo(() => {
    if (humHistory && humHistory.length >= 2) return humHistory;
    return internalHum;
  }, [humHistory, internalHum]);

  const activeCurrentHistory = useMemo(() => {
    if (currentHistory && currentHistory.length >= 2) return currentHistory;
    return internalCurr;
  }, [currentHistory, internalCurr]);

  // Card background and surface styles conforming to Low-Eye-Strain palette
  const cardBg = isAnomaly
    ? isLight
      ? "bg-[#FCF8F8] border-[#E7CCD1] text-[#1E293B]"
      : "bg-[#23191D] border-[#3D2930] text-[#E2E8F0]"
    : isLight
    ? "bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B]"
    : "bg-[#192231] border-[#222E42] text-[#E2E8F0]";

  const subSurfaceBg = isAnomaly
    ? isLight
      ? "bg-[#F0DFE2]/70"
      : "bg-[#302026]"
    : isLight
    ? "bg-[#E2E8F0]/70"
    : "bg-[#222E42]";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Suhu Gudang (DHT22) */}
      <div
        className={`rounded-xl p-5 border flex flex-col justify-between transition-colors shadow-sm ${cardBg} ${
          isTempCritical
            ? isLight
              ? "border-t-4 border-t-[#B82E3E]"
              : "border-t-4 border-t-[#D13B4B]"
            : isTempNear
            ? "border-t-4 border-t-amber-500"
            : isLight
            ? "border-t-4 border-t-[#2B5B9E]"
            : "border-t-4 border-t-[#3B76D4]"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Thermometer
              className={`w-4 h-4 ${
                isTempCritical
                  ? isLight
                    ? "text-[#B82E3E]"
                    : "text-[#D13B4B]"
                  : isTempNear
                  ? "text-amber-500"
                  : "text-[#3B76D4]"
              }`}
            />
            <span className="text-xs font-semibold">
              Suhu Gudang
            </span>
          </div>

          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md uppercase ${
              isTempCritical
                ? "bg-red-500/20 text-[#D13B4B]"
                : isTempNear
                ? "bg-amber-500/20 text-amber-500"
                : isTempLow
                ? "bg-cyan-500/20 text-cyan-400"
                : "bg-[#2CA58D]/20 text-[#2CA58D]"
            }`}
          >
            {isTempCritical
              ? "PANAS"
              : isTempNear
              ? "WASPADA"
              : isTempLow
              ? "DINGIN"
              : "AMAN"}
          </span>
        </div>

        <div className="my-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-3xl font-extrabold font-mono tracking-tight tabular-nums ${
                isTempCritical
                  ? isLight
                    ? "text-[#B82E3E]"
                    : "text-[#D13B4B]"
                  : isTempNear
                  ? "text-amber-500"
                  : isLight
                  ? "text-[#1E293B]"
                  : "text-[#E2E8F0]"
              }`}
            >
              {temp.toFixed(1)}
            </span>
            <span className="text-xs text-[#94A3B8] font-semibold">°C</span>
          </div>

          <div className="w-24">
            <SparklineArea
              data={activeTempHistory}
              color={
                isTempCritical
                  ? isLight
                    ? "#B82E3E"
                    : "#D13B4B"
                  : isTempNear
                  ? "#D97706"
                  : isTempLow
                  ? "#0284C7"
                  : "#2CA58D"
              }
              fillId="grad-temp"
              domain={[10.0, 38.0]}
            />
          </div>
        </div>

        {/* Progress Bar with Precision 32.0°C Interlock Marker Tick */}
        <div className="space-y-1.5">
          <div className={`relative w-full h-2 rounded-full overflow-hidden ${subSurfaceBg}`}>
            {/* 32.0°C Interlock Marker Line (71.1% of 45°C scale) */}
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-[#D13B4B] z-10"
              style={{ left: "71.1%" }}
              title="Garis Ambang Interlock: 32.0°C"
            />
            <div
              className={`h-full transition-[width] duration-300 rounded-full ${
                isTempCritical
                  ? "bg-[#D13B4B]"
                  : isTempNear
                  ? "bg-amber-500"
                  : isTempLow
                  ? "bg-cyan-500"
                  : "bg-[#2CA58D]"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, (temp / 45) * 100))}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-xs text-[#94A3B8]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D13B4B] inline-block" />
              <span>Batas Aman: 32.0°C</span>
            </span>
            <span>Maks: 45°C</span>
          </div>
        </div>
      </div>

      {/* 2. Kelembapan Udara */}
      <div
        className={`rounded-xl p-5 border flex flex-col justify-between transition-colors shadow-sm ${cardBg} ${
          isHighHumidity
            ? "border-t-4 border-t-amber-500"
            : isLight
            ? "border-t-4 border-t-[#2B5B9E]"
            : "border-t-4 border-t-[#3B76D4]"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Droplets
              className={`w-4 h-4 ${
                isHighHumidity ? "text-amber-500" : "text-[#3B76D4]"
              }`}
            />
            <span className="text-xs font-semibold">
              Kelembapan Udara
            </span>
          </div>

          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md uppercase ${
              isHighHumidity
                ? "bg-amber-500/20 text-amber-500"
                : isLowHumidity
                ? "bg-cyan-500/20 text-cyan-400"
                : "bg-[#2CA58D]/20 text-[#2CA58D]"
            }`}
          >
            {isHighHumidity
              ? "LEMBAP (WASPADA)"
              : isLowHumidity
              ? "KERING"
              : "STANDAR"}
          </span>
        </div>

        <div className="my-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-3xl font-extrabold font-mono tracking-tight tabular-nums ${
                isHighHumidity
                  ? "text-amber-500"
                  : isLight
                  ? "text-[#1E293B]"
                  : "text-[#E2E8F0]"
              }`}
            >
              {humidity.toFixed(1)}
            </span>
            <span className="text-xs text-[#94A3B8] font-semibold">%RH</span>
          </div>

          <div className="w-24">
            <SparklineArea
              data={activeHumHistory}
              color={isHighHumidity ? "#D97706" : isLight ? "#2B5B9E" : "#3B76D4"}
              fillId="grad-hum"
              domain={[40.0, 95.0]}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className={`w-full h-2 rounded-full overflow-hidden ${subSurfaceBg}`}>
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                isHighHumidity
                  ? "bg-amber-500"
                  : isLight
                  ? "bg-[#2B5B9E]"
                  : "bg-[#3B76D4]"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, humidity))}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-xs text-[#94A3B8]">
            <span>Standar: 40–60% RH</span>
            <span>Batas Aman: &le;65%</span>
          </div>
        </div>
      </div>

      {/* 3. Arus Beban Kipas (INA226) */}
      <div
        className={`rounded-xl p-5 border flex flex-col justify-between transition-colors shadow-sm ${cardBg} ${
          isAnomaly
            ? isLight
              ? "border-t-4 border-t-[#B82E3E]"
              : "border-t-4 border-t-[#D13B4B]"
            : current >= 40.0
            ? "border-t-4 border-t-[#2CA58D]"
            : "border-t-4 border-t-slate-500"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap
              className={`w-4 h-4 ${
                isAnomaly
                  ? isLight
                    ? "text-[#B82E3E]"
                    : "text-[#D13B4B]"
                  : current >= 40.0
                  ? "text-[#2CA58D]"
                  : "text-[#94A3B8]"
              }`}
            />
            <span className="text-xs font-semibold">
              Arus Kipas
            </span>
          </div>

          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md uppercase ${
              isAnomaly
                ? "bg-red-500/20 text-[#D13B4B]"
                : !isCurrentConnected
                ? "bg-amber-500/20 text-amber-500"
                : current >= 40.0
                ? "bg-[#2CA58D]/20 text-[#2CA58D]"
                : "bg-slate-500/20 text-[#94A3B8]"
            }`}
          >
            {!isCurrentConnected
              ? "BELUM TERDETEKSI"
              : current >= 40.0
              ? "MENYALA"
              : "MATI"}
          </span>
        </div>

        <div className="my-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-3xl font-extrabold font-mono tracking-tight tabular-nums ${
                isAnomaly
                  ? isLight
                    ? "text-[#B82E3E]"
                    : "text-[#D13B4B]"
                  : isLight
                  ? "text-[#1E293B]"
                  : "text-[#E2E8F0]"
              }`}
            >
              {current.toFixed(1)}
            </span>
            <span className="text-xs text-[#94A3B8] font-semibold">mA</span>
          </div>

          <div className="w-24">
            <SparklineArea
              data={activeCurrentHistory}
              color={
                isAnomaly
                  ? isLight
                    ? "#B82E3E"
                    : "#D13B4B"
                  : "#2CA58D"
              }
              fillId="grad-curr"
              domain={[0, 120.0]}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className={`w-full h-2 rounded-full overflow-hidden ${subSurfaceBg}`}>
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                isAnomaly
                  ? "bg-[#D13B4B]"
                  : "bg-[#2CA58D]"
              }`}
              style={{ width: `${Math.min(100, (current / 150) * 100)}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-xs text-[#94A3B8]">
            <span>Aktif: &gt;40 mA</span>
            <span>Normal: 85-110 mA</span>
          </div>
        </div>
      </div>

      {/* 4. Keamanan Catatan Forensik */}
      <div
        className={`rounded-xl p-5 border flex flex-col justify-between transition-colors shadow-sm ${cardBg} ${
          isTampered
            ? isLight
              ? "border-t-4 border-t-[#B82E3E]"
              : "border-t-4 border-t-[#D13B4B]"
            : "border-t-4 border-t-[#2CA58D]"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isTampered ? (
              <ShieldAlert className="w-4 h-4 text-[#D13B4B]" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-[#2CA58D]" />
            )}
            <span className="text-xs font-semibold">
              Keamanan Catatan
            </span>
          </div>

          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md uppercase ${
              isTampered
                ? "bg-red-500/20 text-[#D13B4B]"
                : "bg-[#2CA58D]/20 text-[#2CA58D]"
            }`}
          >
            {isTampered ? "DIUBAH" : "ASLI"}
          </span>
        </div>

        <div className="my-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-3xl font-extrabold font-mono tracking-tight tabular-nums ${
                isTampered
                  ? isLight
                    ? "text-[#B82E3E]"
                    : "text-[#D13B4B]"
                  : isLight
                  ? "text-[#1E293B]"
                  : "text-[#E2E8F0]"
              }`}
            >
              {isTampered ? "40%" : "100%"}
            </span>
            <span
              className={`text-xs font-bold ${
                isTampered
                  ? isLight
                    ? "text-[#B82E3E]"
                    : "text-[#D13B4B]"
                  : "text-[#2CA58D]"
              }`}
            >
              {isTampered ? "RUSAK" : "UTUH"}
            </span>
          </div>

          {/* Segmented dot indicators */}
          <div
            className={`text-xs font-extrabold font-mono ${
              isTampered ? "text-[#D13B4B]" : "text-[#2CA58D]"
            }`}
          >
            {isTampered ? "● ● ○ ○ ○" : "● ● ● ● ●"}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className={`w-full h-2 rounded-full overflow-hidden ${subSurfaceBg}`}>
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                isTampered
                  ? "w-[40%] bg-[#D13B4B]"
                  : "w-full bg-[#2CA58D]"
              }`}
            />
          </div>

          <div className="flex justify-between items-center text-xs text-[#94A3B8]">
            <span>{isTampered ? "Catatan #3 tidak cocok" : "Terkunci SHA-256"}</span>
            <span>{isTampered ? "Data Diubah" : "Data Utuh"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
