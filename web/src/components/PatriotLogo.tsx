import React from "react";

interface PatriotLogoProps {
  className?: string;
  size?: number | string;
}

export default function PatriotLogo({
  className = "w-7 h-7",
  size,
}: PatriotLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size || "100%"}
      height={size || "100%"}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        filter: "drop-shadow(0 0 8px rgba(37, 99, 235, 0.45))",
      }}
    >
      <defs>
        {/* Main Left Facet Gradient */}
        <linearGradient id="pLogoLeft" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>

        {/* Main Right Facet Gradient (Shadowed Depth) */}
        <linearGradient id="pLogoRight" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="60%" stopColor="#1e40af" />
          <stop offset="100%" stopColor="#172554" />
        </linearGradient>

        {/* Top-Left Bevel (Cyan Light Reflection) */}
        <linearGradient id="pLogoTopLeft" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#93c5fd" />
          <stop offset="40%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>

        {/* Top-Right Bevel */}
        <linearGradient id="pLogoTopRight" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>

        {/* Core Node Glow Filter */}
        <filter id="pLogoGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 100% PURE VECTOR SHIELD - ZERO BACKGROUND BOX */}
      <g id="patriot-shield-geometry">
        {/* Top-Left Facet */}
        <polygon points="50,15 25,32 50,44" fill="url(#pLogoTopLeft)" />

        {/* Top-Right Facet */}
        <polygon points="50,15 75,32 50,44" fill="url(#pLogoTopRight)" />

        {/* Main Left Body Facet */}
        <polygon points="50,44 25,32 29,62 50,88" fill="url(#pLogoLeft)" />

        {/* Main Right Body Facet */}
        <polygon points="50,44 75,32 71,62 50,88" fill="url(#pLogoRight)" />

        {/* Center Ridge Seam Line */}
        <line
          x1="50"
          y1="16"
          x2="50"
          y2="87"
          stroke="#93c5fd"
          strokeWidth="0.85"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* Glowing Cyan Center Nexus Sensor */}
        <circle
          cx="50"
          cy="44"
          r="3"
          fill="#38bdf8"
          opacity="0.45"
          filter="url(#pLogoGlow)"
        />
        <circle cx="50" cy="44" r="1.6" fill="#38bdf8" />
        <circle cx="50" cy="44" r="0.8" fill="#ffffff" />
      </g>
    </svg>
  );
}
