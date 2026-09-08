"use client";

import { ResilientImage } from "@/shared/presentation/components/resilient-image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getCartUpdatedEventName,
  getSharedDraftCart,
} from "@/features/cart/services/local-draft-cart.service";
import { getCachedMenuCatalog, getSupabaseMenuCatalog, subscribeToMenuCatalog } from "../services/supabase-menu.service";
import type { MenuCategoryId, MenuProduct } from "../types/menu";
import { getStoredTableSession } from "@/features/table-session/services/local-table-session.service";
import styles from "./menu-screen.module.css";

type MenuScreenProps = {
  tableId: number;
};

export function MenuScreen({ tableId }: MenuScreenProps) {
  const pathname = usePathname();
  const router = useRouter();
  const initialCatalog = getCachedMenuCatalog();
  const [activeCategory, setActiveCategory] = useState<MenuCategoryId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cartSummary, setCartSummary] = useState({ items: 0, total: 0 });
  const [addedMessage, setAddedMessage] = useState("");
  const [catalogCategories, setCatalogCategories] = useState<{ id: MenuCategoryId; label: string; labelAr: string }[]>(initialCatalog?.categories ?? []);
  const [catalogProducts, setCatalogProducts] = useState<MenuProduct[]>(initialCatalog?.products ?? []);
  const [catalogError, setCatalogError] = useState("");
  const [isCatalogLoading, setIsCatalogLoading] = useState(!initialCatalog);

  // Route changes represent a new menu visit; reset transient filters.
  useEffect(() => {
    // A fresh visit to the menu must never inherit a previous search or category.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchQuery("");
    setActiveCategory("all");
  }, [pathname, tableId]);

  useEffect(() => {
    let active = true;
    const session = getStoredTableSession();
    if (!session || session.tableId !== tableId) {
      router.replace("/");
      return () => { active = false; };
    }
    const applyCatalog = (catalog: Awaited<ReturnType<typeof getSupabaseMenuCatalog>>) => {
      if (!active) return;
      setCatalogCategories(catalog.categories);
      setCatalogProducts(catalog.products);
      setCatalogError("");
      setIsCatalogLoading(false);
    };
    const refreshCatalog = (forceRefresh = false) => getSupabaseMenuCatalog({ forceRefresh }).then(applyCatalog);

    void refreshCatalog()
      .catch(() => { if (active) { setCatalogError("تعذر تحميل قائمة المنتجات من الخادم."); setIsCatalogLoading(false); } });
    const unsubscribeCatalog = subscribeToMenuCatalog((catalog) => {
      if (!active) return;
      setCatalogCategories(catalog.categories);
      setCatalogProducts(catalog.products);
      setCatalogError("");
      setIsCatalogLoading(false);
    });
    let messageTimer: number | undefined;
    let hideMessageTimer: number | undefined;
    try {
      const value = window.sessionStorage.getItem("kings-cafe:last-added-product");
      if (value) {
        const product = JSON.parse(value) as { productName?: string };
        if (product.productName) {
          messageTimer = window.setTimeout(
            () => {
              setAddedMessage(`${product.productName} تمت إضافته للكارت`);
              hideMessageTimer = window.setTimeout(() => setAddedMessage(""), 2800);
            },
            0,
          );
          window.sessionStorage.removeItem("kings-cafe:last-added-product");
        }
      }
    } catch {
      window.sessionStorage.removeItem("kings-cafe:last-added-product");
    }

    function refreshCartSummary() {
      void getSharedDraftCart(tableId)
        .then((cart) => setCartSummary({
          items: cart.reduce((total, item) => total + item.quantity, 0),
          total: cart.reduce((total, item) => total + item.totalPrice, 0),
        }))
        .catch(() => setCartSummary({ items: 0, total: 0 }));
    }

    const initialTimer = window.setTimeout(refreshCartSummary, 0);
    const eventName = getCartUpdatedEventName();
    window.addEventListener(eventName, refreshCartSummary);

    return () => {
      active = false;
      unsubscribeCatalog();
      window.clearTimeout(initialTimer);
      if (messageTimer) window.clearTimeout(messageTimer);
      if (hideMessageTimer) window.clearTimeout(hideMessageTimer);
      window.removeEventListener(eventName, refreshCartSummary);
    };
  }, [router, tableId]);

  const visibleProducts = useMemo(() => {
    const query = normalizeText(searchQuery);

    return catalogProducts.filter((product) => {
      const matchesCategory =
        activeCategory === "all" || product.categoryId === activeCategory;

      if (!matchesCategory) return false;
      if (!query) return true;

      const searchableText = normalizeText(
        [product.name, product.nameAr, ...product.searchTerms].join(" "),
      );

      return searchableText.includes(query);
    });
  }, [activeCategory, catalogProducts, searchQuery]);

  return (
    <main className={styles.page}>
      <div className={styles.ambientGlow} aria-hidden="true" />

      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 lang="en">Menu</h1>
            <p>قائمة الطلبات</p>
          </div>

          <div className={styles.tableBadge} aria-label={`Table ${tableId}, live`}>
            <span aria-hidden="true" />
            <b lang="en">Table {tableId}</b>
          </div>
        </header>

        {addedMessage && (
          <div className={styles.addedToast} role="status">
            <span aria-hidden="true">✓</span>
            <div><strong>{addedMessage}</strong><small>يمكنك إضافة منتجات أخرى أو فتح الكارت</small></div>
          </div>
        )}

        <label className={styles.searchField}>
          <span className="sr-only">ابحث في قائمة المنتجات</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16.2 16.2 4 4" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search... / ابحث"
            autoComplete="off"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} aria-label="مسح البحث">
              ×
            </button>
          )}
        </label>

        <nav className={styles.categories} aria-label="تصنيفات القائمة">
          {catalogCategories.map((category) => {
            const isActive = category.id === activeCategory;

            return (
              <button
                key={category.id}
                type="button"
                className={isActive ? styles.activeCategory : undefined}
                aria-pressed={isActive}
                onClick={() => setActiveCategory(category.id)}
              >
                <span lang="en">{category.label}</span>
                <small>{category.labelAr}</small>
              </button>
            );
          })}
        </nav>

        {catalogError ? <section className={styles.emptyState} role="alert"><h2>{catalogError}</h2><p>تحقق من اتصال التطبيق ثم أعد المحاولة.</p></section> : isCatalogLoading ? (
          <section className={styles.emptyState} aria-busy="true"><h2>جاري تحميل القائمة…</h2><p>لحظات ونجهز لك المشروبات.</p></section>
        ) : visibleProducts.length > 0 ? (
          <section className={styles.productGrid} aria-label="منتجات القائمة">
            {visibleProducts.map((product, index) => (
              <ProductCard key={product.id} product={product} tableId={tableId} priority={index < 2} />
            ))}
          </section>
        ) : (
          <EmptyResults onReset={() => { setSearchQuery(""); setActiveCategory("all"); }} />
        )}

        {cartSummary.items > 0 && (
          <a className={styles.cartBar} href={`/table/${tableId}/cart`}>
            <span><b>{cartSummary.items}</b><small lang="en">Items</small></span>
            <strong lang="en">View Table Cart<small>عرض طلب الطاولة</small></strong>
            <b>{cartSummary.total}<small lang="en"> EGP</small></b>
          </a>
        )}


      </div>
    </main>
  );
}

