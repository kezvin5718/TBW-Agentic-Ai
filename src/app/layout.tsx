import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// The Beta theme's typeface. Loaded once for the whole app; only the Beta
// theme uses it (see html.beta in globals.css), so nothing else changes.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "TBW — The Brand Wagon",
  description: "Agentic AI Operations System for TBW Advertising",
  // The tab icon comes from src/app/icon.png (and apple-icon.png) — Next picks
  // them up by filename. Declaring icons here would override that.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The class list is finished before React arrives (the theme script
    // below adds "light" / "beta"), so React must not fight it.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased">
        {/* Apply saved day/night theme before paint to avoid a flash */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("tbw_theme")==="light")document.documentElement.classList.add("light");if(localStorage.getItem("tbw_beta")==="on")document.documentElement.classList.add("beta")}catch(e){}` }} />
        {children}
      </body>
    </html>
  );
}
