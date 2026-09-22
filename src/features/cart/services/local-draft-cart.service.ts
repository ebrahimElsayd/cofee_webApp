import type {
  DraftCartItem,
  NewDraftCartItem,
  SubmittedTableOrder,
} from "../types/draft-cart";
import { createSupabaseBrowserClient } from "@/shared/lib/supabase/browser";
import { generateSafeUUID } from "@/shared/utils/uuid";
import { getStoredTableSession } from "@/features/table-session/services/local-table-session.service";
import type { RealtimeChannel } from "@supabase/supabase-js";

const CART_UPDATED_EVENT = "kings-cafe:draft-cart-updated";
const ACTIVE_SESSION_KEY = "kings-cafe:active-table-session";
const ORDERABLE_SESSION_STATUSES = new Set(["active", "open", "ordering"]);
const CART_REQUEST_TIMEOUT_MS = 12_000;

type ActiveSessionPointer = { sessionId: string; tableId: number; cafeId: string; guestId?: string };
type VerifiedSession = ActiveSessionPointer & { guestId: string; tableUuid: string };
export type SharedDraftCartState = {
  items: DraftCartItem[];
  responsibleGuestId: string | null;
  responsibleName: string;
  isCurrentGuestResponsible: boolean;
  hasPreviousOrders: boolean;
  canCurrentGuestSubmit: boolean;
};

function getStorageKey(tableId: number) {
  return `kings-cafe:table:${tableId}:draft-cart:v2`;
}

function getSubmittedOrderStorageKey(tableId: number) {
  return `kings-cafe:table:${tableId}:last-submitted-order:v1`;
}

function getSubmittedOrderHistoryStorageKey(tableId: number) {
  return `kings-cafe:table:${tableId}:submitted-orders:v1`;
}

const MAX_LOCAL_SUBMITTED_ORDERS = 3;

/**
 * The local snapshot is only a UI convenience; Supabase is the source of truth.
 * Never persist a camera/data URL here because one image can exceed the browser
 * quota by itself. Remote URLs are safe to retain for the offline summary.
 */
function compactSubmittedOrder(order: SubmittedTableOrder): SubmittedTableOrder {
  return {
    ...order,
    items: order.items.map((item) => ({
      ...item,
      productImageUrl: item.productImageUrl.startsWith("data:") ? "" : item.productImageUrl,
    })),
  };
}

function persistSubmittedOrderSnapshot(
  tableId: number,
  order: SubmittedTableOrder,
  appendToHistory: boolean,
) {
  const compactOrder = compactSubmittedOrder(order);
  const latestKey = getSubmittedOrderStorageKey(tableId);
  const historyKey = getSubmittedOrderHistoryStorageKey(tableId);

  try {
    if (appendToHistory) {
      const history = [...getLocalSubmittedOrders(tableId), compactOrder].slice(-MAX_LOCAL_SUBMITTED_ORDERS);
      window.localStorage.setItem(historyKey, JSON.stringify(history));
    }
    window.localStorage.setItem(latestKey, JSON.stringify(compactOrder));
  } catch {
    // A full browser quota must never turn a successful order into a failure.
    // Drop the optional history and retry the small latest snapshot once.
    try {
      window.localStorage.removeItem(historyKey);
      window.localStorage.removeItem(latestKey);
      window.localStorage.setItem(latestKey, JSON.stringify(compactOrder));
    } catch {
      // Supabase already contains the order; the local snapshot can be omitted.
    }
  }
}

export function getLocalDraftCart(tableId: number): DraftCartItem[] {
  try {
    const value = window.localStorage.getItem(getStorageKey(tableId));
    if (!value) return [];

    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as DraftCartItem[]) : [];
  } catch {
    return [];
  }
}

export function addToLocalDraftCart(item: NewDraftCartItem): DraftCartItem {
  const draftItem: DraftCartItem = {
    ...item,
    id: createLocalCartItemId(),
    createdAt: new Date().toISOString(),
  };
  const currentCart = getLocalDraftCart(item.tableId);

  window.localStorage.setItem(
    getStorageKey(item.tableId),
    JSON.stringify([...currentCart, draftItem]),
  );
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));

  return draftItem;
}

