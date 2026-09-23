"use client";

import { ResilientImage } from "@/shared/presentation/components/resilient-image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCartUpdatedEventName,
  getSharedDraftCartState,
  removeFromSharedDraftCart,
  subscribeToSharedDraftCart,
  submitSupabaseTableOrder,
} from "../services/local-draft-cart.service";
import type { DraftCartItem } from "../types/draft-cart";
import { selectedCustomizationLabel } from "../utils/selected-customization-labels";
import { getSupabaseMenuCatalog, subscribeToMenuCatalog } from "@/features/menu/services/supabase-menu.service";
import styles from "./cart-screen.module.css";

type RecipientOrder = {
  recipientName: string;
  items: DraftCartItem[];
  itemCount: number;
  total: number;
};

export function CartScreen({ tableId }: { tableId: number }) {
  const router = useRouter();
  const [items, setItems] = useState<DraftCartItem[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [splitBill, setSplitBill] = useState(false);
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [blockedProductIds, setBlockedProductIds] = useState<Set<string>>(new Set());
  const [isAvailabilityChecking, setIsAvailabilityChecking] = useState(true);
  const [responsibleName, setResponsibleName] = useState("");
  const [hasPreviousOrders, setHasPreviousOrders] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const refreshSequenceRef = useRef(0);
  const needsAvailabilityCheckRef = useRef(true);

  function reconcileAvailability(products: Awaited<ReturnType<typeof getSupabaseMenuCatalog>>["products"], cartItems: DraftCartItem[]) {
    const availableIds = new Set(products.filter((product) => product.availability === "available").map((product) => product.id));
    setBlockedProductIds(new Set(cartItems.filter((item) => !availableIds.has(item.productId)).map((item) => item.productId)));
    setIsAvailabilityChecking(false);
  }

  const refreshCart = useCallback(async ({ checkCatalog = false }: { checkCatalog?: boolean } = {}) => {
    const refreshSequence = ++refreshSequenceRef.current;
    try {
      const cart = await getSharedDraftCartState(tableId);
      // Cart and navigation listeners can receive adjacent Realtime events
      // for the same transaction. Never let an older, slower read overwrite
      // a newer cart snapshot (for example, restoring the empty-cart screen
      // after another phone's successful add).
      if (refreshSequence !== refreshSequenceRef.current) return;
      setItems(cart.items);
      setResponsibleName(cart.responsibleName);
      setHasPreviousOrders(cart.hasPreviousOrders);
      setCanSubmit(cart.canCurrentGuestSubmit);
      // Keep the persistent bottom-navigation badge aligned with the canonical
      // Supabase cart after every initial or realtime refresh.
      window.dispatchEvent(new CustomEvent(getCartUpdatedEventName()));
      if (checkCatalog || needsAvailabilityCheckRef.current) {
        setIsAvailabilityChecking(true);
        try {
          const catalog = await getSupabaseMenuCatalog({ forceRefresh: true, tableId });
          if (refreshSequence !== refreshSequenceRef.current) return;
          reconcileAvailability(catalog.products, cart.items);
          needsAvailabilityCheckRef.current = false;
        } catch {
          if (refreshSequence !== refreshSequenceRef.current) return;
          // Don't leave the send button in a permanent, unexplained loading
          // state. Sending performs its own fresh availability check and will
          // fail closed if Supabase still cannot verify the current catalog.
          setIsAvailabilityChecking(false);
          setSubmitError("تعذر التحقق من توفر المنتجات. أعد المحاولة قبل الإرسال.");
        }
      }
    } catch {
      if (refreshSequence === refreshSequenceRef.current) setItems([]);
    } finally {
      if (refreshSequence === refreshSequenceRef.current) setIsReady(true);
    }
  }, [tableId]);

  useEffect(() => {
    let unsubscribe = () => {};
    let disposed = false;
    let refreshTimer: number | null = null;
    const scheduleCartRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshCart();
      }, 75);
    };
    const timer = window.setTimeout(() => {
      void refreshCart({ checkCatalog: true });
      void subscribeToSharedDraftCart(tableId, scheduleCartRefresh)
        .then((cleanup) => {
          if (disposed) cleanup();
          else unsubscribe = cleanup;
        })
        .catch(() => {});
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [refreshCart, tableId]);

  useEffect(() => subscribeToMenuCatalog((catalog) => reconcileAvailability(catalog.products, items), tableId), [items, tableId]);

  const recipientOrders = useMemo(() => groupItemsByRecipient(items), [items]);
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.totalPrice, 0),
    [items],
  );
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const tableHost = responsibleName || recipientOrders[0]?.recipientName || "";

  async function removeItem(itemId: string) {
    try {
      needsAvailabilityCheckRef.current = true;
      await removeFromSharedDraftCart(tableId, itemId);
      await refreshCart({ checkCatalog: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "تعذر حذف المنتج");
    }
  }

  async function sendCombinedOrder() {
    if (!tableHost || !canSubmit || items.length === 0 || submittedOrderNumber !== null || isSubmitting || isAvailabilityChecking || blockedProductIds.size > 0) return;

    setIsSubmitting(true);
    setSubmitError("");
    try {
      const latestCatalog = await getSupabaseMenuCatalog({ forceRefresh: true, tableId });
      const availableIds = new Set(latestCatalog.products.filter((product) => product.availability === "available").map((product) => product.id));
      const blocked = new Set(items.filter((item) => !availableIds.has(item.productId)).map((item) => item.productId));
      setBlockedProductIds(blocked);
      if (blocked.size > 0) {
        setSubmitError("بعض المنتجات أصبحت غير متاحة مؤقتًا. احذفها من الكارت لإرسال الطلب.");
        return;
      }
      // A failed Supabase write must never silently fall back to local storage:
      // that makes the customer see success while the cashier receives nothing.
      const order = await submitSupabaseTableOrder({ tableId, items, submittedBy: tableHost });
      setItems([]);
      setSubmittedOrderNumber(order.orderNumber ?? null);
      window.setTimeout(() => router.push(`/table/${tableId}/order`), 900);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "تعذر إرسال الطلب للكاشير");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.ambientGlow} aria-hidden="true" />

      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href={`/table/${tableId}/menu`} aria-label="العودة إلى القائمة">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </Link>

          <div className={styles.titleGroup}>
            <h1 lang="en">Table {tableId} Cart</h1>
            <p>سلة طاولة {tableId}</p>
          </div>

          <span className={styles.liveBadge}><i aria-hidden="true" /> LIVE</span>
        </header>

        {!isReady ? (
          <div className={styles.loading} aria-label="جاري تحميل السلة" />
        ) : items.length === 0 && submittedOrderNumber === null ? (
          <EmptyCart tableId={tableId} />
        ) : (
          <>
            <section className={styles.stats} aria-label="ملخص طلب الطاولة">
              <StatCard value={recipientOrders.length} label="Guests" labelAr="أشخاص" />
              <StatCard value={itemCount} label="Items" labelAr="منتجات" />
              <StatCard value={total} suffix="EGP" label="Total" labelAr="الإجمالي" accent />
            </section>

            <section className={styles.splitControl}>
              <div className={styles.splitIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M8 4H5v16h3M16 4h3v16h-3M12 7v10M9.5 9.5 12 7l2.5 2.5M9.5 14.5 12 17l2.5-2.5" /></svg>
              </div>
              <div><strong lang="en">Split Bill View</strong><span>عرض تقسيم الفاتورة</span></div>
              <button
                type="button"
                role="switch"
                aria-checked={splitBill}
                onClick={() => setSplitBill((value) => !value)}
                className={splitBill ? styles.switchActive : undefined}
              >
                <i />
              </button>
            </section>

            {splitBill && (
              <section className={styles.splitPreview} aria-label="تقسيم إجمالي الفاتورة">
                {recipientOrders.map((order) => (
                  <div key={order.recipientName}>
                    <span><i>{getInitial(order.recipientName)}</i>{order.recipientName}</span>
                    <b>{order.total} <small>EGP</small></b>
                  </div>
                ))}
              </section>
            )}

            <section className={styles.orderGroups} aria-label="طلبات الأشخاص على الطاولة">
              {recipientOrders.map((order) => (
                <RecipientOrderCard
                  key={order.recipientName}
                  order={order}
                  isHost={order.recipientName === tableHost}
                  onRemoveItem={removeItem}
                  blockedProductIds={blockedProductIds}
                />
              ))}
            </section>

            <section className={styles.combinedTotal}>
              <div><strong lang="en">Combined Table Total</strong><span>إجمالي طلبات الطاولة</span></div>
              <b>{total} <small>EGP</small></b>
            </section>

            <section className={styles.hostNotice}>
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m5 9 3.5 3L12 6l3.5 6L19 9l-1.5 8h-11L5 9Z" /></svg>
              </span>
              <div>
                <strong>{hasPreviousOrders ? "يمكن لأي ضيف إرسال طلب جديد" : `${tableHost} هو مسؤول الإرسال الأول`}</strong>
                <p>{hasPreviousOrders ? "كل طلب جديد سيظهر مباشرة في المتابعة تحت نفس الجلسة." : "مسؤول الجلسة فقط يرسل الطلب الأول المجمّع للكاشير."}</p>
              </div>
            </section>

            <footer className={styles.actions}>
              {blockedProductIds.size > 0 && <div className={styles.availabilityWarning} role="alert"><strong>تعذّر إرسال الطلب حاليًا</strong><span>منتج أو أكثر أصبح غير متاح مؤقتًا. احذف المنتجات المحددة ثم أرسل الطلب.</span></div>}
              {!canSubmit && <p className={styles.submitError}>الإرسال الأول متاح لمسؤول الجلسة فقط. بعد أول طلب يمكن لأي ضيف إرسال طلباته الجديدة.</p>}
              {submitError && <p role="alert" className={styles.submitError}>{submitError}</p>}
              <button type="button" onClick={sendCombinedOrder} disabled={!canSubmit || submittedOrderNumber !== null || isSubmitting || isAvailabilityChecking || blockedProductIds.size > 0}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.2 18-3.6-7.2L3 10.2 21 3Z" /><path d="m10.2 13.8 4-4" /></svg>
                <span><strong lang="en">Send Combined Table Order</strong><small>إرسال طلب الطاولة مرة واحدة للكاشير</small></span>
                <b>{itemCount}<small>items</small></b>
              </button>
              <Link className={styles.addMoreButton} href={`/table/${tableId}/menu`}>
                <span aria-hidden="true">+</span>
                <strong lang="en">Add more items</strong>
                <small>إضافة منتجات أخرى إلى نفس الكارت</small>
                <i aria-hidden="true">›</i>
              </Link>
            </footer>
          </>
        )}
      </div>

      {submittedOrderNumber !== null && (
        <section className={styles.successBackdrop} role="dialog" aria-modal="true" aria-labelledby="order-success-title">
          <div className={styles.successCard}>
            <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9" /></svg></span>
            <p>تم إرسال الطلب للكاشير</p>
            <h2 id="order-success-title" lang="en">Order Sent Successfully</h2>
            <small lang="en">#{submittedOrderNumber || "—"}</small>
            <Link href={`/table/${tableId}/order`}>Track Order <i>متابعة الطلب</i></Link>
          </div>
        </section>
      )}
    </main>
  );
}

