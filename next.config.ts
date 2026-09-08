import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.17", "localhost"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
