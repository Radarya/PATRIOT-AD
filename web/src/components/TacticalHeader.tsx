"use client";

import React from "react";
import PatriotLogo from "@/components/PatriotLogo";
import { ViewMode } from "@/types";
import {
  ShieldAlert,
  Play,
  Square,
  Layers,
  FileText,
  Activity,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";

interface TacticalHeaderProps {
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onTriggerDemo: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  isAnomaly?: boolean;
  onLockConsole?: () => void;
  isHardwareMode?: boolean;
}

export default function TacticalHeader({
  activeView,
  onViewChange,
  onTriggerDemo,
  theme,
  onToggleTheme,
  isAnomaly = false,
  onLockConsole,
  isHardwareMode = false,
}: TacticalHeaderProps) {
  const isLight = theme === "light";

  const navItems: Array<{ id: ViewMode; label: string; icon: React.ElementType }> = [
    { id: "MONITORING", label: "Pusat Kendali", icon: Activity },
    { id: "BENCHMARK", label: "Perbandingan 3 Metode", icon: Layers },
    { id: "FORENSIC", label: "Catatan Forensik", icon: FileText },
  ];

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-150 ${
        isAnomaly
          ? isLight
            ? "bg-[#FCF8F8] border-b-[#E7CCD1] text-[#1E293B]"
            : "bg-[#23191D] border-b-[#3D2930] text-[#E2E8F0]"
          : isLight
          ? "bg-[#F8FAFC] border-b-[#E2E8F0] text-[#1E293B]"
          : "bg-[#111722] border-b-[#222E42] text-[#E2E8F0]"
      }`}
    >
      <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand Identity */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 flex items-center justify-center">
            {isAnomaly ? (
              <ShieldAlert className="w-5 h-5 text-[#D13B4B]" />
            ) : (
              <PatriotLogo className="w-7 h-7" />
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`font-black text-sm tracking-tight ${
                isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
              }`}
            >
              PATRIOT
              <span
                className={
                  isAnomaly
                    ? isLight
                      ? "text-[#B82E3E]"
                      : "text-[#D13B4B]"
                    : isLight
                    ? "text-[#2B5B9E]"
                    : "text-[#3B76D4]"
                }
              >
                -AD
              </span>
            </span>
          </div>
        </div>

        {/* Center Hairline Segmented Nav Tabs - Desktop (Hidden on mobile to prevent duplication) */}
        <nav
          className={`hidden md:flex items-center gap-1 p-1 rounded-lg ${
            isLight ? "bg-[#E2E8F0]/70" : "bg-[#192231]"
          }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                title={item.label}
                aria-label={item.label}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? isAnomaly
                      ? isLight
                        ? "bg-[#FCF8F8] text-[#B82E3E] shadow-sm"
                        : "bg-[#302026] text-[#D13B4B] shadow-sm"
                      : isLight
                      ? "bg-[#F8FAFC] text-[#2B5B9E] shadow-sm"
                      : "bg-[#222E42] text-[#E2E8F0] shadow-sm"
                    : isLight
                    ? "text-[#475569] hover:text-[#1E293B] hover:bg-[#EEF2F6]"
                    : "text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#222E42]/50"
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 ${
                    isActive
                      ? isAnomaly
                        ? isLight
                          ? "text-[#B82E3E]"
                          : "text-[#D13B4B]"
                        : isLight
                        ? "text-[#2B5B9E]"
                        : "text-[#3B76D4]"
                      : "text-[#94A3B8]"
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right Actions: Logout + Theme Toggle + Sabotage 2-Way Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Tombol Keluar */}
          {onLockConsole && (
            <button
              onClick={onLockConsole}
              aria-label="Keluar"
              title="Keluar dari Pos Kendali"
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                isLight
                  ? "bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#1E293B]"
                  : "bg-[#192231] hover:bg-[#222E42] text-[#E2E8F0]"
              }`}
            >
              <LogOut className="w-3.5 h-3.5 text-[#94A3B8]" />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          )}

          {/* Light / Dark Mode Toggle */}
          <button
            onClick={onToggleTheme}
            aria-label="Ganti Tema Warna"
            title={isLight ? "Beralih ke Mode Gelap" : "Beralih ke Mode Terang"}
            className={`p-2 rounded-lg transition-colors flex items-center ${
              isLight
                ? "bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#1E293B]"
                : "bg-[#192231] hover:bg-[#222E42] text-[#E2E8F0]"
            }`}
          >
            {isLight ? (
              <Moon className="w-4 h-4 text-[#475569]" />
            ) : (
              <Sun className="w-4 h-4 text-amber-300" />
            )}
          </button>

          {/* Mode Hardware Offline vs Mode Simulasi Online */}
          {isHardwareMode ? (
            <div
              title="Alat fisik ESP32 sedang terhubung langsung"
              className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 bg-[#2CA58D]/15 text-[#2CA58D] border border-[#2CA58D]/30 shadow-sm"
            >
              <span className="w-2 h-2 rounded-full bg-[#2CA58D]" />
              <span className="hidden sm:inline">Alat Terhubung</span>
              <span className="sm:hidden">Aktif</span>
            </div>
          ) : (
            <button
              onClick={onTriggerDemo}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 active:scale-[0.98] shadow-sm ${
                isAnomaly
                  ? isLight
                    ? "bg-[#B82E3E] hover:bg-[#9B2433] text-white"
                    : "bg-[#D13B4B] hover:bg-[#B52F3E] text-white"
                  : isLight
                  ? "bg-[#2B5B9E] hover:bg-[#234B82] text-white"
                  : "bg-[#3B76D4] hover:bg-[#3467BC] text-white"
              }`}
            >
              {isAnomaly ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current text-white" />
                  <span>Hentikan Simulasi</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current text-white" />
                  <span>Uji Sabotase</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Nav Tabs Bar */}
      <div
        className={`flex md:hidden px-4 py-2 overflow-x-auto gap-2 ${
          isLight ? "bg-[#EEF2F6]" : "bg-[#111722]"
        }`}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                isActive
                  ? isLight
                    ? "bg-[#F8FAFC] text-[#2B5B9E] font-bold shadow-sm"
                    : "bg-[#222E42] text-[#E2E8F0] font-bold shadow-sm"
                  : isLight
                  ? "text-[#475569]"
                  : "text-[#94A3B8]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
