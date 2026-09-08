"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";

const BUNDLED_PRODUCT_IMAGES = new Set([
  "black-tea", "cardamom-cappuccino", "chocolate-brownie", "coca-cola",
  "sparkling-water", "signature-espresso", "royal-matcha", "lotus-cheesecake",
  "ice-mocha-deluxe", "fresh-orange-juice", "cold-brew-reserve",
]);

type ResilientImageProps = Omit<ImageProps, "src"> & {
  src?: string | null;
  fallbackSrc?: string | null;
  fallbackLabel?: string;
};

export function ResilientImage({ src, fallbackSrc, fallbackLabel = "☕", alt = "", className, onError, ...props }: ResilientImageProps) {
  const primary = normalizeImageSource(src);
  const fallback = normalizeFallbackImageSource(fallbackSrc);
  const [currentSrc, setCurrentSrc] = useState(primary ?? fallback);
  const [failed, setFailed] = useState(!primary && !fallback);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentSrc(primary ?? fallback);
    setFailed(!primary && !fallback);
  }, [primary, fallback]);

  if (failed || !currentSrc) {
    return <span className="absolute inset-0 grid place-items-center bg-white/[.06] text-2xl text-white/45" aria-label={alt}>{fallbackLabel}</span>;
  }

  return (
    <Image
      {...props}
      src={currentSrc}
      alt={alt}
      className={className}
      unoptimized
      onError={(event) => {
        onError?.(event);
        if (fallback && currentSrc !== fallback) setCurrentSrc(fallback);
        else setFailed(true);
      }}
    />
  );
}

export function normalizeImageSource(value?: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith("blob:") || normalized.startsWith("javascript:")) return null;
  if (normalized.startsWith("/") || normalized.startsWith("data:image/")) return normalized;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeFallbackImageSource(value?: string | null): string | null {
  const normalized = normalizeImageSource(value);
  if (!normalized) return null;
  const match = normalized.match(/^\/images\/products\/([^/]+)\.webp$/);
  return match && !BUNDLED_PRODUCT_IMAGES.has(match[1]) ? null : normalized;
}
