import type { NextConfig } from "next";

function productImageRemotePattern() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const patterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [{
    protocol: "https",
    hostname: "**.supabase.co",
    pathname: "/storage/v1/object/public/product-images/**",
  }];
  if (!configuredUrl) return patterns;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:") return patterns;
    patterns.push({
      protocol: "https" as const,
      hostname: url.hostname,
      port: url.port,
      pathname: "/storage/v1/object/public/product-images/**",
    });
    return patterns;
  } catch {
    return patterns;
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