function saveLocalDraftCart(tableId: number, items: DraftCartItem[]) {
  window.localStorage.setItem(getStorageKey(tableId), JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
}

export function updateLocalDraftCartItemQuantity(
  tableId: number,
  itemId: string,
  quantity: number,
) {
  const safeQuantity = Math.max(1, Math.min(10, Math.trunc(quantity)));
  const items = getLocalDraftCart(tableId).map((item) =>
    item.id === itemId
      ? { ...item, quantity: safeQuantity, totalPrice: item.unitPrice * safeQuantity }
      : item,
  );

  saveLocalDraftCart(tableId, items);
  return items;
}

export function removeLocalDraftCartItem(tableId: number, itemId: string) {
  const items = getLocalDraftCart(tableId).filter((item) => item.id !== itemId);
  saveLocalDraftCart(tableId, items);
  return items;
}

export function clearLocalDraftCart(tableId: number) {
  window.localStorage.removeItem(getStorageKey(tableId));
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
}

export function submitLocalTableOrder({
  tableId,
  items,
  submittedBy,
}: {
  tableId: number;
  items: DraftCartItem[];
  submittedBy: string;
}): SubmittedTableOrder {
  const order: SubmittedTableOrder = {
    id: `T${tableId}-${Date.now().toString(36).toUpperCase()}`,
    tableId,
    submittedBy,
    guestCount: new Set(items.map((item) => item.recipientName)).size,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    total: items.reduce((total, item) => total + item.totalPrice, 0),
    items,
    status: "sent",
    submittedAt: new Date().toISOString(),
  };

  persistSubmittedOrderSnapshot(tableId, order, true);
  clearLocalDraftCart(tableId);

  return order;
}

export async function submitSupabaseTableOrder({
  tableId,
  items,
  submittedBy,
}: {
  tableId: number;
  items: DraftCartItem[];
  submittedBy: string;
}): Promise<SubmittedTableOrder> {
  const session = await getVerifiedSession(tableId);
  const supabase = createSupabaseBrowserClient();
  const idempotencyKey = getOrCreateSubmitIdempotencyKey(session.sessionId);

  const { data: orderId, error: submitError } = await supabase.rpc("submit_table_order", {
    p_session_id: session.sessionId,
    p_table_id: session.tableUuid,
    p_items: items.map((item) => ({
      product_id: isUuid(item.productId) ? item.productId : null,
      recipient_name: item.recipientName,
      quantity: item.quantity,
      selected_modifier_option_ids: item.selectedOptions.map((option) => option.optionId),
      notes: item.notes || null,
    })),
    p_customer_notes: null,
    p_idempotency_key: idempotencyKey,
  });
  if (submitError || typeof orderId !== "string") throw submitError ?? new Error("Order was not created");

  // The RPC intentionally returns the opaque UUID for idempotent retries. Resolve
  // the human-facing sequential number separately and never expose that UUID in
  // customer UI. RLS scopes this lookup to the active table session.
  const { data: orderNumberRow, error: orderNumberError } = await supabase
    .from("orders")
    .select("order_number")
    .eq("id", orderId)
    .maybeSingle();
  const orderNumber = Number(orderNumberRow?.order_number);
  if (orderNumberError || !Number.isSafeInteger(orderNumber) || orderNumber < 1) {
    throw orderNumberError ?? new Error("Order number was not created");
  }
  clearSubmitIdempotencyKey(session.sessionId);
  // The submitted order is now canonical in Supabase. Remove the draft
  // immediately so a second screen/tab cannot resubmit stale cart items.
  clearLocalDraftCart(tableId);

  const order: SubmittedTableOrder = {
    id: orderId,
    orderNumber,
    tableId,
    submittedBy,
    guestCount: new Set(items.map((item) => item.recipientName)).size,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    total: items.reduce((total, item) => total + item.totalPrice, 0),
    items,
    status: "sent",
    submittedAt: new Date().toISOString(),
  };
  persistSubmittedOrderSnapshot(tableId, order, false);
  return order;
}

export function getCartUpdatedEventName() {
  return CART_UPDATED_EVENT;
}

export async function getSharedDraftCart(tableId: number): Promise<DraftCartItem[]> {
  return (await getSharedDraftCartState(tableId)).items;
}

export async function getSharedDraftCartState(tableId: number): Promise<SharedDraftCartState> {
  return getSupabaseDraftCartState(tableId);
}

export async function addToSharedDraftCart(item: NewDraftCartItem): Promise<DraftCartItem> {
  return addSupabaseDraftCartItem(item);
}

export async function removeFromSharedDraftCart(tableId: number, itemId: string) {
  const supabase = createSupabaseBrowserClient();
  await getVerifiedSession(tableId);
  if (!itemId) throw new Error("Cart item is required");
  const { error } = await supabase.from("cart_items").delete().eq("id", itemId);
  if (error) throw error;
  // Keep the persistent bottom-navigation badge in sync with the remote cart.
  // The badge listens to this event because a Supabase delete does not emit a
  // browser `storage` event in the same tab.
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
}

type SupabaseCartRow = {
  id: string;
  guest_id: string | null;
  product_id: string;
  recipient_name: string;
  quantity: number;
  unit_price: number;
  selected_options: DraftCartItem["selectedOptions"];
  notes: string | null;
  created_at: string;
  menu_products: {
    slug: string;
    name: string;
    name_ar: string;
    image_url: string | null;
    base_price: number;
  } | null;
};

function getActiveSessionPointer(tableId: number): ActiveSessionPointer | null {
  return getStoredTableSession(tableId);
}

function resetLocalTableContext(pointer: ActiveSessionPointer | null, requestedTableId: number) {
  // An in-flight validation of an old session must not clear a newly scanned one.
  if (!pointer || pointer.tableId !== requestedTableId || getStoredTableSession(requestedTableId)?.sessionId !== pointer.sessionId) return;
  const tableIds = new Set([requestedTableId]);
  const hadStoredContext = window.localStorage.getItem(ACTIVE_SESSION_KEY) !== null || [...tableIds].some((tableId) =>
    window.localStorage.getItem(getStorageKey(tableId)) !== null ||
    window.localStorage.getItem(getSubmittedOrderStorageKey(tableId)) !== null ||
    window.localStorage.getItem(getSubmittedOrderHistoryStorageKey(tableId)) !== null,
  );
  if (getStoredTableSession()?.sessionId === pointer.sessionId) {
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
  window.localStorage.removeItem(`${ACTIVE_SESSION_KEY}:${requestedTableId}`);
  for (const tableId of tableIds) {
    window.localStorage.removeItem(getStorageKey(tableId));
    window.localStorage.removeItem(getSubmittedOrderStorageKey(tableId));
    window.localStorage.removeItem(getSubmittedOrderHistoryStorageKey(tableId));
  }
  if (hadStoredContext) window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
}

function getRequestedCafeId() {
  return typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("cafe");
}

function getSubmitIdempotencyStorageKey(sessionId: string) {
  return `kings-cafe:submit:${sessionId}:idempotency`;
}

function getOrCreateSubmitIdempotencyKey(sessionId: string) {
  const storageKey = getSubmitIdempotencyStorageKey(sessionId);
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const value = generateSafeUUID();
  window.sessionStorage.setItem(storageKey, value);
  return value;
}

function clearSubmitIdempotencyKey(sessionId: string) {
  window.sessionStorage.removeItem(getSubmitIdempotencyStorageKey(sessionId));
}

async function getOrCreateSupabaseCart(sessionId: string) {
  const supabase = createSupabaseBrowserClient();
  const existing = await withCartTimeout(supabase.from("carts").select("id,responsible_guest_id,responsible_name").eq("session_id", sessionId).eq("status", "active").maybeSingle());
  if (existing.error) throw existing.error;
  if (existing.data) return { supabase, cartId: existing.data.id, responsibleGuestId: existing.data.responsible_guest_id as string | null, responsibleName: existing.data.responsible_name as string | null };

  const created = await withCartTimeout(supabase.from("carts").insert({ session_id: sessionId }).select("id,responsible_guest_id,responsible_name").single());
  if (!created.error && created.data) return { supabase, cartId: created.data.id, responsibleGuestId: created.data.responsible_guest_id as string | null, responsibleName: created.data.responsible_name as string | null };

  const retry = await withCartTimeout(supabase.from("carts").select("id,responsible_guest_id,responsible_name").eq("session_id", sessionId).eq("status", "active").single());
  if (retry.error) throw created.error ?? retry.error;
  return { supabase, cartId: retry.data.id, responsibleGuestId: retry.data.responsible_guest_id as string | null, responsibleName: retry.data.responsible_name as string | null };
}

function mapSupabaseCartItem(row: SupabaseCartRow, tableId: number): DraftCartItem {
  const options = Array.isArray(row.selected_options) ? row.selected_options : [];
  const basePrice = Number(row.menu_products?.base_price ?? row.unit_price);
  const customizationsPrice = Math.max(0, Number(row.unit_price) - basePrice);
  return {
    id: row.id,
    tableId,
    productId: row.product_id,
    productSlug: row.menu_products?.slug ?? row.product_id,
    productName: row.menu_products?.name ?? "Product",
    productNameAr: row.menu_products?.name_ar ?? "منتج",
    productImageUrl: row.menu_products?.image_url ?? "",
    recipientName: row.recipient_name,
    selectedOptions: options,
    notes: row.notes ?? "",
    quantity: row.quantity,
    basePrice,
    customizationsPrice,
    unitPrice: Number(row.unit_price),
    totalPrice: Number(row.unit_price) * row.quantity,
    createdAt: row.created_at,
  };
}

async function getSupabaseDraftCartState(tableId: number): Promise<SharedDraftCartState> {
  const session = await getVerifiedSession(tableId);
  const sessionId = session.sessionId;
  if (!sessionId) throw new Error("No active Supabase table session");
  const { supabase, cartId, responsibleGuestId, responsibleName } = await getOrCreateSupabaseCart(sessionId);
  const result = await supabase
    .from("cart_items")
    .select("id,guest_id,product_id,recipient_name,quantity,unit_price,selected_options,notes,created_at,menu_products(slug,name,name_ar,image_url,base_price)")
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true });
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as unknown as SupabaseCartRow[];
  const items = rows.map((row) => mapSupabaseCartItem(row, tableId));
  const displayedResponsibleName = responsibleName ?? rows.find((row) => row.guest_id === responsibleGuestId)?.recipient_name ?? items[0]?.recipientName ?? "";
  const previousOrders = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (previousOrders.error) throw previousOrders.error;
  const hasPreviousOrders = (previousOrders.count ?? 0) > 0;
  const isCurrentGuestResponsible = responsibleGuestId !== null && responsibleGuestId === session.guestId;
  return {
    items,
    responsibleGuestId,
    responsibleName: displayedResponsibleName,
    isCurrentGuestResponsible,
    hasPreviousOrders,
    canCurrentGuestSubmit: hasPreviousOrders || isCurrentGuestResponsible,
  };
}

