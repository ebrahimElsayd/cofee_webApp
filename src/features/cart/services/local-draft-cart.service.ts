import type {
  DraftCartItem,
  NewDraftCartItem,
  SubmittedTableOrder,
} from "../types/draft-cart";

const CART_UPDATED_EVENT = "kings-cafe:draft-cart-updated";

function getStorageKey(tableId: number) {
  return `kings-cafe:table:${tableId}:draft-cart:v2`;
}

function getSubmittedOrderStorageKey(tableId: number) {
  return `kings-cafe:table:${tableId}:last-submitted-order:v1`;
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

  window.localStorage.setItem(
    getSubmittedOrderStorageKey(tableId),
    JSON.stringify(order),
  );
  clearLocalDraftCart(tableId);

  return order;
}

export function getCartUpdatedEventName() {
  return CART_UPDATED_EVENT;
}

export async function getSharedDraftCart(tableId: number): Promise<DraftCartItem[]> {
  const response = await fetch(`/api/tables/${tableId}/cart`, { cache: "no-store" });
  if (!response.ok) throw new Error("Shared cart unavailable");
  const value: unknown = await response.json();
  return Array.isArray(value) ? (value as DraftCartItem[]) : [];
}

export async function addToSharedDraftCart(item: NewDraftCartItem): Promise<DraftCartItem> {
  const response = await fetch(`/api/tables/${item.tableId}/cart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error("Shared cart unavailable");
  return (await response.json()) as DraftCartItem;
}

export async function removeFromSharedDraftCart(tableId: number, itemId: string) {
  await fetch(`/api/tables/${tableId}/cart?itemId=${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

export function getLastSubmittedTableOrder(tableId: number): SubmittedTableOrder | null {
  try {
    const value = window.localStorage.getItem(getSubmittedOrderStorageKey(tableId));
    if (!value) return null;

    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as SubmittedTableOrder;
  } catch {
    return null;
  }
}

function createLocalCartItemId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `cart-item-${timestamp}-${randomPart}`;
}
