import { createSupabaseBrowserClient } from "@/shared/lib/supabase/browser";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DraftCartItem, SubmittedTableOrder } from "@/features/cart/types/draft-cart";

type OrderRow = { id: string; order_number: number; created_at: string; status: string; closed_at: string | null };
type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  recipient_name: string;
  quantity: number;
  unit_price: number;
  status: DraftCartItem["status"];
  selected_options: DraftCartItem["selectedOptions"];
  notes: string | null;
  created_at: string;
  menu_products: { slug: string; name_ar: string; image_url: string | null } | null;
};
export type CustomerRemoteNotification = { id: string; order_id: string | null; order_item_id: string | null; type: string; title: string; body: string; is_read: boolean; created_at: string };
export class TableSessionClosedError extends Error {
  constructor() {
    super("The table session has ended.");
    this.name = "TableSessionClosedError";
  }
}
const ACTIVE_SESSION_KEY = "kings-cafe:active-table-session";
const ACTIVE_SESSION_STATUSES = new Set(["open", "ordering", "payment_pending"]);
const CART_UPDATED_EVENT = "kings-cafe:draft-cart-updated";
type ActiveSessionPointer = { sessionId: string; tableId: number; cafeId: string };
export type TableOrderUpdateKind = "orders" | "order_items" | "session" | "notifications";
const trackingListeners = new Set<(updates: ReadonlySet<TableOrderUpdateKind>) => void>();
const pendingTrackingUpdates = new Set<TableOrderUpdateKind>();
let trackingChannel: RealtimeChannel | null = null;
let trackingRetry: ReturnType<typeof setTimeout> | null = null;
let trackingNotifyTimer: ReturnType<typeof setTimeout> | null = null;
let trackingActive = false;
let trackingClosing = false;
let validatedSession: { sessionId: string; checkedAt: number } | null = null;
const SESSION_VALIDATION_TTL_MS = 30_000;
const orderRequests = new Map<string, Promise<SubmittedTableOrder | null>>();