export async function subscribeToSharedDraftCart(
  tableId: number,
  onChange: () => void,
): Promise<() => void> {
  const session = await getVerifiedSession(tableId);
  const { supabase, cartId } = await getOrCreateSupabaseCart(session.sessionId);
  let channel: RealtimeChannel | null = supabase
    .channel(`customer-cart-live:${cartId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "carts", filter: `id=eq.${cartId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "cart_items", filter: `cart_id=eq.${cartId}` }, onChange)
    .subscribe();

  return () => {
    if (!channel) return;
    const activeChannel = channel;
    channel = null;
    void supabase.removeChannel(activeChannel);
  };
}

async function addSupabaseDraftCartItem(item: NewDraftCartItem): Promise<DraftCartItem> {
  const session = await getVerifiedSession(item.tableId);
  const supabase = createSupabaseBrowserClient();
  const product = await withCartTimeout(supabase.from("menu_products").select("id").eq("cafe_id", session.cafeId).eq("slug", item.productSlug).maybeSingle());
  if (product.error || !product.data) throw product.error ?? new Error("Product not found");
  const idempotencyKey = generateSafeUUID();
  const added = await withCartTimeout(supabase.rpc("add_table_cart_item", {
    p_session_id: session.sessionId,
    p_table_id: session.tableUuid,
    p_product_id: product.data.id,
    p_quantity: item.quantity,
    p_selected_modifier_option_ids: item.selectedOptions.map((option) => option.optionId),
    p_recipient_name: item.recipientName,
    p_notes: item.notes || null,
    p_idempotency_key: idempotencyKey,
  }));
  if (added.error || typeof added.data !== "string") {
    throw added.error ?? new Error("Cart item was not created");
  }

  const inserted = await withCartTimeout(supabase
    .from("cart_items")
    .select("id,guest_id,product_id,recipient_name,quantity,unit_price,selected_options,notes,created_at,menu_products(slug,name,name_ar,image_url,base_price)")
    .eq("id", added.data)
    .single());
  if (inserted.error) throw inserted.error;
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
  return mapSupabaseCartItem(inserted.data as unknown as SupabaseCartRow, item.tableId);
}

