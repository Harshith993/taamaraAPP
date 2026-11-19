import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

// Fonts are downloaded at build time and served from our own server: no requests to Google from users' phones.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-space-grotesk", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Taamara Taamara", template: "%s · Taamara Taamara" },
  description: "Taamara Taamara: bookings, vendors, crew, tasks and money in one place.",
  applicationName: "Taamara Taamara",
  appleWebApp: { capable: true, title: "Taamara", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every page is rendered per request, so each gets its own CSP nonce (src/proxy.ts).
  await connection();
  return (
    <html lang="en-IN" className={`${spaceGrotesk.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