function StatCard({
  value,
  suffix,
  label,
  labelAr,
  accent = false,
}: {
  value: number;
  suffix?: string;
  label: string;
  labelAr: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? styles.accentStat : undefined}>
      <b>{value}{suffix && <small> {suffix}</small>}</b>
      <span lang="en">{label}</span>
      <i>{labelAr}</i>
    </div>
  );
}

function RecipientOrderCard({
  order,
  isHost,
  onRemoveItem,
  blockedProductIds,
}: {
  order: RecipientOrder;
  isHost: boolean;
  onRemoveItem: (itemId: string) => void;
  blockedProductIds: Set<string>;
}) {
  return (
    <article className={`${styles.orderGroup} ${isHost ? styles.hostOrder : ""}`}>
      <header>
        <span className={styles.avatar}>{getInitial(order.recipientName)}</span>
        <div>
          <h2 lang="en">{isHost ? "Your Order" : `${order.recipientName}'s Order`}</h2>
          <p>{isHost ? `طلب ${order.recipientName} · مسؤول الطاولة` : `طلب ${order.recipientName}`}</p>
        </div>
        <div className={styles.groupSummary}>
          <b>{order.total} <small>EGP</small></b>
          <span>{order.itemCount} items</span>
        </div>
      </header>

      <div className={styles.groupItems}>
        {order.items.map((item) => (
          <div className={`${styles.orderItem} ${blockedProductIds.has(item.productId) ? styles.unavailableItem : ""}`} key={item.id}>
            <div className={styles.productImage}>
              <ResilientImage src={item.productImageUrl} fallbackSrc={`/images/products/${item.productSlug}.webp`} alt="" fill sizes="48px" />
            </div>
            <div className={styles.productCopy}>
              <h3 lang="en">{item.productName}</h3>
              <p>{getItemDetails(item)}</p>
              {blockedProductIds.has(item.productId) && <em>غير متاح مؤقتًا — احذفه لإكمال الطلب</em>}
            </div>
            <span className={styles.quantity}>×{item.quantity}</span>
            <b className={styles.itemPrice}>{item.totalPrice}</b>
            <button type="button" onClick={() => onRemoveItem(item.id)} aria-label={`حذف ${item.productName}`}>×</button>
          </div>
        ))}
      </div>
    </article>
  );
}