async function ensureTrackingChannel() {
  if (trackingChannel || trackingListeners.size === 0) return;
  const pointer = getActiveTableSessionPointer();
  if (!pointer) return;
  try {
    await validateSessionForTable(pointer.tableId);
  } catch {
    const updates = new Set<TableOrderUpdateKind>(["session"]);
    trackingListeners.forEach((listener) => listener(updates));
    return;
  }
  if (trackingChannel || trackingListeners.size === 0) return;
  const supabase = createSupabaseBrowserClient();
  trackingActive = true;
  const notify = (kind: TableOrderUpdateKind) => {
    if (kind !== "notifications") orderRequests.delete(pointer.sessionId);
    pendingTrackingUpdates.add(kind);
    if (trackingNotifyTimer) return;
    trackingNotifyTimer = setTimeout(() => {
      trackingNotifyTimer = null;
      const updates = new Set(pendingTrackingUpdates);
      pendingTrackingUpdates.clear();
      trackingListeners.forEach((listener) => listener(updates));
    }, 150);
  };
  trackingChannel = supabase
    .channel(`customer-table-live:${pointer.sessionId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `session_id=eq.${pointer.sessionId}` }, () => notify("orders"))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "order_items", filter: `session_id=eq.${pointer.sessionId}` }, () => notify("order_items"))
    .on("postgres_changes", { event: "*", schema: "public", table: "table_sessions", filter: `id=eq.${pointer.sessionId}` }, () => notify("session"))
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `session_id=eq.${pointer.sessionId}` }, () => notify("notifications"))
    .subscribe((status) => {
      if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT" && status !== "CLOSED") return;
      if (trackingClosing) return;
      trackingClosing = true;
      const failed = trackingChannel;
      trackingChannel = null;
      if (failed) {
        void supabase.removeChannel(failed).finally(() => {
          trackingClosing = false;
        });
      } else {
        trackingClosing = false;
      }
      if (!trackingActive || trackingRetry) return;
      trackingRetry = setTimeout(() => { trackingRetry = null; void ensureTrackingChannel(); }, 3_000);
    });
}

function getActiveTableSessionPointer(): ActiveSessionPointer | null {
  try {
    const value = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ActiveSessionPointer>;
    return typeof parsed.sessionId === "string" && typeof parsed.tableId === "number" && Number.isInteger(parsed.tableId) && typeof parsed.cafeId === "string"
      ? { sessionId: parsed.sessionId, tableId: parsed.tableId, cafeId: parsed.cafeId }
      : null;
  } catch {
    return null;
  }
}

export function getActiveTableSessionId() {
  return getActiveTableSessionPointer()?.sessionId ?? null;
}

async function validateSessionForTable(tableId: number, force = false) {
  const pointer = getActiveTableSessionPointer();
  if (!pointer || pointer.tableId !== tableId) throw new TableSessionClosedError();
  if (!force && validatedSession?.sessionId === pointer.sessionId && Date.now() - validatedSession.checkedAt < SESSION_VALIDATION_TTL_MS) return pointer;
  const supabase = createSupabaseBrowserClient();
  const result = await supabase.from("table_sessions").select("id,table_id,status,cafe_tables!inner(table_number,cafe_id)").eq("id", pointer.sessionId).maybeSingle();
  if (result.error) throw result.error;
  const row = result.data as unknown as { id: string; table_id: string; status: string; cafe_tables: { table_number: number; cafe_id: string } | { table_number: number; cafe_id: string }[] } | null;
  const table = Array.isArray(row?.cafe_tables) ? row.cafe_tables[0] : row?.cafe_tables;
  if (!row || !table || !ACTIVE_SESSION_STATUSES.has(row.status) || table.table_number !== tableId || table.cafe_id !== pointer.cafeId) {
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    window.localStorage.removeItem(`kings-cafe:table:${tableId}:draft-cart:v2`);
    validatedSession = null;
    window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
    throw new TableSessionClosedError();
  }
  validatedSession = { sessionId: pointer.sessionId, checkedAt: Date.now() };
  return pointer;
}

export async function validateActiveTableSession(tableId: number): Promise<void> {
  await validateSessionForTable(tableId, true);
}

export async function getCustomerNotifications(): Promise<CustomerRemoteNotification[]> {
  const sessionId = getActiveTableSessionId();
  if (!sessionId) return [];
  const supabase = createSupabaseBrowserClient();
  const result = await supabase.from("notifications").select("id,order_id,order_item_id,type,title,body,is_read,created_at").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(40);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as CustomerRemoteNotification[];
  const seenSignals = new Set<string>();
  return rows.filter((row) => {
    const readyOrder = row.type === "order_status" && row.title === "الطلب جاهز" && Boolean(row.order_id) && !row.order_item_id;
    const cashierAlert = row.type === "customer_alert" && !row.order_item_id;
    if (!readyOrder && !cashierAlert) return false;
    const key = readyOrder ? `ready:${row.order_id}` : "cashier-alert";
    if (seenSignals.has(key)) return false;
    seenSignals.add(key);
    return true;
  }).slice(0, 8);
}

export async function markCustomerNotificationsRead() {
  const sessionId = getActiveTableSessionId();
  if (!sessionId) return;
  const supabase = createSupabaseBrowserClient();
  const result = await supabase.from("notifications").update({ is_read: true }).eq("session_id", sessionId).eq("is_read", false);
  if (result.error) throw result.error;
}

export function getSupabaseTableOrder(tableId: number): Promise<SubmittedTableOrder | null> {
  const pointer = getActiveTableSessionPointer();
  if (!pointer) return Promise.resolve(null);
  const existing = orderRequests.get(pointer.sessionId);
  if (existing) return existing;
  const request = loadSupabaseTableOrder(tableId).finally(() => {
    if (orderRequests.get(pointer.sessionId) === request) orderRequests.delete(pointer.sessionId);
  });
  orderRequests.set(pointer.sessionId, request);
  return request;
}

async function loadSupabaseTableOrder(tableId: number): Promise<SubmittedTableOrder | null> {
  const pointer = getActiveTableSessionPointer();
  if (!pointer) return null;
  const session = await validateSessionForTable(tableId);
  const sessionId = session.sessionId;
  const supabase = createSupabaseBrowserClient();
  const ordersResult = await supabase.from("orders").select("id,order_number,created_at,status,closed_at").eq("session_id", sessionId).is("closed_at", null).order("created_at", { ascending: true });
  if (ordersResult.error) throw ordersResult.error;
  const orders = (ordersResult.data ?? []) as OrderRow[];
  if (orders.length === 0) return null;
  const itemsResult = await supabase.from("order_items").select("id,order_id,product_id,product_name,recipient_name,quantity,unit_price,status,selected_options,notes,created_at,menu_products(slug,name_ar,image_url)").in("order_id", orders.map((order) => order.id)).order("created_at", { ascending: true });
  if (itemsResult.error) throw itemsResult.error;
  const items = (itemsResult.data ?? []) as unknown as OrderItemRow[];
  const mappedItems = items.map((item) => ({
    id: item.id,
    tableId,
    productId: item.product_id ?? item.product_name,
    productSlug: item.menu_products?.slug ?? item.product_name,
    productName: item.product_name,
    productNameAr: item.menu_products?.name_ar ?? "",
    productImageUrl: item.menu_products?.image_url ?? "",
    recipientName: item.recipient_name,
    selectedOptions: Array.isArray(item.selected_options) ? item.selected_options : [],
    notes: item.notes ?? "",
    quantity: item.quantity,
    basePrice: Number(item.unit_price),
    customizationsPrice: 0,
    unitPrice: Number(item.unit_price),
    totalPrice: Number(item.unit_price) * item.quantity,
    createdAt: item.created_at,
    status: item.status ?? "received",
  } satisfies DraftCartItem));
  // Cancelled items remain in the tracking feed for transparency, but are
  // never part of the payable total. Keep the server state as the source of
  // truth and derive the customer-facing amount from active items only.
  const total = mappedItems.reduce((sum, item) => item.status === "cancelled" ? sum : sum + item.totalPrice, 0);
  return {
    id: orders[orders.length - 1].id,
    tableId,
    submittedBy: mappedItems[0]?.recipientName ?? "Guest",
    guestCount: new Set(mappedItems.map((item) => item.recipientName)).size,
    itemCount: mappedItems.reduce((sum, item) => sum + item.quantity, 0),
    total,
    items: mappedItems,
    status: "sent",
    submittedAt: orders[0].created_at,
  };
}

export function subscribeToTableOrderUpdates(onChange: (updates: ReadonlySet<TableOrderUpdateKind>) => void) {
  trackingListeners.add(onChange);
  void ensureTrackingChannel();
  return () => {
    trackingListeners.delete(onChange);
    if (trackingListeners.size > 0) return;
    trackingActive = false;
    if (trackingRetry) clearTimeout(trackingRetry);
    trackingRetry = null;
    if (trackingNotifyTimer) clearTimeout(trackingNotifyTimer);
    trackingNotifyTimer = null;
    pendingTrackingUpdates.clear();
    const supabase = createSupabaseBrowserClient();
    if (trackingChannel) void supabase.removeChannel(trackingChannel);
    trackingChannel = null;
  };
}
