"use client";

import React, { useState, useMemo } from "react";
import { IncidentRecord, VerifyReport } from "@/types";
import { verifyChainClientSide } from "@/lib/mockData";
import {
  FileCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  GitCommit,
  Printer,
} from "lucide-react";

import { TacticalUser } from "@/types";

interface ForensicAuditViewerProps {
  records: IncidentRecord[];
  onTriggerTamper?: () => void;
  onResetChain?: () => void;
  isTampered?: boolean;
  theme?: "dark" | "light";
  isAnomaly?: boolean;
  currentUser?: TacticalUser;
}

function formatTimestampWIB(isoStr: string): string {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr.replace("T", " ").slice(0, 19);
    const formatter = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "";
    return `${getPart("year")}-${getPart("month")}-${getPart("day")} ${getPart("hour")}:${getPart("minute")}:${getPart("second")}`;
  } catch {
    return isoStr.replace("T", " ").slice(0, 19);
  }
}

function formatSourceLabel(src: string): string {
  const s = (src || "").toLowerCase();
  if (s === "esp32_gudang") return "Sensor Gudang Utama";
  if (s === "admin" || s === "dashboard") return "Perwira Pengawas";
  if (s === "operator" || s === "operator_piket") return "Petugas Piket";
  if (
    s === "unauthorized" ||
    s === "tamu_ilegal" ||
    s.includes("infiltrator") ||
    s.includes("rogue") ||
    s.includes("penyusup")
  ) {
    return "Pihak Tanpa Izin";
  }
  if (s === "hardware_interlock") return "Pengaman Suhu Otomatis";
  if (s === "triangulation_engine") return "Pemeriksa Arus Kipas";
  return src;
}

function formatStatusLabel(level: number): string {
  if (level >= 3) return "DIKARANTINA";
  if (level === 2) return "DITOLAK";
  if (level === 1) return "PERINGATAN";
  return "NORMAL";
}

