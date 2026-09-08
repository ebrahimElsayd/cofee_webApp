import { createSupabaseBrowserClient } from "@/shared/lib/supabase/browser";
import type { CustomizationDisplay, MenuCategory, MenuProduct } from "../types/menu";
import { readStoredMenuCatalog, writeStoredMenuCatalog } from "./menu-catalog-cache";

type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  name_ar: string;
  description: string | null;
  image_url: string | null;
  base_price: number;
  availability: "available" | "unavailable" | "hidden";
  allows_notes: boolean;
  category_id: string | null;
  menu_categories?: { code: string } | null;
  product_modifier_groups?: Array<{ sort_order: number; modifier_groups: { id: string; code?: string; name: string; name_ar: string; selection_type: "single" | "multiple" | "slider"; is_required: boolean; modifier_options: Array<{ id: string; name: string; name_ar: string; price_delta: number; is_available: boolean; sort_order: number }> } | null }>;
};

export type MenuCatalog = { categories: MenuCategory[]; products: MenuProduct[] };
let catalogCache: MenuCatalog | null = null;
let catalogCacheCafeId: string | null = null;
let catalogCacheVersion: number | null = null;
let catalogCachedAt = 0;
let catalogRequest: Promise<MenuCatalog> | null = null;
let catalogRequestCafeId: string | null = null;
const CATALOG_CACHE_TTL = 60_000;
const CATALOG_REQUEST_TIMEOUT_MS = 10_000;
const CATALOG_STORAGE_PREFIX = "kings-cafe:menu-catalog:";
let menuVersionRequest: Promise<number | null> | null = null;
let menuVersionCheckedAt = 0;
let menuVersionCafeId: string | null = null;
let menuVersionValue: number | null = null;
let versioningUnavailable = false;
const MENU_VERSION_TTL_MS = 15_000;

export function getCachedMenuCatalog(): MenuCatalog | null {
  const cafeId = getActiveCafeId();
  if (!cafeId) return null;
  if (catalogCache && catalogCacheCafeId === cafeId) return catalogCache;
  try {
    const stored = window.sessionStorage.getItem(`${CATALOG_STORAGE_PREFIX}${cafeId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as MenuCatalog;
    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.products)) return null;
    catalogCache = parsed;
    catalogCacheCafeId = cafeId;
    catalogCachedAt = Date.now();
    return parsed;
  } catch { return null; }
}

export function subscribeToMenuCatalog(onCatalogChanged: (catalog: MenuCatalog) => void): () => void {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return () => undefined;
  const cafeId = getActiveCafeId();
  if (!cafeId) return () => undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let disposed = false;
  let hiddenAt: number | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      catalogCache = null;
      catalogCacheCafeId = null;
      catalogCachedAt = 0;
      void getSupabaseMenuCatalog().then(onCatalogChanged).catch(() => undefined);
    }, 350);
  };
  const refreshOneProduct = (productId: string) => {
    void Promise.all([loadMenuProduct(cafeId, productId), getMenuVersion(cafeId, true)]).then(([product, version]) => {
      if (disposed || !catalogCache || catalogCacheCafeId !== cafeId) return;
      const products = product
        ? [...catalogCache.products.filter((item) => item.id !== product.id), product]
        : catalogCache.products.filter((item) => item.id !== productId);
      applyCatalogCache(cafeId, { ...catalogCache, products }, version);
      onCatalogChanged(catalogCache!);
    }).catch(scheduleRefresh);
  };
  const connect = () => {
    if (disposed) return;
    if (channel) void supabase.removeChannel(channel);
    channel = supabase
      .channel(`customer-menu-catalog:${cafeId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "menu_products", filter: `cafe_id=eq.${cafeId}` }, (payload) => refreshOneProduct(String((payload.new as { id?: string }).id ?? "")))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_products", filter: `cafe_id=eq.${cafeId}` }, (payload) => refreshOneProduct(String((payload.new as { id?: string }).id ?? "")))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "menu_products" }, (payload) => refreshOneProduct(String((payload.old as { id?: string }).id ?? "")))
      .on("postgres_changes", { event: "*", schema: "public", table: "product_availability" }, (payload) => refreshOneProduct(String(((payload.new ?? payload.old) as { product_id?: string }).product_id ?? "")))
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_categories", filter: `cafe_id=eq.${cafeId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "modifier_groups", filter: `cafe_id=eq.${cafeId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "modifier_options" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "product_modifier_groups" }, scheduleRefresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { reconnectAttempt = 0; return; }
        if (!disposed && ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, Math.min(1_000 * 2 ** reconnectAttempt++, 30_000));
        }
      });
  };
  const reconcile = () => {
    if (disposed) return;
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (!navigator.onLine) return;
    // Normal tab switching keeps the warm catalog and healthy Realtime socket.
    // Only a long background/sleep interval needs a defensive reconciliation.
    if (hiddenAt && Date.now() - hiddenAt >= 60_000) {
      scheduleRefresh();
      connect();
    }
    hiddenAt = null;
  };
  const reconcileOnline = () => {
    if (disposed || document.visibilityState !== "visible") return;
    scheduleRefresh();
    connect();
  };
  connect();
  window.addEventListener("online", reconcileOnline);
  document.addEventListener("visibilitychange", reconcile);
  return () => {
    disposed = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    window.removeEventListener("online", reconcileOnline);
    document.removeEventListener("visibilitychange", reconcile);
    if (channel) void supabase.removeChannel(channel);
  };
}

