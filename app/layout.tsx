import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Instrument_Serif } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-instrument-serif",
});

// 参考 demo 的 UI 标签用等宽字 + 宽字距
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "aceit",
  description: "面试打磨系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh"
      className={`${inter.variable} ${instrumentSerif.variable} ${plexMono.variable}`}
    >
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
