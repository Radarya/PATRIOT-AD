import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PATRIOT-AD | Pusat Pengawasan Gudang Amunisi Siber-Fisik TNI-AD",
  description:
    "Sistem pertahanan operasional (OT) militer otonom dengan korelasi lintas-sinyal telemetri, audit forensik berantai SHA-256, dan grafik tren sensor siber-fisik realtime.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/patriot-logo.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/patriot-logo.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("patriot_theme")?.value;
  const theme = themeCookie === "light" ? "light" : "dark";

  return (
    <html
      lang="id"
      className={`h-full ${theme}`}
      data-theme={theme}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var m = document.cookie.match(/(?:^|;\\s*)patriot_theme=(dark|light)/);
                  var saved = m ? m[1] : (localStorage.getItem('patriot_theme') || '${theme}');
                  var root = document.documentElement;
                  root.classList.remove(saved === 'dark' ? 'light' : 'dark');
                  root.classList.add(saved);
                  root.setAttribute('data-theme', saved);
                  if (!m && (saved === 'dark' || saved === 'light')) {
                    document.cookie = 'patriot_theme=' + saved + '; path=/; max-age=31536000; SameSite=Lax';
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${inter.variable} font-sans min-h-full flex flex-col antialiased selection:bg-[#3B76D4]/30 selection:text-[#E2E8F0] ${
          theme === "light"
            ? "bg-[#EEF2F6] text-[#1E293B]"
            : "bg-[#111722] text-[#E2E8F0]"
        }`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