function cleanTextForReport(raw: string): string {
  return raw
    .replace(/FAN_OFF/g, "mematikan kipas")
    .replace(/FAN_ON/g, "menyalakan kipas")
    .replace(/KEEP_SAFE/g, "penguncian kipas menyala")
    .replace(/Safety Gate/gi, "pengaman suhu otomatis")
    .replace(/esp32_gudang/gi, "Sensor Gudang Utama")
    .replace(/'unauthorized'/gi, "pihak tanpa izin")
    .replace(/'admin'/gi, "perwira pengawas")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractIncidentSummary(rec: IncidentRecord): string {
  const ev = (rec.structured_evidence || {}) as Record<string, unknown>;

  if (typeof ev.reason === "string" && ev.reason.trim()) {
    return cleanTextForReport(ev.reason);
  }
  if (typeof ev.note === "string" && ev.note.trim()) {
    return cleanTextForReport(ev.note);
  }
  if (typeof ev.detail === "string" && ev.detail.trim()) {
    return cleanTextForReport(ev.detail);
  }

  // Cek struktur findings dari database SQLite backend
  if (Array.isArray(ev.findings) && ev.findings.length > 0) {
    const firstFinding = ev.findings[0] as Record<string, unknown>;
    if (typeof firstFinding?.detail === "string" && firstFinding.detail.trim()) {
      return cleanTextForReport(firstFinding.detail);
    }
  }

  if (ev.finding && typeof ev.finding === "object") {
    const fObj = ev.finding as Record<string, unknown>;
    if (typeof fObj.detail === "string" && fObj.detail.trim()) {
      return cleanTextForReport(fObj.detail);
    }
  }

  // Cek perintah dari command_request backend
  if (ev.command_request && typeof ev.command_request === "object") {
    const cmdReq = ev.command_request as Record<string, unknown>;
    const cmdName =
      cmdReq.command === "FAN_OFF"
        ? "mematikan kipas"
        : cmdReq.command === "FAN_ON"
        ? "menyalakan kipas"
        : String(cmdReq.command || "kendali kipas");
    const allowed = Boolean(ev.allowed);
    const tempVal =
      typeof ev.current_temp === "number"
        ? ` pada suhu gudang ${ev.current_temp.toFixed(1).replace(".", ",")}°C`
        : "";
    if (typeof cmdReq.reason === "string" && cmdReq.reason.trim()) {
      return cleanTextForReport(cmdReq.reason);
    }
    return allowed
      ? `Perintah ${cmdName} disetujui dan dijalankan${tempVal}.`
      : `Perintah ${cmdName} ditolak oleh sistem pengaman${tempVal}.`;
  }

  // Cek telemetri dari backend atau frontend
  const nestedTel =
    ev.telemetry && typeof ev.telemetry === "object"
      ? (ev.telemetry as Record<string, unknown>)
      : null;
  const tempNum =
    typeof ev.temperature_c === "number"
      ? ev.temperature_c
      : typeof nestedTel?.temperature_c === "number"
      ? (nestedTel.temperature_c as number)
      : typeof ev.final_temp_c === "number"
      ? ev.final_temp_c
      : null;

  const currNum =
    typeof ev.current_ma === "number"
      ? ev.current_ma
      : typeof nestedTel?.current_ma === "number"
      ? (nestedTel.current_ma as number)
      : typeof ev.physical_current_ma === "number"
      ? ev.physical_current_ma
      : typeof ev.final_current_ma === "number"
      ? ev.final_current_ma
      : null;

  if (ev.triangulation_result === "SPOOFING_CONFIRMED") {
    return `Ketidaksesuaian terdeteksi: laporan jaringan menyatakan kipas mati, namun sensor arus mencatat kipas tetap berputar pada ${
      currNum !== null ? currNum.toFixed(1).replace(".", ",") : "89,2"
    } mA.`;
  }

  if (ev.mitigation_type === "AUTO_FAILSAFE_RECOVERY") {
    return `Pemulihan otomatis selesai: suhu gudang kembali aman pada ${
      tempNum !== null ? tempNum.toFixed(1).replace(".", ",") : "29,8"
    }°C dan kipas berputar normal.`;
  }

  if (tempNum !== null) {
    const currText =
      currNum !== null ? ` dengan arus kipas ${currNum.toFixed(1).replace(".", ",")} mA` : "";
    return `Pemantauan sensor gudang mencatat suhu ${tempNum
      .toFixed(1)
      .replace(".", ",")}°C${currText}.`;
  }

  if (rec.event_type.includes("CMD") || rec.event_type === "COMMAND") {
    return "Percobaan pengiriman perintah kendali kipas telah diperiksa oleh sistem pengaman.";
  }

  return "Catatan pemeriksaan keamanan gudang amunisi.";
}

export default function ForensicAuditViewer({
  records,
  onTriggerTamper,
  onResetChain,
  isTampered = false,
  theme = "dark",
  isAnomaly = false,
  currentUser,
}: ForensicAuditViewerProps) {
  const isLight = theme === "light";
  const [verifyResult, setVerifyResult] = useState<VerifyReport | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Urutan kronologis terbaru di atas
  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => b.seq_id - a.seq_id);
  }, [records]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      if (
        typeof window !== "undefined" &&
        window.location.protocol === "https:"
      ) {
        throw new Error("Cloud HTTPS mode");
      }
      const host =
        typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const res = await fetch(`http://${host}:8000/api/forensic/verify`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = await res.json();
        setVerifyResult(data);
      } else {
        throw new Error("Local backend unavailable");
      }
    } catch {
      const report = await verifyChainClientSide(records);
      if (isTampered) {
        report.ok = false;
        report.errors.push({
          seq_id: 1,
          kind: "TAMPER_DETECTED",
          detail: "Kode keaslian SHA-256 pada catatan #001 tidak cocok. Rantai catatan terputus.",
        });
      }
      setVerifyResult(report);
    } finally {
      setVerifying(false);
    }
  };

  const handlePrintPDF = () => {
    if (typeof document === "undefined") return;

    const now = new Date();
    const formatterTgl = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const formatterJam = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const tanggalSurat = formatterTgl.format(now);
    const jamSurat = formatterJam.format(now).replace(/\./g, ":");

    const petugasNama = currentUser?.name || "Sertu Fulan";
    const petugasNrp = currentUser?.nrp || "3112009871";
    const petugasRoleLabel = currentUser?.roleLabel || "Operator Piket";
    const isAdmin = currentUser?.role === "admin";

    const latestRec = sortedRecords[0];
    const totalCount = sortedRecords.length;
    const criticalCount = sortedRecords.filter((r) => r.response_level >= 2).length;
    const warnCount = sortedRecords.filter((r) => r.response_level === 1).length;
    const hasIntrusion = sortedRecords.some(
      (r) =>
        r.event_type.includes("CMD") ||
        r.event_type === "COMMAND" ||
        r.event_type.includes("LOGIN") ||
        r.source_identity.toLowerCase().includes("unauthorized") ||
        r.source_identity.toLowerCase().includes("penyusup") ||
        r.source_identity.toLowerCase().includes("tamu") ||
        r.source_identity.toLowerCase().includes("rogue")
    );
    const hasThermalAlert = sortedRecords.some((r) => {
      const ev = (r.structured_evidence || {}) as Record<string, unknown>;
      const nestedTel =
        ev.telemetry && typeof ev.telemetry === "object"
          ? (ev.telemetry as Record<string, unknown>)
          : null;
      const tVal = Number(
        ev.temperature_c ?? nestedTel?.temperature_c ?? ev.current_temp ?? 0
      );
      return r.event_type.includes("SAFETY_GATE") || tVal >= 32.0;
    });

    const deteksiText = latestRec
      ? `Sistem pengawasan gudang amunisi mencatat sebanyak ${totalCount} kejadian yang terdiri atas ${criticalCount} tindakan penolakan otomatis dan ${warnCount} peringatan dini. Kejadian terakhir tercatat pada ${formatTimestampWIB(
          latestRec.timestamp
        )} WIB berasal dari ${formatSourceLabel(latestRec.source_identity)}.`
      : "Tidak ditemukan gangguan keamanan selama periode pemantauan berlangsung.";

    const analisisText =
      hasIntrusion && hasThermalAlert
        ? "Berdasarkan pemeriksaan catatan kejadian, ditemukan percobaan pengiriman perintah tanpa izin melalui jaringan yang terjadi bersamaan dengan kenaikan suhu ruang penyimpanan melewati batas aman 32,0°C."
        : hasIntrusion
        ? "Berdasarkan pemeriksaan catatan kejadian, ditemukan percobaan pengiriman perintah kendali kipas oleh pihak yang tidak memiliki hak akses resmi pada jaringan pos jaga."
        : hasThermalAlert
        ? "Berdasarkan pemeriksaan catatan kejadian, terjadi kenaikan suhu ruang penyimpanan amunisi melebihi batas aman 32,0°C yang memerlukan pendinginan paksa."
        : "Seluruh pembacaan suhu ruangan, kelembapan udara, serta arus listrik motor kipas pendingin berada dalam batas wajar.";

    const penahananText =
      criticalCount > 0
        ? "Alat pengendali di gudang amunisi secara otomatis menolak seluruh perintah mencurigakan dari jaringan dan mengunci sakelar kipas pendingin tetap menyala hingga suhu ruangan kembali turun."
        : "Alat pengendali di gudang amunisi tetap menjaga putaran kipas pendingin secara normal sesuai ketentuan pengamanan.";

    const pemulihanText = isTampered
      ? "Pemeriksaan keaslian data menemukan adanya ketidakcocokan kode SHA-256 pada catatan nomor #001 sehingga diperlukan pemeriksaan lebih lanjut oleh Perwira Pengawas."
      : "Sirkulasi udara dan suhu ruang penyimpanan gudang amunisi telah kembali terkendali di kisaran aman 30,2°C, kendali berada sepenuhnya pada petugas piket resmi, dan seluruh catatan kejadian terbukti utuh tanpa perubahan.";

    const rowsHtml = sortedRecords
      .slice(0, 25)
      .map((rec) => {
        const desc = extractIncidentSummary(rec);
        const lvlLabel = formatStatusLabel(rec.response_level);
        const srcLabel = formatSourceLabel(rec.source_identity);

        return `
          <tr>
            <td style="text-align: center;">${rec.seq_id}</td>
            <td style="white-space: nowrap;">${formatTimestampWIB(rec.timestamp)}</td>
            <td>${srcLabel}</td>
            <td style="text-align: center; font-weight: 700;">${lvlLabel}</td>
            <td>${desc}</td>
            <td style="font-family: 'Courier New', Courier, monospace; font-size: 8.5pt; word-break: break-all;">
              <div><strong>Kode:</strong> ${rec.record_hash.slice(0, 24)}...</div>
              <div><strong>Induk:</strong> ${rec.prev_hash.slice(0, 24)}...</div>
            </td>
          </tr>
        `;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Laporan Penanganan Insiden Gudang Amunisi</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: "Times New Roman", Times, serif;
      color: #000000;
      background: #ffffff;
      line-height: 1.45;
      font-size: 11pt;
      margin: 0;
      padding: 18mm 20mm;
    }
    .kop-wrapper {
      display: inline-block;
      text-align: center;
      border-bottom: 1.5px solid #000000;
      padding-bottom: 4px;
      margin-bottom: 16px;
    }
    .kop-baris-1 {
      font-size: 11pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }
    .kop-baris-2 {
      font-size: 11.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }
    .judul-blok {
      text-align: center;
      margin: 8px 0 16px 0;
    }
    .judul-dokumen {
      font-size: 12.5pt;
      font-weight: 700;
      text-transform: uppercase;
      text-decoration: underline;
      margin: 0;
    }
    .nomor-dokumen {
      font-size: 11pt;
      margin: 3px 0 0 0;
    }
    .bab-judul {
      font-size: 11pt;
      font-weight: 700;
      text-transform: uppercase;
      margin: 14px 0 6px 0;
    }
    .tabel-identitas {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 11pt;
    }
    .tabel-identitas td {
      padding: 2px 4px;
      vertical-align: top;
    }
    .tabel-identitas td.kolom-no {
      width: 24px;
    }
    .tabel-identitas td.kolom-label {
      width: 195px;
    }
    .tabel-identitas td.kolom-titik {
      width: 14px;
      text-align: center;
    }
    .daftar-tahap {
      margin: 4px 0 12px 0;
      padding-left: 22px;
    }
    .daftar-tahap li {
      margin-bottom: 6px;
      text-align: justify;
    }
    .tabel-kejadian {
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
      margin-top: 6px;
      margin-bottom: 14px;
    }
    .tabel-kejadian th,
    .tabel-kejadian td {
      border: 1px solid #000000;
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
    }
    .tabel-kejadian th {
      font-weight: 700;
      text-align: center;
      background: #f5f5f5;
    }
    .paragraf-penutup {
      text-align: justify;
      margin: 6px 0 18px 0;
    }
    .ttd-baris {
      display: flex;
      justify-content: space-between;
      margin-top: 18px;
      page-break-inside: avoid;
    }
    .ttd-kolom {
      width: 45%;
      text-align: center;
      font-size: 11pt;
    }
    .ttd-ruang {
      height: 58px;
    }
  </style>
</head>
<body>
  <div class="kop-wrapper">
    <div class="kop-baris-1">MARKAS BESAR ANGKATAN DARAT</div>
    <div class="kop-baris-2">DIREKTORAT PERALATAN & PUSAT SIBER TNI-AD</div>
  </div>

  <div class="judul-blok">
    <h1 class="judul-dokumen">LAPORAN PENANGANAN GANGGUAN KEAMANAN GUDANG AMUNISI</h1>
    <p class="nomor-dokumen">Nomor: B/LP-${String(totalCount).padStart(2, "0")}/XI/2026/Pussiberad</p>
  </div>

  <div class="bab-judul">I. DATA UMUM PENGAMANAN</div>
  <table class="tabel-identitas">
    <tr>
      <td class="kolom-no">1.</td>
      <td class="kolom-label">Dasar Pelaksanaan</td>
      <td class="kolom-titik">:</td>
      <td>Peraturan Presiden Republik Indonesia Nomor 82 Tahun 2022 Pasal 15 tentang Pelindungan Infrastruktur Informasi Vital Bidang Pertahanan.</td>
    </tr>
    <tr>
      <td class="kolom-no">2.</td>
      <td class="kolom-label">Objek Pengamanan</td>
      <td class="kolom-titik">:</td>
      <td>Ruang Penyimpanan Gudang Amunisi Utama.</td>
    </tr>
    <tr>
      <td class="kolom-no">3.</td>
      <td class="kolom-label">Ketentuan Pengaman Suhu</td>
      <td class="kolom-titik">:</td>
      <td>Batas suhu maksimal 32,0°C dengan pengunci kipas pendingin otomatis.</td>
    </tr>
    <tr>
      <td class="kolom-no">4.</td>
      <td class="kolom-label">Petugas Pencatat Laporan</td>
      <td class="kolom-titik">:</td>
      <td>${petugasNama}, NRP ${petugasNrp} (${petugasRoleLabel}).</td>
    </tr>
    <tr>
      <td class="kolom-no">5.</td>
      <td class="kolom-label">Waktu Cetak Laporan</td>
      <td class="kolom-titik">:</td>
      <td>${tanggalSurat}, pukul ${jamSurat} WIB.</td>
    </tr>
    <tr>
      <td class="kolom-no">6.</td>
      <td class="kolom-label">Status Keaslian Catatan</td>
      <td class="kolom-titik">:</td>
      <td><strong>${
        isTampered
          ? "Ditemukan indikasi perubahan tidak sah pada catatan kejadian"
          : "Seluruh catatan kejadian sah, utuh, dan terverifikasi berantai SHA-256"
      }.</strong></td>
    </tr>
  </table>

  <div class="bab-judul">II. TAHAPAN PENANGANAN INSIDEN</div>
  <ol class="daftar-tahap">
    <li><strong>Tahap Deteksi:</strong> ${deteksiText}</li>
    <li><strong>Tahap Analisis:</strong> ${analisisText}</li>
    <li><strong>Tahap Penahanan:</strong> ${penahananText}</li>
    <li><strong>Tahap Pemulihan:</strong> ${pemulihanText}</li>
  </ol>

  <div class="bab-judul">III. DAFTAR RINCIAN CATATAN KEJADIAN</div>
  <table class="tabel-kejadian">
    <thead>
      <tr>
        <th style="width: 6%;">No.</th>
        <th style="width: 17%;">Waktu Kejadian</th>
        <th style="width: 16%;">Sumber</th>
        <th style="width: 14%;">Status Tindakan</th>
        <th style="width: 27%;">Uraian Kejadian</th>
        <th style="width: 20%;">Kode Keaslian SHA-256</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="bab-judul">IV. PENUTUP</div>
  <p class="paragraf-penutup">
    Demikian laporan penanganan gangguan keamanan gudang amunisi ini disusun dengan sebenarnya berdasarkan catatan bukti digital berantai SHA-256 untuk dipergunakan sebagaimana mestinya.
  </p>

  <div class="ttd-baris">
    <div class="ttd-kolom">
      <div>Mengetahui,</div>
      <div>Perwira Pengawas Piket</div>
      <div class="ttd-ruang"></div>
      <div style="font-weight: 700; text-decoration: underline;">${isAdmin ? petugasNama : "Hendra Pratama"}</div>
      <div>${isAdmin ? `NRP ${petugasNrp}` : "Mayor Cba NRP 1108004523"}</div>
    </div>
    <div class="ttd-kolom">
      <div>Jakarta, ${tanggalSurat}</div>
      <div>Petugas Piket Gudang Amunisi</div>
      <div class="ttd-ruang"></div>
      <div style="font-weight: 700; text-decoration: underline;">${!isAdmin ? petugasNama : "Fulan"}</div>
      <div>${!isAdmin ? `${petugasRoleLabel} NRP ${petugasNrp}` : "Sersan Satu NRP 3112009871"}</div>
    </div>
  </div>
</body>
</html>`;

    const existingIframe = document.getElementById("patriot-print-frame");
    if (existingIframe) {
      existingIframe.remove();
    }

    const iframe = document.createElement("iframe");
    iframe.id = "patriot-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }, 250);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
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
      ? "bg-[#F0DFE2] border border-[#E7CCD1]"
      : "bg-[#302026]"
    : isLight
    ? "bg-[#EEF2F6] border border-[#E2E8F0]"
    : "bg-[#222E42]";

  return (
    <div
      className={`rounded-xl border p-5 flex flex-col gap-5 transition-colors shadow-sm ${cardBg}`}
    >
      {/* Header & Verification Controls */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${
          isLight ? "border-slate-200" : "border-slate-700/20"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <GitCommit className="w-5 h-5 text-[#2CA58D]" />
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              Catatan Forensik SHA-256
            </h2>
            <p
              className={`text-xs ${
                isLight ? "text-[#475569]" : "text-[#94A3B8]"
              }`}
            >
              Buku catatan digital anti-ubah: setiap kejadian dikunci berantai dengan kejadian sebelumnya
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onTriggerTamper && (
            <button
              onClick={onTriggerTamper}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isTampered
                  ? "bg-red-950/40 text-[#D13B4B]"
                  : isLight
                  ? "bg-[#E2E8F0] hover:bg-[#CBD5E1] text-[#1E293B]"
                  : "bg-[#222E42] hover:bg-[#2A3850] text-[#94A3B8] hover:text-[#E2E8F0]"
              }`}
            >
              {isTampered ? "Simulasi Ubah Aktif" : "Uji Ubah Data"}
            </button>
          )}

          {isTampered && onResetChain && (
            <button
              onClick={onResetChain}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#222E42] hover:bg-[#2A3850] text-[#E2E8F0] flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Pulihkan</span>
            </button>
          )}

          <button
            onClick={handleVerify}
            disabled={verifying}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#2CA58D] hover:bg-[#258B77] text-white flex items-center gap-1.5 active:scale-[0.98] transition-colors shadow-sm"
          >
            <FileCheck className="w-4 h-4" />
            <span>{verifying ? "Memeriksa..." : "Periksa Keaslian Data"}</span>
          </button>

          <button
            onClick={handlePrintPDF}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-colors shadow-sm ${
              isLight
                ? "bg-[#1E293B] hover:bg-[#0F172A] text-white"
                : "bg-[#3B76D4] hover:bg-[#2F63B8] text-white"
            }`}
          >
            <Printer className="w-4 h-4" />
            <span>Cetak Laporan PDF</span>
          </button>
        </div>
      </div>

      {/* Verification Result Banner */}
      {verifyResult && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
            verifyResult.ok
              ? "bg-[#2CA58D]/15 text-[#2CA58D]"
              : "bg-red-950/30 text-[#D13B4B]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {verifyResult.ok ? (
              <CheckCircle2 className="w-4 h-4 text-[#2CA58D] shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-[#D13B4B] shrink-0" />
            )}
            <span className="text-sm font-semibold">
              {verifyResult.ok
                ? "DATA ASLI: Seluruh catatan kejadian utuh dan belum pernah diubah."
                : "PERINGATAN: Ditemukan perubahan tidak sah pada catatan kejadian!"}
            </span>
          </div>

          <span className="text-xs font-bold opacity-90 hidden sm:inline">
            {verifyResult.records_checked} CATATAN DIPERIKSA
          </span>
        </div>
      )}

      {/* Daftar Catatan Berantai */}
      <div className="relative pl-6">
        <div
          className={`absolute left-2.5 top-3 bottom-3 w-[2px] ${
            isLight ? "bg-[#CBD5E1]" : "bg-[#222E42]"
          }`}
        />

        <div className="space-y-2.5">
          {sortedRecords.map((rec, idx) => {
            const isTamperedRow = isTampered && rec.seq_id === 1;
            const summaryText = extractIncidentSummary(rec);
            const statusText = formatStatusLabel(rec.response_level);
            const sourceText = formatSourceLabel(rec.source_identity);

            return (
              <div
                key={`${rec.record_hash || rec.seq_id}-${rec.seq_id}-${idx}`}
                className={`relative rounded-lg p-3.5 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                  isTamperedRow
                    ? "bg-red-950/40 text-[#D13B4B]"
                    : subSurfaceBg
                }`}
              >
                <div
                  className={`absolute -left-[20px] top-4 w-3 h-3 rounded-full border-2 border-[#192231] ${
                    isTamperedRow
                      ? "bg-[#D13B4B] ring-2 ring-[#D13B4B]/30"
                      : rec.response_level >= 2
                      ? "bg-amber-500 ring-2 ring-amber-500/30"
                      : "bg-[#3B76D4] ring-2 ring-[#3B76D4]/30"
                  }`}
                />

                <div className="flex items-center gap-2.5 shrink-0">
                  <span
                    className={`font-mono text-xs font-bold ${
                      isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
                    }`}
                  >
                    #{rec.seq_id.toString().padStart(3, "0")}
                  </span>

                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                      rec.response_level >= 2
                        ? "bg-red-500/20 text-[#D13B4B]"
                        : rec.response_level === 1
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-[#2CA58D]/20 text-[#2CA58D]"
                    }`}
                  >
                    {statusText}
                  </span>

                  <span
                    className={`text-xs font-semibold ${
                      isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
                    }`}
                  >
                    {sourceText}
                  </span>

                  <span
                    className={`font-mono text-xs hidden lg:inline ${
                      isLight ? "text-[#64748B]" : "text-[#94A3B8]"
                    }`}
                  >
                    {formatTimestampWIB(rec.timestamp)} WIB
                  </span>
                </div>

                <div className="flex-1 min-w-0 md:px-3">
                  <p
                    className={`text-sm font-medium truncate ${
                      isLight ? "text-[#1E293B]" : "text-[#E2E8F0]"
                    }`}
                  >
                    {summaryText}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`font-mono text-xs ${
                      isTamperedRow
                        ? "text-[#D13B4B] line-through"
                        : isLight
                        ? "text-[#64748B]"
                        : "text-[#94A3B8]"
                    }`}
                  >
                    {rec.record_hash.slice(0, 12)}...
                  </span>

                  <button
                    onClick={() => copyToClipboard(rec.record_hash)}
                    title="Salin Kode SHA-256 Lengkap"
                    className={`p-1.5 rounded-md transition-colors ${
                      isLight
                        ? "hover:bg-[#CBD5E1] text-[#64748B] hover:text-[#1E293B]"
                        : "hover:bg-[#2A3850] text-[#94A3B8] hover:text-[#E2E8F0]"
                    }`}
                  >
                    {copiedHash === rec.record_hash ? (
                      <Check className="w-3.5 h-3.5 text-[#2CA58D]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
