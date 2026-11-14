"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";

interface TacticalLoadingScreenProps {
  onComplete: () => void;
  theme?: "dark" | "light";
}

const STEPS = [
  "Menyiapkan buku catatan pengamanan SHA-256...",
  "Memeriksa sambungan alat sensor gudang utama...",
  "Mengukur suhu, kelembapan, dan arus kipas...",
  "Mengaktifkan pengaman suhu otomatis 32,0°C...",
  "Sistem pengawasan gudang amunisi siap.",
];

export const TacticalLoadingScreen: React.FC<TacticalLoadingScreenProps> = ({
  onComplete,
  theme = "dark",
}) => {
  const isLight = theme === "light";
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progress, setProgress] = useState(15);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < STEPS.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 160);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          setTimeout(() => {
            setIsFadingOut(true);
            setTimeout(onComplete, 250);
          }, 150);
          return 100;
        }
        return Math.min(100, prev + 18);
      });
    }, 100);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-300 ${
        isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100"
      } ${isLight ? "bg-[#EEF2F6] text-[#1E293B]" : "bg-[#111722] text-[#E2E8F0]"}`}
    >
      <div
        className={`w-full max-w-md p-8 rounded-2xl border flex flex-col items-center text-center shadow-2xl transition-colors ${
          isLight
            ? "bg-[#F8FAFC] border-[#E2E8F0]"
            : "bg-[#192231] border-[#222E42]"
        }`}
      >
        {/* Logo Instansi */}
        <div className="relative w-16 h-16 mb-4 flex-shrink-0">
          <Image
            src="/patriot-logo.png"
            alt="Logo PATRIOT-AD"
            fill
            sizes="64px"
            className="object-contain"
            style={{
              filter: "drop-shadow(0 0 10px rgba(96, 165, 250, 0.35))",
            }}
            priority
          />
        </div>

        {/* Brand & Subtitle */}
        <h2 className="text-xl font-bold tracking-tight">
          PATRIOT-AD
        </h2>
        <p className="text-xs uppercase text-[#3B76D4] font-semibold mt-0.5">
          PUSSIBERAD TNI-AD
        </p>
        <p
          className={`text-xs mt-2 ${
            isLight ? "text-[#475569]" : "text-[#94A3B8]"
          }`}
        >
          Pusat Pengawasan &amp; Pengamanan Gudang Amunisi
        </p>

        {/* Progress Bar */}
        <div className="w-full mt-6 mb-3">
          <div
            className={`w-full h-2 rounded-full overflow-hidden ${
              isLight ? "bg-[#E2E8F0]" : "bg-[#222E42]"
            }`}
          >
            <div
              className="h-full bg-[#3B76D4] rounded-full transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs mt-1.5 font-mono">
            <span
              className={isLight ? "text-[#64748B]" : "text-[#94A3B8]"}
            >
              MEMUAT SISTEM
            </span>
            <span className="font-bold text-[#3B76D4]">{progress}%</span>
          </div>
        </div>

        {/* Step Diagnostic Output */}
        <div
          className={`w-full py-2.5 px-3 rounded-lg text-xs font-mono text-left transition-colors ${
            isLight
              ? "bg-[#EEF2F6] text-[#1E293B]"
              : "bg-[#111722] text-[#E2E8F0]"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#2CA58D] animate-pulse" />
            <span className="truncate">{STEPS[currentStepIndex]}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
