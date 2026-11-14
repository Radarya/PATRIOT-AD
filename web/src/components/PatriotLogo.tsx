import React from "react";
import Image from "next/image";

interface PatriotLogoProps {
  className?: string;
  size?: number | string;
}

export default function PatriotLogo({
  className = "w-7 h-7",
  size,
}: PatriotLogoProps) {
  const numericSize = typeof size === "number" ? size : 64;

  return (
    <Image
      src="/patriot-logo.png"
      alt="Logo PATRIOT-AD"
      width={numericSize}
      height={numericSize}
      priority
      className={`object-contain select-none shrink-0 ${className}`}
      style={{
        ...(typeof size === "number" || typeof size === "string"
          ? { width: size, height: size }
          : {}),
        filter: "drop-shadow(0 0 6px rgba(96, 165, 250, 0.35))",
      }}
    />
  );
}
