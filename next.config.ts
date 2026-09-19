import type { NextConfig } from "next";

function productImageRemotePattern() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return [];
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:") return [];
    return [{
      protocol: "https" as const,
      hostname: url.hostname,
      port: url.port,
      pathname: "/storage/v1/object/public/product-images/**",
    }];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.17", "localhost"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: {
    remotePatterns: productImageRemotePattern(),
  },
};

export default nextConfig;
