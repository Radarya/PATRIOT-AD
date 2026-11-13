"use client";

import React from "react";
import { Telemetry, ResponseLevel } from "@/types";
import { Server, Cpu, Zap, ArrowRight, ShieldCheck } from "lucide-react";

interface CyberPhysicalProofProps {
  telemetry: Telemetry | null;
  lastCommand: string;
  alertLevel: ResponseLevel;
  theme?: "dark" | "light";
  isAnomaly?: boolean;
}

export default function CyberPhysicalProof({
  telemetry,
  lastCommand,
  alertLevel,
  theme = "dark",
  isAnomaly = false,
}: CyberPhysicalProofProps) {
  const isLight = theme === "light";
  const isCurrentConnected =
    telemetry?.current_ma !== null && telemetry?.current_ma !== undefined;
  const current = telemetry?.current_ma ?? 0.0;
  const isDrawingCurrent = isCurrentConnected && current >= 40.0;
  const reportedOn = telemetry?.fan_reported === "ON";
  const expectedOn =
    lastCommand === "FAN_ON" ||
    lastCommand.includes("FAN_ON") ||
    lastCommand.includes("KEEP_SAFE") ||
    lastCommand.includes("ALERT") ||
    lastCommand.includes("ANOMALI") ||
    lastCommand.includes("AUDIT") ||
    lastCommand.includes("REPLAY") ||
    lastCommand.includes("QUARANTINE");

  // Jika sensor arus INA226 belum terpasang, bukti fisik tidak tersedia:
  // kesesuaian hanya dinilai antara perintah dan status relai (jujur, tanpa angka rekaan).
  const isMatched = isCurrentConnected
    ? (expectedOn && reportedOn && isDrawingCurrent) ||
      (!expectedOn && !reportedOn && !isDrawingCurrent)
    : expectedOn === reportedOn;

  const isCurrentMismatch =
    isCurrentConnected &&
    ((expectedOn && !isDrawingCurrent) || (!expectedOn && !reportedOn && isDrawingCurrent));

  const cardBg = isAnomaly
    ? isLight
      ? "bg-[#FCF8F8] border-[#E7CCD1] text-[#1E293B]"
      : "bg-[#23191D] border-[#3D2930] text-[#E2E8F0]"
    : isLight
    ? "bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B]"
    : "bg-[#192231] border-[#222E42] text-[#E2E8F0]";

  const nodeBg = isAnomaly
    ? isLight
      ? "bg-[#F0DFE2] border border-[#E7CCD1]"
      : "bg-[#302026]"
    : isLight
    ? "bg-[#EEF2F6] border border-[#E2E8F0]"
    : "bg-[#222E42]";

  const formatCommandLabel = (cmd: string) => {
    if (cmd.includes("DITOLAK")) return "Perintah Penyusup Ditolak";
    if (cmd.includes("QUARANTINE")) return "Pengirim Diblokir";
    if (cmd.includes("REPLAY") || cmd.includes("AUDIT")) return "Data Palsu Terdeteksi";
    if (cmd.includes("KEEP_SAFE")) return "Kipas Dikunci Nyala";
    if (cmd.includes("DISABOTASE")) return "Sabotase Matikan Kipas";
    if (cmd.includes("ANOMALI") || cmd.includes("ALERT")) return "Peringatan Suhu Naik Cepat";
    if (cmd === "FAN_ON") return "Nyalakan Kipas";
    if (cmd === "FAN_OFF") return "Matikan Kipas";
    return cmd;
  };

  return (
    <div
      className={`h-full rounded-xl border p-5 flex flex-col justify-between transition-colors shadow-sm ${cardBg}`}
    >
      {/* Title & Pipeline Header Bar */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isLight ? "border-slate-200" : "border-slate-700/20"
      }`}>
        <div className="flex items-center gap-2.5">
          <ShieldCheck
            className={`w-5 h-5 ${
              isMatched
                ? "text-[#2CA58D]"
                : isLight
                ? "text-[#B82E3E]"
                : "text-[#D13B4B]"
            }`}
          />
          <div>
            <h3 className="text-lg font-bold tracking-tight">
              Pemeriksaan Kesesuaian Perintah &amp; Fisik
            </h3>
            <p className={`text-xs ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>
              Memastikan perintah di pos jaga sesuai dengan putaran kipas di gudang
            </p>
          </div>
        </div>

        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-md uppercase ${
            alertLevel === ResponseLevel.QUARANTINE
              ? isLight
                ? "bg-red-500/20 text-[#B82E3E]"
                : "bg-red-500/20 text-[#D13B4B]"
              : lastCommand.includes("REPLAY")
              ? "bg-amber-500/20 text-amber-500"
              : isMatched
              ? "bg-[#2CA58D]/20 text-[#2CA58D]"
              : isLight
              ? "bg-red-500/20 text-[#B82E3E]"
              : "bg-red-500/20 text-[#D13B4B]"
          }`}
        >
          {alertLevel === ResponseLevel.QUARANTINE
            ? "PENGIRIM DIBLOKIR"
            : lastCommand.includes("REPLAY")
            ? "DATA SENSOR MENCURIGAKAN"
            : isMatched
            ? "SESUAI & AMAN"
            : "TIDAK SESUAI"}
        </span>
      </div>

      {/* Triangulation Pipeline Nodes */}
      <div className="py-4">
        <div className="grid grid-cols-1 md:grid-cols-11 gap-2 items-center">
          {/* Node 1: Gateway Policy */}
          <div className={`md:col-span-3 rounded-lg p-3.5 ${nodeBg} flex flex-col justify-between min-h-[92px]`}>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-semibold uppercase ${
                isLight ? "text-[#64748B]" : "text-[#94A3B8]"
              }`}>
                1. PERINTAH SISTEM
              </span>
              <Server className={`w-4 h-4 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
            </div>
            <div className={`text-sm font-bold my-1 ${
              isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
            }`}>
              {formatCommandLabel(lastCommand)}
            </div>
            <span className={`text-xs ${isLight ? "text-[#64748B]" : "text-[#94A3B8]"}`}>
              Keputusan Pos Jaga
            </span>
          </div>

          {/* Connector Line 1 */}
          <div className="md:col-span-1 hidden md:flex items-center justify-center">
            <div className="relative w-full flex items-center justify-center">
              <div className={`w-full h-[2px] ${
                isLight ? "bg-[#2B5B9E]/30" : "bg-[#3B76D4]/30"
              }`} />
              <ArrowRight className={`w-4 h-4 shrink-0 -ml-1 ${
                isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"
              }`} />
            </div>
          </div>

          {/* Node 2: ESP32 Register State */}
          <div className={`md:col-span-3 rounded-lg p-3.5 ${nodeBg} flex flex-col justify-between min-h-[92px]`}>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-semibold uppercase ${
                isLight ? "text-[#64748B]" : "text-[#94A3B8]"
              }`}>
                2. SAKLAR KIPAS
              </span>
              <Cpu className={`w-4 h-4 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
            </div>
            <div
              className={`text-sm font-bold my-1 ${
                reportedOn
                  ? "text-[#2CA58D]"
                  : isLight
                  ? "text-[#64748B]"
                  : "text-[#94A3B8]"
              }`}
            >
              {reportedOn ? "Menyala" : "Mati"}
            </div>
            <span className={`text-xs ${isLight ? "text-[#64748B]" : "text-[#94A3B8]"}`}>
              Status Relai Alat
            </span>
          </div>

          {/* Connector Line 2 */}
          <div className="md:col-span-1 hidden md:flex items-center justify-center">
            <div className="relative w-full flex items-center justify-center">
              <div className="w-full h-[2px] bg-[#2CA58D]/30" />
              <ArrowRight className="w-4 h-4 text-[#2CA58D] shrink-0 -ml-1" />
            </div>
          </div>

          {/* Node 3: INA226 Physical Proof */}
          <div
            className={`md:col-span-3 rounded-lg p-3.5 flex flex-col justify-between min-h-[92px] ${
              isCurrentMismatch
                ? isLight
                  ? "bg-red-500/10 text-[#B82E3E] border border-red-200"
                  : "bg-red-950/30 text-[#D13B4B] border border-red-800/40"
                : nodeBg
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-semibold uppercase ${
                isLight ? "text-[#64748B]" : "text-[#94A3B8]"
              }`}>
                3. ARUS LISTRIK
              </span>
              <Zap
                className={`w-4 h-4 ${
                  isCurrentMismatch
                    ? isLight
                      ? "text-[#B82E3E]"
                      : "text-[#D13B4B]"
                    : isDrawingCurrent
                    ? "text-[#2CA58D]"
                    : isLight
                    ? "text-[#64748B]"
                    : "text-[#94A3B8]"
                }`}
              />
            </div>
            <div
              className={`text-sm font-bold font-mono my-1 tabular-nums ${
                isCurrentMismatch || !isCurrentConnected
                  ? isLight
                    ? "text-[#B82E3E]"
                    : "text-[#D13B4B]"
                  : isDrawingCurrent
                  ? "text-[#2CA58D]"
                  : isLight
                  ? "text-[#64748B]"
                  : "text-[#94A3B8]"
              }`}
            >
              {isCurrentConnected ? `${current.toFixed(1)} mA` : "Sensor INA226 belum terpasang"}
            </div>
            <span className={`text-xs ${isLight ? "text-[#64748B]" : "text-[#94A3B8]"}`}>
              {!isCurrentConnected
                ? "Bukti arus tidak tersedia"
                : isDrawingCurrent
                ? "Kipas Fisik Berputar"
                : "Tidak Ada Arus / Tidak Berputar"}
            </span>
          </div>
        </div>
      </div>

      {/* Footer Diagnostic Message */}
      <div className={`pt-3 border-t flex items-center justify-between text-xs ${
        isLight ? "border-slate-200 text-[#475569]" : "border-slate-700/20 text-[#94A3B8]"
      }`}>
        <span className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isMatched ? "bg-[#2CA58D]" : isLight ? "bg-[#B82E3E]" : "bg-[#D13B4B]"
            }`}
          />
          {isMatched
            ? "Perintah sistem dan putaran fisik kipas di gudang sudah sesuai."
            : "Peringatan: Perintah sistem tidak sesuai dengan kondisi fisik kipas!"}
        </span>
      </div>
    </div>
  );
}
