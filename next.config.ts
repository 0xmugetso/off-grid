import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.1.5"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
