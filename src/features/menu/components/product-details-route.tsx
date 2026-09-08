"use client";

import { useEffect, useState } from "react";
import { ProductDetailsScreen } from "@/features/menu/components/product-details-screen";
import { getSupabaseMenuCatalog } from "@/features/menu/services/supabase-menu.service";
import type { MenuProduct } from "@/features/menu/types/menu";

export function ProductDetailsRoute({ tableId, productSlug }: { tableId: number; productSlug: string }) {
  const [product, setProduct] = useState<MenuProduct | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    const findProduct = (catalog: Awaited<ReturnType<typeof getSupabaseMenuCatalog>>) => {
      let decodedSlug = productSlug;
      try {
        decodedSlug = decodeURIComponent(productSlug);
      } catch {
        // Next normally gives us a decoded segment; keep the original if malformed.
      }
      const normalizedSlug = decodedSlug.trim().toLocaleLowerCase();
      return catalog.products.find((item) =>
        item.slug === decodedSlug ||
        item.slug.trim().toLocaleLowerCase() === normalizedSlug,
      );
    };

    void getSupabaseMenuCatalog()
      .then(async (catalog) => {
        let match = findProduct(catalog);
        // A catalog Realtime event can update the menu card just before this
        // route is opened. Force one fresh read so details never use an older
        // module cache and incorrectly report a newly-created product missing.
        if (!match) {
          match = findProduct(await getSupabaseMenuCatalog({ forceRefresh: true }));
        }
        if (!active) return;
        setProduct(match ?? null);
        setState(match ? "ready" : "error");
      })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [productSlug]);

  if (state === "loading") return <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", color: "#e0a020", background: "#0b0c0a" }}>Loading product…</main>;
  if (!product) return <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", color: "#f2ede4", background: "#0b0c0a" }}>Product unavailable</main>;
  return <ProductDetailsScreen product={product} tableId={tableId} />;
}