export async function getSupabaseMenuCatalog(options?: { forceRefresh?: boolean }): Promise<MenuCatalog> {
  if (options?.forceRefresh) {
    catalogCache = null;
    catalogCacheCafeId = null;
    catalogCachedAt = 0;
  }
  const activeCafeId = await resolveActiveCafeId();
  if (!activeCafeId) throw new Error("No active cafe context. Open the table QR code again.");
  const version = await getMenuVersion(activeCafeId, Boolean(options?.forceRefresh));
  if (version !== null) {
    if (catalogCache && catalogCacheCafeId === activeCafeId && catalogCacheVersion === version) return catalogCache;
    const stored = await readStoredMenuCatalog(activeCafeId);
    if (stored?.version === version) {
      applyCatalogCache(activeCafeId, stored.catalog, version);
      return stored.catalog;
    }
  } else if (catalogCache && catalogCacheCafeId === activeCafeId && Date.now() - catalogCachedAt < CATALOG_CACHE_TTL) return catalogCache;
  if (catalogRequest && catalogRequestCafeId === activeCafeId) return catalogRequest;
  catalogRequest = withTimeout(loadMenuCatalog(activeCafeId, version), CATALOG_REQUEST_TIMEOUT_MS);
  catalogRequestCafeId = activeCafeId;
  try {
    return await catalogRequest;
  } finally {
    catalogRequest = null;
    catalogRequestCafeId = null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Menu catalog request timed out")), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

async function loadMenuCatalog(cafeId: string, version: number | null = null): Promise<MenuCatalog> {
  const supabase = createSupabaseBrowserClient();
  const [categoriesResult, productsResult] = await Promise.all([
    supabase.from("menu_categories").select("id,code,name,name_ar").eq("cafe_id", cafeId).eq("is_active", true).order("sort_order"),
    supabase.from("menu_products").select("id,slug,name,name_ar,description,image_url,base_price,availability,allows_notes,category_id,product_modifier_groups(sort_order,modifier_groups(id,code,name,name_ar,selection_type,is_required,modifier_options(id,name,name_ar,price_delta,is_available,sort_order)))").eq("cafe_id", cafeId).neq("availability", "hidden").order("created_at"),
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (productsResult.error) throw productsResult.error;

  const categories: MenuCategory[] = [
    { id: "all", label: "All", labelAr: "الكل" },
    ...((categoriesResult.data ?? []).map((category) => ({
      id: category.code as MenuCategory["id"],
      label: category.name,
      labelAr: category.name_ar,
    }))),
  ];
  const categoryById = new Map((categoriesResult.data ?? []).map((category) => [category.id, category.code]));
  const products = (productsResult.data ?? []).map((product) => mapProduct(product as unknown as CatalogProduct, categoryById.get(product.category_id ?? "")));
  const catalog = { categories, products };
  applyCatalogCache(cafeId, catalog, version);
  return catalog;
}

async function loadMenuProduct(cafeId: string, productId: string): Promise<MenuProduct | null> {
  if (!productId) return null;
  const supabase = createSupabaseBrowserClient();
  const result = await supabase.from("menu_products")
    .select("id,slug,name,name_ar,description,image_url,base_price,availability,allows_notes,category_id,menu_categories(code),product_modifier_groups(sort_order,modifier_groups(id,code,name,name_ar,selection_type,is_required,modifier_options(id,name,name_ar,price_delta,is_available,sort_order)))")
    .eq("cafe_id", cafeId).eq("id", productId).neq("availability", "hidden").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const row = result.data as unknown as CatalogProduct;
  return mapProduct(row, row.menu_categories?.code);
}

function applyCatalogCache(cafeId: string, catalog: MenuCatalog, version: number | null = null) {
  catalogCache = catalog;
  catalogCacheCafeId = cafeId;
  catalogCacheVersion = version;
  catalogCachedAt = Date.now();
  try { window.sessionStorage.setItem(`${CATALOG_STORAGE_PREFIX}${cafeId}`, JSON.stringify(catalog)); } catch { /* cache is best effort */ }
  if (version !== null) void writeStoredMenuCatalog({ cafeId, version, catalog, savedAt: Date.now() });
}

async function getMenuVersion(cafeId: string, force = false): Promise<number | null> {
  if (versioningUnavailable) return null;
  if (!force && menuVersionCafeId === cafeId && Date.now() - menuVersionCheckedAt < MENU_VERSION_TTL_MS) return menuVersionValue;
  if (menuVersionRequest && menuVersionCafeId === cafeId) return menuVersionRequest;
  const pointer = getActiveTableSessionPointer();
  if (!pointer?.sessionId || pointer.cafeId !== cafeId) return null;
  const supabase = createSupabaseBrowserClient();
  menuVersionCafeId = cafeId;
  menuVersionRequest = Promise.resolve(supabase.rpc("get_customer_menu_version", { p_cafe_id: cafeId, p_session_id: pointer.sessionId }))
    .then(({ data, error }) => {
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") versioningUnavailable = true;
        return null;
      }
      const version = Number(data);
      menuVersionValue = Number.isFinite(version) ? version : null;
      menuVersionCheckedAt = Date.now();
      return menuVersionValue;
    })
    .finally(() => { menuVersionRequest = null; });
  return menuVersionRequest;
}

function getActiveCafeId(): string | null {
  try {
    const raw = window.localStorage.getItem("kings-cafe:active-table-session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cafeId?: unknown };
    return typeof parsed.cafeId === "string" && parsed.cafeId.length > 0 ? parsed.cafeId : null;
  } catch {
    return null;
  }
}

function getActiveTableSessionPointer(): { sessionId: string; cafeId: string } | null {
  try {
    const raw = window.localStorage.getItem("kings-cafe:active-table-session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId?: unknown; cafeId?: unknown };
    return typeof parsed.sessionId === "string" && typeof parsed.cafeId === "string" ? { sessionId: parsed.sessionId, cafeId: parsed.cafeId } : null;
  } catch { return null; }
}

async function resolveActiveCafeId(): Promise<string | null> {
  const cachedCafeId = getActiveCafeId();
  if (cachedCafeId) return cachedCafeId;
  try {
    const raw = window.localStorage.getItem("kings-cafe:active-table-session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId?: unknown; tableId?: unknown };
    if (typeof parsed.sessionId !== "string") return null;
    const supabase = createSupabaseBrowserClient();
    const result = await supabase.from("table_sessions").select("id,table_id,cafe_tables(cafe_id)").eq("id", parsed.sessionId).maybeSingle();
    if (result.error) throw result.error;
    const relation = Array.isArray(result.data?.cafe_tables) ? result.data?.cafe_tables[0] : result.data?.cafe_tables;
    const cafeId = typeof relation?.cafe_id === "string" ? relation.cafe_id : null;
    if (cafeId) window.localStorage.setItem("kings-cafe:active-table-session", JSON.stringify({ ...parsed, cafeId }));
    return cafeId;
  } catch {
    return null;
  }
}

function mapProduct(product: CatalogProduct, categoryCode?: string): MenuProduct {
  const customizationGroups: MenuProduct["customizationGroups"] = (product.product_modifier_groups ?? [])
    .filter((link) => link.modifier_groups)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((link) => {
      const group = link.modifier_groups!;
      const isSugarGroup = group.code?.startsWith("sugar") ||
        group.name.trim().toLocaleLowerCase() === "sugar level" ||
        group.name_ar.trim() === "مستوى السكر";
      return {
        id: group.id,
        label: group.name,
        labelAr: group.name_ar,
        required: group.is_required,
        display: (isSugarGroup || group.selection_type === "slider" ? "curve" : group.selection_type === "multiple" ? "cards" : "segmented") as CustomizationDisplay,
        options: group.modifier_options
          .filter((option) => option.is_available)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((option) => ({ id: option.id, label: option.name, labelAr: option.name_ar, price: Number(option.price_delta), available: option.is_available })),
      };
    });
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    nameAr: product.name_ar,
    description: product.description ?? "",
    categoryId: (categoryCode ?? "specialty") as MenuProduct["categoryId"],
    price: Number(product.base_price),
    imageUrl: getOptimizedImageUrl(product.image_url),
    imageAlt: product.name,
    availability: product.availability === "available" ? "available" : "sold-out",
    allowsNotes: product.allows_notes,
    customizationGroups,
    searchTerms: [product.name, product.name_ar, product.slug],
  };
}

function getOptimizedImageUrl(url: string | null): string {
  const normalized = url?.trim() ?? "";
  if (!normalized || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?\//i.test(normalized)) return "";
  if (!/^(\/|https?:\/\/|data:image\/)/i.test(normalized)) return "";
  return normalized;
}
