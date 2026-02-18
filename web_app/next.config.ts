
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config) => {
    config.externals.push('better-sqlite3');
    return config;
  },
};

export default nextConfig;
