"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getSharedDraftCart,
  getLocalDraftCart,
  removeFromSharedDraftCart,
  removeLocalDraftCartItem,
  submitLocalTableOrder,
} from "../services/local-draft-cart.service";
import type { DraftCartItem } from "../types/draft-cart";
import styles from "./cart-screen.module.css";

type RecipientOrder = {
  recipientName: string;
  items: DraftCartItem[];
  itemCount: number;
  total: number;
};

export function CartScreen({ tableId }: { tableId: number }) {
  const [items, setItems] = useState<DraftCartItem[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [splitBill, setSplitBill] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState("");

  useEffect(() => {
    function refreshCart() {
      void getSharedDraftCart(tableId)
        .then((sharedItems) => setItems(sharedItems.length > 0 ? sharedItems : getLocalDraftCart(tableId)))
        .catch(() => setItems(getLocalDraftCart(tableId)));
      setIsReady(true);
    }

    const timer = window.setTimeout(refreshCart, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [tableId]);

  const recipientOrders = useMemo(() => groupItemsByRecipient(items), [items]);
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.totalPrice, 0),
    [items],
  );
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const tableHost = recipientOrders[0]?.recipientName ?? "";

  function removeItem(itemId: string) {
    void removeFromSharedDraftCart(tableId, itemId);
    setItems(removeLocalDraftCartItem(tableId, itemId));
  }

  function sendCombinedOrder() {
    if (!tableHost || items.length === 0 || submittedOrderId) return;

    const order = submitLocalTableOrder({
      tableId,
      items,
      submittedBy: tableHost,
    });
    setSubmittedOrderId(order.id);
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
        ) : items.length === 0 && !submittedOrderId ? (
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
              {recipientOrders.map((order, index) => (
                <RecipientOrderCard
                  key={order.recipientName}
                  order={order}
                  isHost={index === 0}
                  onRemoveItem={removeItem}
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
                <strong>{tableHost} هو مسؤول الطلب</strong>
                <p>مسؤول الطاولة فقط يقدر يرسل الطلب المجمّع للكاشير.</p>
              </div>
            </section>

            <footer className={styles.actions}>
              <button type="button" onClick={sendCombinedOrder} disabled={Boolean(submittedOrderId)}>
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

      {submittedOrderId && (
        <section className={styles.successBackdrop} role="dialog" aria-modal="true" aria-labelledby="order-success-title">
          <div className={styles.successCard}>
            <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9" /></svg></span>
            <p>تم إرسال الطلب للكاشير</p>
            <h2 id="order-success-title" lang="en">Order Sent Successfully</h2>
            <small lang="en">#{submittedOrderId}</small>
            <Link href={`/table/${tableId}/menu`}>Back to Menu <i>العودة للقائمة</i></Link>
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
}: {
  order: RecipientOrder;
  isHost: boolean;
  onRemoveItem: (itemId: string) => void;
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
          <div className={styles.orderItem} key={item.id}>
            <div className={styles.productImage}>
              <Image src={getProductImageUrl(item)} alt="" fill sizes="48px" unoptimized />
            </div>
            <div className={styles.productCopy}>
              <h3 lang="en">{item.productName}</h3>
              <p>{getItemDetails(item)}</p>
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
    ? item.selectedOptions.map((option) => option.optionLabelAr).filter(Boolean)
    : [];
  return [item.productNameAr, ...optionLabels].filter(Boolean).join(" · ");
}

function getProductImageUrl(item: DraftCartItem) {
  if (
    typeof item.productImageUrl === "string" &&
    item.productImageUrl.startsWith("/")
  ) {
    return item.productImageUrl;
  }

  return `/images/products/${item.productSlug}.webp`;
}
