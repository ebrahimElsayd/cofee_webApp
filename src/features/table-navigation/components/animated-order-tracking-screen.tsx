"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getLastSubmittedTableOrder } from "@/features/cart/services/local-draft-cart.service";
import type { DraftCartItem, SubmittedTableOrder } from "@/features/cart/types/draft-cart";
import styles from "./animated-order-tracking-screen.module.css";

export function AnimatedOrderTrackingScreen({ tableId }: { tableId: number }) {
  const [order, setOrder] = useState<SubmittedTableOrder | null>(null);
  const [ready, setReady] = useState(false);

  const readyItems = order?.items.filter((item) => getItemStatus(item) === "ready").length ?? 0;
  const allReady = Boolean(order && order.items.length > 0 && readyItems === order.items.length);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrder(getLastSubmittedTableOrder(tableId));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tableId]);

  useEffect(() => {
    if (!order || typeof window === "undefined" || !("Notification" in window)) return;
    const readyItems = order.items.filter((item) => getItemStatus(item) === "ready");
    const notifiedKey = `kings-cafe:ready-notified:${order.id}`;
    const notified = new Set(JSON.parse(window.localStorage.getItem(notifiedKey) ?? "[]") as string[]);
    const newReadyItems = readyItems.filter((item) => !notified.has(item.id));
    if (newReadyItems.length === 0) return;

    const sendNotifications = () => {
      for (const item of newReadyItems) {
        new Notification(`${item.productName} جاهز للاستلام`, {
          body: `طلب ${item.recipientName} جاهز الآن من الكاونتر.`,
          tag: `ready-${item.id}`,
        });
        notified.add(item.id);
      }
      window.localStorage.setItem(notifiedKey, JSON.stringify(Array.from(notified)));
    };

    if (Notification.permission === "granted") sendNotifications();
    else if (Notification.permission === "default") void Notification.requestPermission().then((permission) => {
      if (permission === "granted") sendNotifications();
    });
  }, [order]);

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
            <section className={`${styles.hero} ${allReady ? styles.heroReady : ""}`}>
              <div className={styles.coffeeScene} aria-hidden="true">
                <span className={styles.steam} /><span className={styles.steam} /><span className={styles.steam} />
                <div className={`${styles.cup} ${allReady ? styles.cupReady : ""}`}><i /><b /></div>
                <div className={styles.saucer} />
              </div>
              <div><strong>{allReady ? "طلبك جاهز للاستلام" : "رحلة طلبك بدأت"}</strong><p>{allReady ? "استلمه من الكاونتر أو انتظر النادل" : "طلبك وصل للباريستا ويجري تحضيره بعناية"}</p></div>
              <small>#{order.id}</small>
            </section>
            <section className={styles.journey} aria-label="رحلة الطلب">
              <div className={styles.journeyLine}><i /></div>
              <div className={`${styles.journeyNode} ${styles.done}`}><i>1</i><b>تم الاستلام</b><small>Received</small></div>
              <div className={`${styles.journeyNode} ${allReady ? styles.done : styles.active}`}><i>2</i><b>التحضير</b><small>{allReady ? "Prepared" : "Preparing"}</small></div>
              <div className={`${styles.journeyNode} ${allReady ? styles.done : ""}`}><i>{allReady ? "✓" : "3"}</i><b>جاهز</b><small>Ready</small></div>
            </section>
            <section className={styles.drinks}>
              <header><div><h2>مشروباتك</h2><p>كل مشروب له حالة مستقلة</p></div><b>{order.items.length} عناصر</b></header>
              {order.items.map((item, index) => {
                const itemReady = getItemStatus(item) === "ready";
                return (
                <article className={`${styles.drink} ${itemReady ? styles.drinkReady : ""}`} key={item.id} style={{ "--item-index": index } as React.CSSProperties}>
                  <div className={styles.image}><Image src={item.productImageUrl?.startsWith("/") ? item.productImageUrl : `/images/products/${item.productSlug}.webp`} alt="" fill sizes="56px" unoptimized /></div>
                  <div className={styles.copy}><h3 lang="en">{item.productName}</h3><p>{item.recipientName} · {item.productNameAr}</p></div>
                  <div className={styles.status}><i />{itemReady ? <><strong>جاهز ✓</strong><small>استلمه الآن</small></> : <><strong>تم الاستلام</strong><small>في انتظار التحضير</small></>}</div>
                </article>
                );
              })}
            </section>
            <p className={styles.serviceNote}>عند جاهزية أي مشروب ستتغير بطاقته إلى «جاهز». استلمه من الكاونتر أو انتظر النادل حسب نظام الكافيه.</p>
          </>
        )}
      </div>
    </main>
  );
}

function getItemStatus(item: DraftCartItem) {
  return item.status ?? "received";
}