function ProductCard({
  product,
  tableId,
  priority,
}: {
  product: MenuProduct;
  tableId: number;
  priority: boolean;
}) {
  const isSoldOut = product.availability === "sold-out";
  const content = (
    <>
      <div className={styles.productImage}>
        <ResilientImage src={product.imageUrl} fallbackSrc={`/images/products/${product.slug}.webp`}
          alt={product.imageAlt}
          fill
          sizes="(max-width: 520px) 46vw, 220px"
          priority={priority} />
        {product.badge && <span className={styles.productBadge}>{product.badge}</span>}
        {isSoldOut && <span className={styles.soldOut}>نفد مؤقتًا</span>}
      </div>

      <div className={styles.productBody}>
        <h2 lang="en">{product.name}</h2>
        <p>{product.nameAr}</p>
        <div className={styles.productFooter}>
          <strong>{product.price}<small lang="en"> EGP</small></strong>
          <span className={styles.detailsButton} aria-hidden="true">
            {isSoldOut ? "—" : "+"}
          </span>
        </div>
      </div>
    </>
  );

  if (isSoldOut) {
    return <article className={`${styles.productCard} ${styles.unavailableCard}`}>{content}</article>;
  }

  return (
    <Link
      className={styles.productCard}
      href={`/table/${tableId}/menu/product/${product.slug}`}
      prefetch
      aria-label={`${product.name}، ${product.price} جنيه، عرض التفاصيل`}
    >
      {content}
    </Link>
  );
}

function EmptyResults({ onReset }: { onReset: () => void }) {
  return (
    <section className={styles.emptyState} aria-live="polite">
      <div aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m16.2 16.2 4 4" /></svg>
      </div>
      <h2>لم نجد مشروبًا بهذا الاسم</h2>
      <p>جرّب البحث باسم آخر أو اختر تصنيفًا مختلفًا.</p>
      <button type="button" onClick={onReset}>عرض كل المنتجات</button>
    </section>
  );
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ar")
    .normalize("NFKD")
    .replace(/[ًٌٍَُِّْـ]/g, "");
}