async function getVerifiedSession(tableId: number): Promise<VerifiedSession> {
  const pointer = getActiveSessionPointer(tableId);
  const requestedCafeId = getRequestedCafeId();
  if (!pointer || !pointer.guestId || pointer.tableId !== tableId || (requestedCafeId && pointer.cafeId !== requestedCafeId)) {
    throw new Error("TABLE_SESSION_CONTEXT_MISSING: Scan the table QR code again.");
  }

  const supabase = createSupabaseBrowserClient();
  const result = await withCartTimeout(supabase.from("table_sessions").select("id,table_id,status,cafe_tables!inner(table_number,cafe_id)").eq("id", pointer.sessionId).maybeSingle());
  if (result.error) throw result.error;
  const row = result.data as unknown as { id: string; table_id: string; status: string; cafe_tables: { table_number: number; cafe_id: string } | { table_number: number; cafe_id: string }[] } | null;
  const table = Array.isArray(row?.cafe_tables) ? row.cafe_tables[0] : row?.cafe_tables;
  if (row?.status === "payment_pending") {
    const paid = await withCartTimeout(supabase
      .from("payments")
      .select("id")
      .eq("session_id", row.id)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle());
    if (paid.error) throw paid.error;
    if (paid.data) {
      throw new Error("تم دفع حساب هذه الجلسة. اطلب من الكاشير إغلاق الطاولة قبل بدء طلب جديد.");
    }
  }
  if (row?.status === "closed") {
    resetLocalTableContext(pointer, tableId);
    throw new Error("The table session is no longer active.");
  }
  if (!row || !table || table.table_number !== tableId || table.cafe_id !== pointer.cafeId) {
    throw new Error("TABLE_SESSION_ACCESS_UNAVAILABLE");
  }
  if (!ORDERABLE_SESSION_STATUSES.has(row.status)) {
    throw new Error("TABLE_SESSION_NOT_ORDERABLE");
  }
  return { ...pointer, guestId: pointer.guestId, tableUuid: row.table_id };
}

function withCartTimeout<T>(request: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Cart request timed out")), CART_REQUEST_TIMEOUT_MS);
    request.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export function getLastSubmittedTableOrder(tableId: number): SubmittedTableOrder | null {
  try {
    const history = getLocalSubmittedOrders(tableId);
    if (history.length > 0) {
      const items = history.flatMap((entry) => entry.items);
      const latest = history[history.length - 1];
      return { ...latest, items, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), total: items.reduce((sum, item) => sum + item.totalPrice, 0), guestCount: new Set(items.map((item) => item.recipientName)).size };
    }
    const value = window.localStorage.getItem(getSubmittedOrderStorageKey(tableId));
    if (!value) return null;

    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as SubmittedTableOrder;
  } catch {
    return null;
  }
}

function getLocalSubmittedOrders(tableId: number): SubmittedTableOrder[] {
  try {
    const value = window.localStorage.getItem(getSubmittedOrderHistoryStorageKey(tableId));
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as SubmittedTableOrder[] : [];
  } catch {
    return [];
  }
}

function createLocalCartItemId() {
  return generateSafeUUID();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