function EmptyCart({ tableId }: { tableId: number }) {
  return (
    <section className={styles.empty}>
      <div aria-hidden="true">☕</div>
      <h2 lang="en">Your table cart is empty</h2>
      <p>لسه ما أضفتش حاجة لطلب الطاولة</p>
      <Link href={`/table/${tableId}/menu`}>Browse Menu <small>عرض القائمة</small></Link>
    </section>
  );
}

function groupItemsByRecipient(items: DraftCartItem[]): RecipientOrder[] {
  const groups = new Map<string, DraftCartItem[]>();

  for (const item of items) {
    const recipientName =
      typeof item.recipientName === "string" && item.recipientName.trim()
        ? item.recipientName.trim()
        : "Guest";
    const recipientItems = groups.get(recipientName) ?? [];
    recipientItems.push(item);
    groups.set(recipientName, recipientItems);
  }

  return Array.from(groups, ([recipientName, recipientItems]) => ({
    recipientName,
    items: recipientItems,
    itemCount: recipientItems.reduce((total, item) => total + item.quantity, 0),
    total: recipientItems.reduce((total, item) => total + item.totalPrice, 0),
  }));
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "G";
}

function getItemDetails(item: DraftCartItem) {
  const optionLabels = Array.isArray(item.selectedOptions)
    ? item.selectedOptions.map((option) => selectedCustomizationLabel(option)).filter(Boolean)
    : [];
  return [item.productNameAr, ...optionLabels].filter(Boolean).join(" · ");
}
