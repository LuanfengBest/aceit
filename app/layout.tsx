import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
