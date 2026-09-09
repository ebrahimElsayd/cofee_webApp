"use client";

import { ResilientImage } from "@/shared/presentation/components/resilient-image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { DraftCartItem, SubmittedTableOrder } from "@/features/cart/types/draft-cart";
import { selectedCustomizationLabel } from "@/features/cart/utils/selected-customization-labels";
import { getSupabaseTableOrder, subscribeToTableOrderUpdates, TableSessionClosedError } from "../services/supabase-order-tracking.service";
import { requestTableService } from "../services/table-service-request.service";
import styles from "./animated-order-tracking-screen.module.css";

export function AnimatedOrderTrackingScreen({ tableId }: { tableId: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<SubmittedTableOrder | null>(null);
  const [ready, setReady] = useState(false);
  const [billRequested, setBillRequested] = useState(false);
  const [billReminderAvailable, setBillReminderAvailable] = useState(false);

  const activeItems = useMemo(() => order?.items.filter((item) => getItemStatus(item) !== "cancelled") ?? [], [order]);
  const readyItems = activeItems.filter((item) => ["ready", "served"].includes(getItemStatus(item))).length;
  const preparingItems = activeItems.filter((item) => getItemStatus(item) === "preparing").length;
  const allCancelled = Boolean(order && order.items.length > 0 && activeItems.length === 0);
  const allReady = activeItems.length > 0 && readyItems === activeItems.length;
  const journeyStage = allCancelled ? 0 : allReady ? 3 : preparingItems > 0 ? 2 : 1;
  const receiptGroups = useMemo(() => {
    const groups = new Map<string, DraftCartItem[]>();
    for (const item of activeItems) groups.set(item.recipientName, [...(groups.get(item.recipientName) ?? []), item]);
    return Array.from(groups, ([name, items]) => ({ name, items, total: items.reduce((sum, item) => sum + item.totalPrice, 0) }));
  }, [activeItems]);
  const payableTotal = activeItems.reduce((sum, item) => sum + item.totalPrice, 0);

  async function requestBill() {
    if ((billRequested && !billReminderAvailable) || !allReady) return;
    try {
      await requestTableService("bill");
      setBillRequested(true);
      setBillReminderAvailable(false);
    } catch { /* keep the action retryable when the request did not reach Supabase */ }
  }

  useEffect(() => {
    if (!billRequested) return;
    const timer = window.setTimeout(() => setBillReminderAvailable(true), 120_000);
    return () => window.clearTimeout(timer);
  }, [billRequested]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const remoteOrder = await getSupabaseTableOrder(tableId);
        if (active) {
          // A successful null response means the cashier closed the session;
          // do not keep rendering the stale local snapshot in that case.
          if (!remoteOrder) {
            router.replace("/?session=closed");
            return;
          }
          setOrder(remoteOrder);
          if (remoteOrder && searchParams.get("bill") === "1") {
            const payableItems = remoteOrder.items.filter((item) => getItemStatus(item) !== "cancelled");
            if (payableItems.length > 0 && payableItems.every((item) => ["ready", "served"].includes(getItemStatus(item)))) setBillRequested(true);
          }
        }
      } catch (error) {
        if (error instanceof TableSessionClosedError) {
          router.replace("/?session=closed");
          return;
        }
        if (active) setOrder(null);
      } finally {
        if (active) setReady(true);
      }
    };
    void load();
    const unsubscribe = subscribeToTableOrderUpdates((updates) => {
      if (updates.has("orders") || updates.has("order_items") || updates.has("session")) void load();
    });
    const reconcile = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void load();
    };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [router, tableId, searchParams]);



  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div><p>ORDER TRACKING</p><h1>متابعة الطلب</h1></div>
          <span><i /> Table {tableId}</span>
        </header>
        {!ready ? <div className={styles.loader} /> : !order ? (
          <section className={styles.empty}><span>◷</span><h2>لا يوجد طلب قيد التحضير</h2><p>أرسل طلب الطاولة من الكارت أولًا، وستظهر حالة كل مشروب هنا.</p><Link href={`/table/${tableId}/cart`}>فتح الكارت</Link></section>
        ) : (
          <>
            <section className={`${styles.hero} ${allReady ? styles.heroReady : journeyStage === 2 ? styles.heroPreparing : ""}`}>
              <div className={styles.coffeeScene} aria-hidden="true">
                <span className={styles.steam} /><span className={styles.steam} /><span className={styles.steam} />
                <div className={`${styles.cup} ${allReady ? styles.cupReady : ""}`}><i /><b /></div>
                <div className={styles.saucer} />
              </div>
              <div><strong>{allCancelled ? "تم إلغاء الطلب" : allReady ? "طلبك جاهز للاستلام" : journeyStage === 2 ? "الباريستا يحضّر طلبك الآن" : "طلبك وصل للباريستا"}</strong><p>{allCancelled ? "لن تُحتسب العناصر الملغاة في الحساب" : allReady ? "استلمه من الكاونتر أو انتظر النادل" : journeyStage === 2 ? "يتم تحضير مشروباتك بعناية" : "تم استلام الطلب وسيبدأ التحضير قريبًا"}</p></div>
              <small>#{order.id}</small>
            </section>
            <section className={styles.journey} aria-label="رحلة الطلب">
              <div className={styles.journeyLine}><i /></div>
              <div className={`${styles.journeyNode} ${journeyStage >= 1 ? styles.done : styles.active}`}><i>{journeyStage > 1 ? "✓" : "1"}</i><b>تم الاستلام</b><small>Received</small></div>
              <div className={`${styles.journeyNode} ${journeyStage > 2 ? styles.done : journeyStage === 2 ? styles.active : ""}`}><i>{journeyStage > 2 ? "✓" : "2"}</i><b>التحضير</b><small>{journeyStage > 2 ? "Prepared" : journeyStage === 2 ? "Preparing" : "Waiting"}</small></div>
              <div className={`${styles.journeyNode} ${journeyStage === 3 ? styles.done : ""}`}><i>{journeyStage === 3 ? "✓" : "3"}</i><b>جاهز</b><small>Ready</small></div>
            </section>
            <section className={styles.drinks}>
              <header><div><h2>مشروباتك</h2><p>كل مشروب له حالة مستقلة</p></div><b>{order.items.length} عناصر</b></header>
              {order.items.map((item, index) => {
                const itemStatus = getItemStatus(item);
                const itemReady = itemStatus === "ready" || itemStatus === "served";
                const itemCancelled = itemStatus === "cancelled";
                return (
                <article className={`${styles.drink} ${itemReady ? styles.drinkReady : ""} ${itemCancelled ? styles.drinkCancelled : ""}`} key={item.id} style={{ "--item-index": index } as React.CSSProperties}>
                  <div className={styles.image}><ResilientImage src={item.productImageUrl} fallbackSrc={`/images/products/${item.productSlug}.webp`} alt="" fill sizes="56px" /></div>
                  <div className={styles.copy}><h3 lang="en">{item.productName}</h3><p>{item.recipientName} · {item.productNameAr}</p></div>
                  <div className={styles.status}><i />{itemCancelled ? <><strong>✕ تم إلغاء المنتج</strong><small>لن يُحتسب في الحساب</small></> : itemReady ? <><strong>{itemStatus === "served" ? "☕ تم التقديم ✓" : "☕✨ جاهز ✓"}</strong><small>{itemStatus === "served" ? "بالهنا والشفا" : "استلمه الآن"}</small></> : itemStatus === "preparing" ? <><strong>قيد التحضير</strong><small>الباريستا يجهزه الآن</small></> : <><strong>تم الاستلام</strong><small>في انتظار التحضير</small></>}</div>
                </article>
                );
              })}
            </section>
            <button type="button" className={styles.billButton} onClick={() => void requestBill()} disabled={(billRequested && !billReminderAvailable) || !allReady}>
              <span aria-hidden="true">▣</span>
              <strong>{billRequested ? (billReminderAvailable ? "تذكير الكاشير" : "تم طلب الحساب") : allReady ? "إنهاء الجلسة وطلب الحساب" : "الحساب بعد جاهزية الطلب"}</strong>
              <small>{billRequested ? "سيأتي الباريستا لمراجعة الحساب" : allReady ? "الحساب التفصيلي لكل شخص ومشروبه" : "انتظر حتى تصبح كل المشروبات جاهزة"}</small>
            </button>
            <p className={styles.serviceNote}>عند جاهزية أي مشروب ستتغير بطاقته إلى «جاهز». استلمه من الكاونتر أو انتظر النادل حسب نظام الكافيه.</p>
          </>
        )}
      </div>
      {billRequested && order && (
        <div className={styles.receiptBackdrop} role="dialog" aria-modal="true" aria-labelledby="receipt-title">
          <section className={styles.receiptCard}>
            <button type="button" className={styles.receiptClose} onClick={() => setBillRequested(false)} aria-label="إغلاق">×</button>
            <div className={styles.receiptLogo}>☕</div>
            <p className={styles.receiptKicker}>KING&apos;S CAFÉ · TABLE {tableId}</p>
            <h2 id="receipt-title">طلب الحساب</h2>
            <span className={styles.receiptStatus}>تم إرسال الطلب للباريستا</span>
            <div className={styles.receiptGroups}>{receiptGroups.map((group) => <div className={styles.receiptGroup} key={group.name}><header><strong>طلب {group.name}</strong><b>{group.total} EGP</b></header>{group.items.map((item) => <div className={styles.receiptLine} key={item.id}><span>{item.productName} ×{item.quantity}<small>{item.selectedOptions.map((option) => selectedCustomizationLabel(option)).filter(Boolean).join(" · ") || "بدون إضافات"}</small></span><b>{item.totalPrice} EGP</b></div>)}</div>)}</div>
            <div className={styles.receiptTotal}><span>الإجمالي</span><strong>{payableTotal} <small>EGP</small></strong></div>
            <p className={styles.receiptNote}>الدفع وإنهاء الجلسة يتمان عن طريق الباريستا.</p>
          </section>
        </div>
      )}
    </main>
  );
}

function getItemStatus(item: DraftCartItem) {
  return item.status ?? "received";
}
