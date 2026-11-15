"use client";

import React, { useState, useEffect, useRef } from "react";
import { ResponseLevel } from "@/types";
import { Terminal } from "lucide-react";

interface TerminalLog {
  id: string;
  time: string;
  tag: string;
  tagType: "info" | "warn" | "crit" | "hash" | "phys";
  message: string;
  detail?: string;
}

interface TerminalFeedProps {
  alertLevel: ResponseLevel;
  currentTemp: number;
  currentMa: number;
  lastCommand: string;
  scenarioId: string;
  theme?: "dark" | "light";
  isAnomaly?: boolean;
}

export default function TerminalFeed({
  alertLevel,
  currentTemp,
  currentMa,
  lastCommand,
  scenarioId,
  theme = "dark",
  isAnomaly = false,
}: TerminalFeedProps) {
  const isLight = theme === "light";
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastLoggedScenario = useRef<string>("");

  const [logs, setLogs] = useState<TerminalLog[]>([]);
  const initialSampleRef = useRef({ currentTemp, currentMa });

  // Inisialisasi log dengan waktu nyata (realtime clock) saat konsol dimuat
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const now = Date.now();
      const fmt = (offsetSeconds: number) => {
        return new Date(now - offsetSeconds * 1000).toTimeString().split(" ")[0];
      };
      const init = initialSampleRef.current;
      setLogs([
        {
          id: "log-1",
          time: fmt(35),
          tag: "SISTEM",
          tagType: "info",
          message: "Sistem pengawasan PATRIOT-AD aktif. Sensor suhu dan sensor arus kipas siap.",
          detail: "Kalibrasi sensor selesai dan berjalan normal.",
        },
        {
          id: "log-2",
          time: fmt(25),
          tag: "JARINGAN",
          tagType: "info",
          message: "Jalur komunikasi perintah pos jaga dan alat pengendali gudang terhubung.",
        },
        {
          id: "log-3",
          time: fmt(15),
          tag: "FISIK",
          tagType: "phys",
          message: `Arus listrik motor kipas terukur ${init.currentMa.toFixed(1)} mA.`,
        },
        {
          id: "log-4",
          time: fmt(5),
          tag: "AMAN",
          tagType: "info",
          message: `Pantauan rutin: Suhu ${init.currentTemp.toFixed(1)}°C, Arus ${init.currentMa.toFixed(1)} mA.`,
          detail: "Perintah sistem dan putaran fisik kipas sesuai.",
        },
      ]);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const triggerKey = `${scenarioId}-${alertLevel}-${lastCommand}`;
    if (lastLoggedScenario.current === triggerKey) return;
    lastLoggedScenario.current = triggerKey;

    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0];
    const newLogs: TerminalLog[] = [];

    if (scenarioId === "SCN-01") {
      newLogs.push({
        id: `log-${Date.now()}-1`,
        time: timeStr,
        tag: "AMAN",
        tagType: "info",
        message: `Kondisi normal: Suhu ${currentTemp.toFixed(1)}°C, Arus ${currentMa.toFixed(1)} mA.`,
        detail: "Perintah sistem dan putaran fisik kipas sesuai.",
      });
    } else if (scenarioId === "SCN-02") {
      newLogs.push({
        id: `log-${Date.now()}-1`,
        time: timeStr,
        tag: "WASPADA",
        tagType: "warn",
        message: "PERINGATAN: Suhu gudang melonjak terlalu cepat melebihi 1.5°C per detik.",
        detail: "Sistem mendeteksi kenaikan suhu tidak wajar sebelum mencapai batas bahaya.",
      });
    } else if (scenarioId === "SCN-03") {
      newLogs.push({
        id: `log-${Date.now()}-1`,
        time: timeStr,
        tag: "DITOLAK",
        tagType: "crit",
        message: "PENGAMAN SUHU: Perintah mematikan kipas saat gudang panas berhasil ditolak.",
        detail: "Kipas dikunci tetap menyala otomatis untuk menjaga keamanan amunisi.",
      });
    } else if (scenarioId === "SCN-04") {
      newLogs.push({
        id: `log-${Date.now()}-1`,
        time: timeStr,
        tag: "DATA PALSU",
        tagType: "warn",
        message: "DETEKSI: Data sensor terpantau kembar dan beku sebanyak 15 kali berturut-turut.",
        detail: "Indikasi penyusup memutar ulang rekaman data lama.",
      });
    } else if (scenarioId === "SCN-05") {
      newLogs.push({
        id: `log-${Date.now()}-1`,
        time: timeStr,
        tag: "BLOKIR",
        tagType: "crit",
        message: "SERANGAN SPAM: Jumlah perintah masuk melebihi batas 10 pesan per detik.",
        detail: "Akses pengirim langsung diputus agar alat gudang tidak macet.",
      });
    }

    if (newLogs.length > 0) {
      const raf = requestAnimationFrame(() => {
        setLogs((prev) => [...prev.slice(-40), ...newLogs]);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [scenarioId, alertLevel, lastCommand, currentTemp, currentMa]);

  // Auto scroll to bottom of logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

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
      {/* Header Bar */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isLight ? "border-slate-200" : "border-slate-700/20"
      }`}>
        <div className="flex items-center gap-2.5">
          <Terminal className={`w-5 h-5 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
          <div>
            <h3 className="text-lg font-bold tracking-tight">
              Buku Catatan Kejadian
            </h3>
            <p className={`text-xs ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>
              Catatan langsung kondisi gudang, perintah masuk, dan tindakan pengamanan
            </p>
          </div>
        </div>

        <span className={`text-xs font-mono ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>
          {logs.length} CATATAN
        </span>
      </div>

      {/* Log Feed Console: text-sm for descriptions, font-mono for timestamps */}
      <div
        ref={logContainerRef}
        className="my-3 p-4 rounded-lg bg-[#111722] text-[#E2E8F0] max-h-72 overflow-y-auto space-y-2 select-text"
      >
        {logs.map((log) => {
          const badgeClass =
            log.tagType === "crit"
              ? "bg-red-500/20 text-[#D13B4B]"
              : log.tagType === "warn"
              ? "bg-amber-500/20 text-amber-400"
              : log.tagType === "phys"
              ? "bg-[#2CA58D]/20 text-[#2CA58D]"
              : "bg-[#3B76D4]/20 text-[#3B76D4]";

          return (
            <div key={log.id} className="flex items-start gap-3 text-sm">
              <span className="font-mono text-xs text-[#94A3B8] shrink-0 mt-0.5">
                [{log.time}]
              </span>

              <span
                className={`text-xs font-bold px-2 py-0.5 rounded uppercase shrink-0 ${badgeClass}`}
              >
                {log.tag}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#E2E8F0] leading-snug">{log.message}</p>
                {log.detail && (
                  <p className="text-xs text-[#94A3B8] mt-0.5 leading-normal">
                    {log.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Status */}
      <div className={`pt-2 border-t flex items-center justify-between text-xs ${
        isLight ? "border-slate-200 text-[#64748B]" : "border-slate-700/20 text-[#94A3B8]"
      }`}>
        <span>Pembaruan Otomatis</span>
        <span>Tersimpan di Catatan Forensik</span>
      </div>
    </div>
  );
}
