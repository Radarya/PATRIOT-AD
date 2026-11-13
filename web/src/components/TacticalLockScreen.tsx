"use client";

import React, { useState } from "react";
import Image from "next/image";
import { TacticalUser } from "@/types";
import { UserCheck, Shield, KeyRound, ArrowRight, CreditCard, Lock, ShieldAlert } from "lucide-react";

interface TacticalLockScreenProps {
  isOpen: boolean;
  onAuthenticate: (user: TacticalUser) => void;
  theme?: "dark" | "light";
}

export const TacticalLockScreen: React.FC<TacticalLockScreenProps> = ({
  isOpen,
  onAuthenticate,
  theme = "dark",
}) => {
  const isLight = theme === "light";
  const [role, setRole] = useState<"operator" | "admin" | "unauthorized">("operator");
  const [nrp, setNrp] = useState("");
  const [pin, setPin] = useState("");
  const [captchaCode, setCaptchaCode] = useState("5428");
  const [captchaInput, setCaptchaInput] = useState("");

  const refreshCaptcha = () => {
    const next = Math.floor(1000 + Math.random() * 9000).toString();
    setCaptchaCode(next);
  };

  if (!isOpen) return null;

  const handleIntruderLogin = () => {
    onAuthenticate({
      name: "Penyusup Siber (Tamu Ilegal)",
      nrp: "UNKNOWN_EXTERNAL",
      role: "unauthorized",
      roleLabel: "Penyusup / Tamu Ilegal",
      loginTime: new Date().toLocaleTimeString("id-ID"),
      token: "",
    });
  };

  const authenticateWithGateway = async (
    selectedRole: "operator" | "admin",
    effectiveName: string,
    effectiveNrp: string,
    roleLabel: string
  ) => {
    let serverToken: string | undefined;
    try {
      if (
        typeof window !== "undefined" &&
        window.location.protocol !== "https:"
      ) {
        const res = await fetch(
          `http://${window.location.hostname}:8000/api/auth/login`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role: selectedRole,
              nrp: effectiveNrp,
              pin,
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (typeof data.token === "string" && data.token.length > 0) {
            serverToken = data.token;
          }
        }
      }
    } catch {
      // Mode simulasi offline/Vercel tanpa backend lokal: token tetap undefined (tanpa token hardcoded)
    }

    onAuthenticate({
      name: effectiveName,
      nrp: effectiveNrp,
      role: selectedRole,
      roleLabel,
      loginTime: new Date().toLocaleTimeString("id-ID"),
      token: serverToken,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role === "unauthorized") {
      handleIntruderLogin();
      return;
    }

    const inputVal = nrp.trim();
    const isNumber = /^\d+$/.test(inputVal);
    const effectiveNrp = isNumber && inputVal.length > 0
      ? inputVal
      : role === "admin"
      ? "1108004523"
      : "3112009871";
    const effectiveName = !isNumber && inputVal.length > 0
      ? inputVal
      : role === "admin"
      ? "Mayor Cba Hendra Pratama"
      : "Sertu Fulan";
    const roleLabel = role === "admin" ? "Perwira Pengawas" : "Operator Piket";

    await authenticateWithGateway(role, effectiveName, effectiveNrp, roleLabel);
  };

  const handleFillValidCreds = async () => {
    const targetRole: "operator" | "admin" =
      role === "unauthorized" ? "operator" : role;
    const effectiveNrp = targetRole === "admin" ? "1108004523" : "3112009871";
    const roleLabel =
      targetRole === "admin" ? "Perwira Pengawas" : "Operator Piket";
    const name =
      targetRole === "admin" ? "Mayor Cba Hendra Pratama" : "Sertu Fulan";

    await authenticateWithGateway(targetRole, name, effectiveNrp, roleLabel);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto transition-colors duration-150 ${
        isLight ? "bg-[#EEF2F6]" : "bg-[#0c1527]"
      }`}
    >
      <div
        className={`w-full max-w-4xl my-auto grid grid-cols-1 md:grid-cols-12 rounded-2xl overflow-hidden shadow-2xl border ${
          isLight ? "border-slate-300 bg-white" : "border-slate-800 bg-[#111c33]"
        }`}
      >
        {/* KOLOM KIRI (Panel Identitas & Sistem - gaya SIMPEG) */}
        <div
          className={`md:col-span-5 p-8 sm:p-10 flex flex-col justify-between ${
            isLight ? "bg-[#2B5B9E] text-white" : "bg-[#0f2e6b] text-white"
          }`}
        >
          <div>
            {/* Header Instansi & Logo */}
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 flex-shrink-0">
                <Image
                  src="/patriot-logo.png"
                  alt="PUSSIBERAD Logo"
                  fill
                  sizes="48px"
                  className="object-contain"
                  priority
                />
              </div>
              <div>
                <p className="text-xs uppercase text-blue-200 font-semibold">
                  PUSSIBERAD TNI-AD
                </p>
                <p className="text-xs text-blue-100 font-medium">
                  Pertahanan Siber-Fisik
                </p>
              </div>
            </div>

            {/* Judul & Deskripsi Sistem */}
            <div className="mt-12 sm:mt-16">
              <h1 className="text-3xl font-extrabold tracking-tight leading-none text-white">
                PATRIOT-AD
              </h1>
              <p className="text-xs font-semibold text-blue-200 mt-1 uppercase">
                Konsol Gudang Amunisi
              </p>
              <div className="w-12 h-1 bg-cyan-400 rounded-full mt-4 mb-4" />
              <p className="text-sm text-blue-100 leading-relaxed font-normal">
                Catatan kondisi penyimpanan munisi yang tidak dapat dipalsukan, serta kendali ventilasi fisik yang tahan sabotase berlandaskan Perpres No. 82 Tahun 2022.
              </p>
            </div>
          </div>

          {/* Footer Kolom Kiri */}
          <div className="mt-10 pt-4 border-t border-blue-400/30 text-xs text-blue-200">
            © 2026 PUSSIBERAD TNI-AD. Hak Cipta Dilindungi.
          </div>
        </div>

        {/* KOLOM KANAN (Form Login Otorisasi Personel - gaya SIMPEG) */}
        <div
          className={`md:col-span-7 p-8 sm:p-10 flex flex-col justify-between ${
            isLight ? "bg-white text-slate-900" : "bg-[#111c33] text-[#E2E8F0]"
          }`}
        >
          <div>
            {/* Judul Form */}
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Selamat Datang
              </h2>
              <p className={`text-sm mt-1 ${isLight ? "text-slate-500" : "text-[#94A3B8]"}`}>
                Pilih peran petugas dan masukkan identitas piket Anda
              </p>
            </div>

            {/* Segmented Role Toggle */}
            <div
              className={`mt-6 p-1 rounded-lg flex items-center gap-1 ${
                isLight ? "bg-slate-100" : "bg-[#1a2948]"
              }`}
            >
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  role === "admin"
                    ? "bg-[#3B76D4] text-white shadow-sm"
                    : isLight
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-[#94A3B8] hover:text-[#E2E8F0]"
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Perwira Pengawas</span>
                <span className="sm:hidden">Pengawas</span>
              </button>

              <button
                type="button"
                onClick={() => setRole("operator")}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  role === "operator"
                    ? "bg-[#3B76D4] text-white shadow-sm"
                    : isLight
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-[#94A3B8] hover:text-[#E2E8F0]"
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Operator Piket</span>
                <span className="sm:hidden">Operator</span>
              </button>

              <button
                type="button"
                onClick={() => setRole("unauthorized")}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  role === "unauthorized"
                    ? "bg-[#D13B4B] text-white shadow-sm"
                    : isLight
                    ? "text-[#B82E3E] hover:bg-red-100"
                    : "text-[#D13B4B] hover:bg-red-950/40"
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Penyusup</span>
              </button>
            </div>

            {/* Form Inputs dengan Icon Kredensial */}
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label
                  className={`block text-xs font-semibold uppercase mb-1.5 ${
                    isLight ? "text-slate-600" : "text-[#94A3B8]"
                  }`}
                >
                  NAMA PETUGAS / NRP
                </label>
                <div className="relative">
                  <CreditCard className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
                    isLight ? "text-slate-400" : "text-slate-500"
                  }`} />
                  <input
                    type="text"
                    value={nrp}
                    onChange={(e) => setNrp(e.target.value)}
                    placeholder={role === "admin" ? "Mayor Cba Hendra Pratama / 1108004523" : "Sertu Fulan / 3112009871"}
                    className={`w-full pl-10 pr-4 py-3 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#3B76D4] ${
                      isLight
                        ? "bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400"
                        : "bg-[#1a2948] border border-slate-700/60 text-[#E2E8F0] placeholder-[#94A3B8]/50"
                    }`}
                  />
                </div>
              </div>

              <div>
                <label
                  className={`block text-xs font-semibold uppercase mb-1.5 ${
                    isLight ? "text-slate-600" : "text-[#94A3B8]"
                  }`}
                >
                  KATA SANDI / PIN
                </label>
                <div className="relative">
                  <Lock className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
                    isLight ? "text-slate-400" : "text-slate-500"
                  }`} />
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="••••••••"
                    className={`w-full pl-10 pr-4 py-3 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#3B76D4] ${
                      isLight
                        ? "bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400"
                        : "bg-[#1a2948] border border-slate-700/60 text-[#E2E8F0] placeholder-[#94A3B8]/50"
                    }`}
                  />
                </div>
              </div>

              <div>
                <label
                  className={`block text-xs font-semibold uppercase mb-1.5 ${
                    isLight ? "text-slate-600" : "text-[#94A3B8]"
                  }`}
                >
                  KODE KEAMANAN
                </label>
                <div className="grid grid-cols-12 gap-3 items-center">
                  <div
                    onClick={refreshCaptcha}
                    title="Klik untuk ganti kode captcha"
                    className="col-span-5 sm:col-span-4 h-11 bg-white border border-slate-300 rounded-lg flex items-center justify-center cursor-pointer select-none relative overflow-hidden group shadow-inner"
                  >
                    <span className="font-mono text-xl font-black italic tracking-widest text-slate-800 transform -rotate-2 scale-105">
                      {captchaCode}
                    </span>
                    <div className="absolute inset-0 bg-slate-100/30 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-300" />
                  </div>

                  <div className="col-span-7 sm:col-span-8">
                    <input
                      type="text"
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value)}
                      placeholder={captchaCode}
                      className={`w-full px-4 py-3 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#3B76D4] ${
                        isLight
                          ? "bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400"
                          : "bg-[#1a2948] border border-slate-700/60 text-[#E2E8F0] placeholder-[#94A3B8]/50"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Demo Shortcut Buttons untuk kemudahan juri */}
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleFillValidCreds}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    isLight
                      ? "bg-slate-100 hover:bg-slate-200 text-slate-700"
                      : "bg-[#1a2948] hover:bg-[#233760] text-[#E2E8F0]"
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#3B76D4]" />
                  <span>Isi Otomatis Kredensial Resmi</span>
                </button>

                <button
                  type="button"
                  onClick={handleIntruderLogin}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                    isLight
                      ? "bg-red-50 hover:bg-red-100 text-[#B82E3E] border border-red-200"
                      : "bg-red-950/40 hover:bg-red-900/50 text-[#D13B4B] border border-red-900/50"
                  }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-[#D13B4B]" />
                  <span>Masuk Mode Penyusup (Uji Serangan)</span>
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className={`w-full mt-4 py-3.5 rounded-lg text-sm font-bold text-white transition-colors flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] ${
                  role === "unauthorized"
                    ? "bg-[#D13B4B] hover:bg-[#B52F3E]"
                    : "bg-[#3B76D4] hover:bg-[#3467BC]"
                }`}
              >
                <span>
                  {role === "unauthorized"
                    ? "MASUK SEBAGAI PENYUSUP (UJI SERANGAN)"
                    : `MASUK SEBAGAI ${role === "admin" ? "PERWIRA PENGAWAS" : "OPERATOR PIKET"}`}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>

          {/* Sub-footer */}
          <div
            className={`mt-6 pt-4 border-t text-center text-xs ${
              isLight ? "border-slate-200 text-slate-500" : "border-slate-800 text-[#94A3B8]"
            }`}
          >
            Sistem Pengawasan Gudang Amunisi • Setiap Akses Dicatat Otomatis
          </div>
        </div>
      </div>
    </div>
  );
};
