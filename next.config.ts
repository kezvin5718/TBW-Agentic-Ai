import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep pdf-parse out of the bundler (it loads its own pdf.js at runtime).
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
