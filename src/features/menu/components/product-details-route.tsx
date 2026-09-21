"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductDetailsScreen } from "@/features/menu/components/product-details-screen";
import { getSupabaseMenuCatalog } from "@/features/menu/services/supabase-menu.service";
import { TableSessionClosedError, validateOrderableTableSession } from "@/features/table-navigation/services/supabase-order-tracking.service";
import type { MenuProduct } from "@/features/menu/types/menu";

export function ProductDetailsRoute({ tableId, productSlug }: { tableId: number; productSlug: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<MenuProduct | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

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

    void validateOrderableTableSession(tableId)
      .then(() => getSupabaseMenuCatalog({ tableId }))
      .then(async (catalog) => {
        let match = findProduct(catalog);
        // A catalog Realtime event can update the menu card just before this
        // route is opened. Force one fresh read so details never use an older
        // module cache and incorrectly report a newly-created product missing.
        if (!match) {
          match = findProduct(await getSupabaseMenuCatalog({ forceRefresh: true, tableId }));
        }
        if (!active) return;
        setProduct(match ?? null);
        setState(match ? "ready" : "error");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof TableSessionClosedError) {
          router.replace(`/table/${tableId}?session=closed`);
          return;
        }
        setErrorMessage("تعذّر التحقق من جلسة الطاولة أو تحميل المنتج. تحقق من الاتصال وأعد المحاولة، أو امسح رمز الطاولة إذا لم تبدأ جلسة على هذا الجهاز.");
        setState("error");
      });
    return () => { active = false; };
  }, [productSlug, router, tableId, attempt]);

  if (state === "loading") return <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", color: "#e0a020", background: "#0b0c0a" }}>Loading product…</main>;
  if (state === "error") return <main dir="rtl" style={{ minHeight: "100svh", display: "grid", placeItems: "center", color: "#f2ede4", background: "#0b0c0a", padding: 24 }}><section role="alert"><p>{errorMessage || "هذا المنتج غير موجود في المنيو الحالية."}</p><button type="button" onClick={() => { setState("loading"); setErrorMessage(""); setAttempt((value) => value + 1); }}>إعادة المحاولة</button><p><a href={`/table/${tableId}/menu`}>العودة إلى المينيو</a></p></section></main>;
  if (!product) return null;
  return <ProductDetailsScreen product={product} tableId={tableId} />;
}
