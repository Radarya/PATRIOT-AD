"use client";

import React from "react";
import { Decision } from "@/types";
import { Layers, Timer, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";

interface BenchmarkMatrixProps {
  onTriggerScenario: (scenarioId: string) => void;
  currentScenario: string;
  activeDecision: Decision | null;
  theme?: "dark" | "light";
  isAnomaly?: boolean;
}

interface ScenarioItem {
  id: string;
  code: string;
  title: string;
  tag: string;
  summary: string;
  methodA: { verdict: "FAIL" | "PASS"; detail: string };
  methodB: { verdict: "FAIL" | "PASS"; detail: string };
  methodC: { verdict: "PASS"; detail: string };
  proof: string;
}

const SCENARIOS: ScenarioItem[] = [
  {
    id: "SCN-01",
    code: "SCN-01",
    title: "Kondisi Normal",
    tag: "Normal",
    summary: "Suhu gudang sekitar 30°C dan kipas pendingin berputar normal dengan arus stabil.",
    methodA: {
      verdict: "PASS",
      detail: "Aman karena suhu masih berada di bawah batas bahaya 34.0°C.",
    },
    methodB: {
      verdict: "PASS",
      detail: "Aman karena paket data yang masuk berasal dari perangkat resmi.",
    },
    methodC: {
      verdict: "PASS",
      detail: "Aman: Perintah sistem, saklar relai, dan arus listrik kipas sesuai.",
    },
    proof: "Kondisi gudang normal dan seluruh sensor sesuai.",
  },
  {
    id: "SCN-02",
    code: "SCN-02",
    title: "Lonjakan Suhu Mendadak",
    tag: "Lonjakan Suhu",
    summary: "Suhu gudang tiba-tiba naik drastis 3.5°C per detik sebelum menyentuh angka 34.0°C.",
    methodA: {
      verdict: "FAIL",
      detail: "Tidak terdeteksi karena hanya menunggu suhu menyentuh angka 34.0°C.",
    },
    methodB: {
      verdict: "FAIL",
      detail: "Tidak terdeteksi karena hanya memeriksa izin jaringan tanpa mengecek wajar tidaknya angka suhu.",
    },
    methodC: {
      verdict: "PASS",
      detail: "Terdeteksi dini: Sistem langsung memberi peringatan begitu suhu melonjak tidak wajar.",
    },
    proof: "Mendeteksi kenaikan suhu mendadak sebelum gudang telanjur panas.",
  },
  {
    id: "SCN-03",
    code: "SCN-03",
    title: "Sabotase Matikan Kipas Saat Panas",
    tag: "Kunci Pengaman",
    summary: "Penyusup mengirim perintah mematikan kipas saat suhu gudang sedang panas di atas 32.0°C.",
    methodA: {
      verdict: "FAIL",
      detail: "Kipas ikut mati karena suhu belum sampai 34.0°C. Gudang berisiko kepanasan.",
    },
    methodB: {
      verdict: "FAIL",
      detail: "Kipas ikut mati karena penyusup memakai akun yang tampak sah di jaringan.",
    },
    methodC: {
      verdict: "PASS",
      detail: "Ditolak otomatis: Pengaman suhu menolak perintah mati dan mengunci kipas tetap menyala.",
    },
    proof: "Pengaman fisik di alat menolak perintah berbahaya meski akun berhasil dibobol.",
  },
  {
    id: "SCN-04",
    code: "SCN-04",
    title: "Rekaman Data Sensor Palsu",
    tag: "Data Palsu",
    summary: "Penyusup mengirim angka suhu, kelembapan, dan arus yang sama persis berulang-ulang untuk menipu layar pantau.",
    methodA: {
      verdict: "FAIL",
      detail: "Tertipu karena angka palsu 29.8°C terlihat berada di bawah batas bahaya.",
    },
    methodB: {
      verdict: "FAIL",
      detail: "Tertipu karena pesan dikirim secara rutin dengan format jaringan yang benar.",
    },
    methodC: {
      verdict: "PASS",
      detail: "Terdeteksi: Sistem mengenali bahwa sensor asli tidak mungkin menghasilkan angka yang beku tanpa perubahan sedikit pun.",
    },
    proof: "Membongkar tipuan data rekaman lama yang diputar ulang oleh penyusup.",
  },
  {
    id: "SCN-05",
    code: "SCN-05",
    title: "Serangan Banjir Perintah",
    tag: "Blokir Spam",
    summary: "Penyusup mengirim belasan perintah per detik secara beruntun untuk membuat alat macet.",
    methodA: {
      verdict: "FAIL",
      detail: "Tidak ada pembatas jumlah pesan sehingga alat rawan macet.",
    },
    methodB: {
      verdict: "FAIL",
      detail: "Jaringan tetap meneruskan seluruh pesan beruntun selama koneksi masih terbuka.",
    },
    methodC: {
      verdict: "PASS",
      detail: "Diblokir otomatis: Sistem langsung memutus akses pengirim yang mengirim pesan berlebihan.",
    },
    proof: "Mengisolasi pengirim serangan agar kipas gudang tetap berjalan normal.",
  },
];

export default function BenchmarkMatrix({
  onTriggerScenario,
  currentScenario,
  activeDecision,
  theme = "dark",
  isAnomaly = false,
}: BenchmarkMatrixProps) {
  const isLight = theme === "light";
  const activeScn =
    SCENARIOS.find((s) => s.id === currentScenario) || SCENARIOS[0];

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
    ? "bg-[#EEF2F6]"
    : "bg-[#222E42]";

  const columnCardBg = isLight
    ? "bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm"
    : "bg-[#192231]";

  return (
    <div
      className={`rounded-xl border p-5 flex flex-col gap-5 transition-colors shadow-sm ${cardBg}`}
    >
      {/* Header Bar */}
      <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
        isLight ? "border-slate-200" : "border-slate-700/20"
      }`}>
        <div className="flex items-center gap-2.5">
          <Layers className={`w-5 h-5 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              Perbandingan 3 Metode Pengamanan
            </h2>
            <p className={`text-xs ${isLight ? "text-[#475569]" : "text-[#94A3B8]"}`}>
              Uji ketahanan sistem menghadapi 5 skenario gangguan pada gudang amunisi
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {currentScenario !== "SCN-01" && (
            <button
              onClick={() => onTriggerScenario("SCN-01")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2CA58D] text-white hover:bg-[#258b76] transition-colors shadow-sm"
              title="Kembalikan sistem ke kondisi operasional normal"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Pulihkan Normal (SCN-01)</span>
            </button>
          )}

          {activeDecision && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
              isLight ? "bg-[#E2E8F0] text-[#1E293B]" : "bg-[#222E42] text-[#E2E8F0]"
            }`}>
              <Timer className={`w-4 h-4 ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`} />
              <span className={isLight ? "text-[#475569]" : "text-[#94A3B8]"}>Waktu Respons:</span>
              <span className={`font-mono font-bold ${isLight ? "text-[#2B5B9E]" : "text-[#3B76D4]"}`}>
                {activeDecision.latency_ms.toFixed(2)} ms
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Segmented Control / Unified Tab Bar for Scenarios */}
      <div className={`p-1 rounded-lg flex flex-wrap sm:flex-nowrap items-center gap-1 ${
        isLight ? "bg-[#E2E8F0]" : "bg-[#222E42]"
      }`}>
        {SCENARIOS.map((scn) => {
          const isSelected = scn.id === currentScenario;
          return (
            <button
              key={scn.id}
              onClick={() => onTriggerScenario(scn.id)}
              className={`flex-1 py-2.5 px-3 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-2 ${
                isSelected
                  ? isLight
                    ? "bg-[#2B5B9E] text-white shadow-sm"
                    : "bg-[#3B76D4] text-white shadow-sm"
                  : isLight
                  ? "text-[#475569] hover:text-[#1E293B] hover:bg-[#CBD5E1]/60"
                  : "text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#2A3850]/50"
              }`}
            >
              <span className="font-mono font-bold">{scn.code}</span>
              <span className="hidden md:inline">{scn.tag}</span>
            </button>
          );
        })}
      </div>

      {/* Active Scenario Overview & 3-Method Surface Columns */}
      <div className={`rounded-lg p-5 ${subSurfaceBg}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b ${
          isLight ? "border-slate-300" : "border-slate-700/20"
        }`}>
          <div className="flex items-center gap-2.5">
            <span className={`px-2 py-0.5 rounded text-white font-mono text-xs font-bold ${
              isLight ? "bg-[#2B5B9E]" : "bg-[#3B76D4]"
            }`}>
              {activeScn.code}
            </span>
            <h3 className={`text-base font-bold tracking-tight ${
              isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
            }`}>
              {activeScn.title}
            </h3>
          </div>
          <span className="text-xs font-semibold text-[#2CA58D] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            {activeScn.proof}
          </span>
        </div>

        <p className={`text-sm mb-5 leading-relaxed font-medium ${
          isLight ? "text-[#0F172A]" : "text-[#E2E8F0]"
        }`}>
          {activeScn.summary}
        </p>

        {/* 3 Columns: Method A, Method B, Method C */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Method A */}
          <div className={`rounded-lg p-4 relative overflow-hidden flex flex-col justify-between ${columnCardBg}`}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-xs font-bold ${
                  isLight ? "text-[#0F172A]" : "text-[#E2E8F0]"
                }`}>
                  Metode A: Batas Suhu Biasa
                </span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 ${
                    activeScn.methodA.verdict === "PASS"
                      ? "bg-[#2CA58D]/20 text-[#2CA58D]"
                      : "bg-red-500/20 text-[#D13B4B]"
                  }`}
                >
                  {activeScn.methodA.verdict === "PASS" ? "LOLOS" : "GAGAL"}
                </span>
              </div>
              <p className={`text-sm leading-relaxed ${
                isLight ? "text-[#334155]" : "text-[#E2E8F0]"
              }`}>
                {activeScn.methodA.detail}
              </p>
            </div>
            <div className={`mt-4 pt-2 border-t text-xs ${
              isLight ? "border-slate-200 text-[#475569]" : "border-slate-700/20 text-[#94A3B8]"
            }`}>
              Hanya memantau batas suhu 34°C
            </div>
          </div>

          {/* Method B */}
          <div className={`rounded-lg p-4 relative overflow-hidden flex flex-col justify-between ${columnCardBg}`}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-xs font-bold ${
                  isLight ? "text-[#0F172A]" : "text-[#E2E8F0]"
                }`}>
                  Metode B: Keamanan Jaringan Saja
                </span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 ${
                    activeScn.methodB.verdict === "PASS"
                      ? "bg-[#2CA58D]/20 text-[#2CA58D]"
                      : "bg-red-500/20 text-[#D13B4B]"
                  }`}
                >
                  {activeScn.methodB.verdict === "PASS" ? "LOLOS" : "GAGAL"}
                </span>
              </div>
              <p className={`text-sm leading-relaxed ${
                isLight ? "text-[#334155]" : "text-[#E2E8F0]"
              }`}>
                {activeScn.methodB.detail}
              </p>
            </div>
            <div className={`mt-4 pt-2 border-t text-xs ${
              isLight ? "border-slate-200 text-[#475569]" : "border-slate-700/20 text-[#94A3B8]"
            }`}>
              Hanya memeriksa akun dan jalur komunikasi
            </div>
          </div>

          {/* Method C (PATRIOT-AD) */}
          <div className={`rounded-lg p-4 relative overflow-hidden flex flex-col justify-between ${columnCardBg}`}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-[#2CA58D]" />
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-[#2CA58D]">
                  Metode C: Sistem PATRIOT-AD
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded uppercase bg-[#2CA58D]/20 text-[#2CA58D]">
                  TERLINDUNGI
                </span>
              </div>
              <p className={`text-sm leading-relaxed ${
                isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
              }`}>
                {activeScn.methodC.detail}
              </p>
            </div>
            <div className={`mt-4 pt-2 border-t text-xs text-[#2CA58D] ${
              isLight ? "border-slate-200" : "border-slate-700/20"
            }`}>
              Pemeriksaan jaringan, pola data, dan arus fisik kipas
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
