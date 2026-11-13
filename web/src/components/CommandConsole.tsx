"use client";

import React, { useState } from "react";
import { FanCommand, ResponseLevel, TacticalUser } from "@/types";
import { Power, ShieldAlert, CheckCircle2, Sliders, UserCheck, ClipboardList } from "lucide-react";

interface CommandConsoleProps {
  currentTemp: number;
  safetyThreshold: number;
  fanState: "ON" | "OFF";
  onSendCommand: (cmd: FanCommand, role: string) => Promise<void>;
  alertLevel: ResponseLevel;
  theme?: "dark" | "light";
  isAnomaly?: boolean;
  currentUser?: TacticalUser | null;
}

export default function CommandConsole({
  currentTemp,
  safetyThreshold = 32.0,
  fanState,
  onSendCommand,
  alertLevel,
  theme = "dark",
  isAnomaly = false,
  currentUser,
}: CommandConsoleProps) {
  const isLight = theme === "light";
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    status: "APPROVED" | "BLOCKED";
    message: string;
  } | null>(null);

  const isFanOn = fanState === "ON";
  const isHot = currentTemp >= safetyThreshold;
  const userRole = currentUser?.role ?? "operator";
  const isUnauthorized = userRole === "unauthorized";

  const handleCommand = async (cmd: FanCommand) => {
    setLoading(true);
    setFeedback(null);
    try {
      await onSendCommand(cmd, userRole);
      if (isUnauthorized) {
        setFeedback({
          status: "BLOCKED",
          message: `AKSES DITOLAK: Perintah dari akun Penyusup langsung diblokir oleh sistem dan dicatat ke Catatan Forensik.`,
        });
      } else if (cmd === "FAN_OFF" && isHot) {
        setFeedback({
          status: "BLOCKED",
          message: `DITOLAK PENGAMAN SUHU: Suhu gudang saat ini ${currentTemp.toFixed(
            1
          )}°C sudah melewati batas aman ${safetyThreshold.toFixed(
            1
          )}°C. Kipas dikunci tetap menyala demi keamanan amunisi.`,
        });
      } else if (cmd === "FAN_OFF") {
        setFeedback({
          status: "APPROVED",
          message:
            userRole === "admin"
              ? `Perwira Pengawas mematikan kipas pendingin.`
              : `Operator Piket mematikan kipas karena suhu gudang aman di bawah ${safetyThreshold.toFixed(
                  1
                )}°C.`,
        });
      } else {
        setFeedback({
          status: "APPROVED",
          message:
            userRole === "admin"
              ? `Perwira Pengawas menyalakan kipas pendingin.`
              : `Operator Piket menyalakan kipas pendingin.`,
        });
      }
    } catch {
      setFeedback({
        status: "APPROVED",
        message: `Perintah diteruskan ke alat pengendali.`,
      });
    } finally {
      setLoading(false);
    }
  };

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
    <div
      className={`h-full rounded-xl border p-5 flex flex-col justify-between transition-colors shadow-sm ${cardBg}`}
    >
      {/* Header Bar */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isLight ? "border-slate-200" : "border-slate-700/20"
      }`}>
        <div className="flex items-center gap-2.5">
          <Sliders className={`w-5 h-5 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
          <div>
            <h3 className="text-lg font-bold tracking-tight">
              Kendali Kipas Gudang
            </h3>
            <p className={`text-xs ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>
              Kontrol manual kipas pendingin dengan pengaman suhu otomatis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-xs ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>Status Kipas:</span>
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-md uppercase ${
              isFanOn
                ? "bg-[#2CA58D]/20 text-[#2CA58D]"
                : "bg-slate-500/20 text-[#94A3B8]"
            }`}
          >
            {isFanOn ? "MENYALA" : "MATI"}
          </span>
        </div>
      </div>

      {/* Panel Ringkasan: Petugas Piket */}
      <div className={`my-3 p-3.5 rounded-lg ${subSurfaceBg}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <UserCheck className={`w-4 h-4 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
            <span className={`text-xs font-bold uppercase ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>
              PETUGAS PIKET AKTIF
            </span>
          </div>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-md ${
              isUnauthorized
                ? "bg-red-500/20 text-[#D13B4B]"
                : userRole === "admin"
                ? isLight
                  ? "bg-[#2B5B9E]/20 text-[#2B5B9E]"
                  : "bg-[#3B76D4]/20 text-[#3B76D4]"
                : "bg-[#2CA58D]/20 text-[#2CA58D]"
            }`}
          >
            {currentUser?.roleLabel ?? "Operator Piket"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <span className={`block ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>Nama Personel:</span>
            <span className={`font-semibold ${isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"}`}>
              {currentUser?.name ?? "Sertu Fulan"}
            </span>
          </div>
          <div>
            <span className={`block ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>NRP:</span>
            <span className={`font-mono font-semibold ${isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"}`}>
              {currentUser?.nrp ?? "3112009871"}
            </span>
          </div>
        </div>
      </div>

      {/* Panduan Tindakan Piket (Muncul saat suhu kritis, serangan penyusup, atau peringatan darurat) */}
      {(isHot || alertLevel > ResponseLevel.NONE || isUnauthorized || feedback?.status === "BLOCKED") && (
        <div
          className={`mb-3 p-3 rounded-lg text-xs flex items-start gap-2.5 border transition-colors ${
            isLight
              ? "bg-amber-50 text-[#92400E] border-amber-300"
              : "bg-amber-950/30 text-amber-300 border-amber-700/40"
          }`}
        >
          <ClipboardList className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
          <div className="leading-relaxed">
            <span className="font-bold block">Panduan Tindakan Piket:</span>
            <span>
              {isHot
                ? "Suhu gudang melewati batas aman 32,0°C dan kipas telah dikunci menyala otomatis. Pantau penurunan suhu hingga di bawah 31,0°C lalu cetak laporan di menu Catatan Forensik."
                : "Perintah mencurigakan telah ditolak otomatis oleh sistem. Periksa sumber gangguan di menu Catatan Forensik lalu cetak laporan kejadian untuk Perwira Pengawas."}
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons: Mutually Exclusive Logic */}
      <div className="space-y-2.5">
        {isUnauthorized && (
          <div className={`p-3 rounded-lg text-xs font-medium flex items-start gap-2.5 border transition-colors ${
            isLight
              ? "bg-red-50 text-[#B82E3E] border-red-200"
              : "bg-red-950/40 text-[#D13B4B] border-red-900/50"
          }`}>
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#D13B4B]" />
            <div>
              <span className="font-bold block">Mode Penyusup Aktif</span>
              <span className="block mt-0.5 opacity-90 leading-relaxed">
                Tombol sengaja dibuka untuk uji serangan. Setiap perintah dari akun ini akan ditolak oleh sistem dan dicatat sebagai pelanggaran.
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          {/* Nyalakan Kipas: Active unless already ON (or active for intruder test) */}
          <button
            onClick={() => handleCommand("FAN_ON")}
            disabled={loading || (isFanOn && !isUnauthorized)}
            className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 shadow-sm ${
              isUnauthorized
                ? "bg-red-500/15 hover:bg-red-500/25 text-[#D13B4B] border border-red-500/30 active:scale-[0.98]"
                : isFanOn
                ? "bg-[#222E42]/40 text-[#94A3B8]/40 cursor-not-allowed"
                : isLight
                ? "bg-[#2B5B9E] hover:bg-[#234B82] text-white active:scale-[0.98]"
                : "bg-[#3B76D4] hover:bg-[#3467BC] text-white active:scale-[0.98]"
            }`}
          >
            <Power className="w-4 h-4" />
            <span>Nyalakan Kipas</span>
          </button>

          {/* Matikan Kipas: Active when fan is ON, or active for intruder test */}
          <button
            onClick={() => handleCommand("FAN_OFF")}
            disabled={loading || (!isFanOn && !isUnauthorized)}
            className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 shadow-sm ${
              isUnauthorized
                ? "bg-red-500/15 hover:bg-red-500/25 text-[#D13B4B] border border-red-500/30 active:scale-[0.98]"
                : !isFanOn
                ? "bg-[#222E42]/40 text-[#94A3B8]/40 cursor-not-allowed"
                : isHot
                ? isLight
                  ? "bg-[#B82E3E] hover:bg-[#9B2433] text-white active:scale-[0.98]"
                  : "bg-[#D13B4B] hover:bg-[#B52F3E] text-white active:scale-[0.98]"
                : isLight
                ? "bg-[#E2E8F0] hover:bg-[#CBD5E1] text-[#1E293B] active:scale-[0.98]"
                : "bg-[#222E42] hover:bg-[#2A3850] text-[#E2E8F0] active:scale-[0.98]"
            }`}
          >
            <Power className="w-4 h-4" />
            <span>Matikan Kipas</span>
          </button>
        </div>
      </div>

      {/* Dynamic Feedback Banner */}
      {feedback && (
        <div
          className={`mt-3 p-3 rounded-lg text-xs font-medium flex items-start gap-2.5 transition-colors ${
            feedback.status === "BLOCKED"
              ? isLight
                ? "bg-red-50 text-[#B82E3E] border border-red-200"
                : "bg-red-950/30 text-[#D13B4B]"
              : isLight
              ? "bg-blue-50 text-[#2B5B9E] border border-blue-200"
              : "bg-blue-950/30 text-[#3B76D4]"
          }`}
        >
          {feedback.status === "BLOCKED" ? (
            <ShieldAlert className="w-4 h-4 text-[#D13B4B] shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#2CA58D] shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
