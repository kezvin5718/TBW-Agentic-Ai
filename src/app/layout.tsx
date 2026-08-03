import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tbw-os — TBW Advertising",
  description: "Agentic AI Operations System for TBW Advertising",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
