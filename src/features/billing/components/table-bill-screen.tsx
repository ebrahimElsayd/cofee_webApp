"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseTableOrder } from "@/features/table-navigation/services/supabase-order-tracking.service";
import type { SubmittedTableOrder } from "@/features/cart/types/draft-cart";
import { selectedCustomizationLabel } from "@/features/cart/utils/selected-customization-labels";
import styles from "./table-bill-screen.module.css";

export function TableBillScreen({ tableId }: { tableId: number }) {
  const [order, setOrder] = useState<SubmittedTableOrder | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getSupabaseTableOrder(tableId)
      .then((remoteOrder) => setOrder(remoteOrder))
      .catch(() => setOrder(null))
      .finally(() => setReady(true));
  }, [tableId]);

  const groups = useMemo(() => {
    const map = new Map<string, SubmittedTableOrder["items"]>();
    for (const item of order?.items ?? []) {
      if (item.status === "cancelled") continue;
      map.set(item.recipientName, [...(map.get(item.recipientName) ?? []), item]);
    }
    return Array.from(map, ([name, items]) => ({ name, items, total: items.reduce((sum, item) => sum + item.totalPrice, 0) }));
  }, [order]);

  return <main className={styles.page}><div className={styles.shell}>
    <header><Link href={`/table/${tableId}/order`} aria-label="العودة للطلب">‹</Link><div><p>TABLE BILL</p><h1>حساب الطاولة</h1></div><span>Table {tableId}</span></header>
    {!ready ? <div className={styles.loader} /> : !order ? <section className={styles.empty}><b>☕</b><h2>لا يوجد حساب بعد</h2><p>أرسل طلبًا أولًا ثم اطلب الحساب.</p><Link href={`/table/${tableId}/order`}>متابعة الطلب</Link></section> : <>
      <section className={styles.billHero}><div><p>الحساب المجمع</p><strong>{order.total} <small>EGP</small></strong></div><span>قيد مراجعة الباريستا</span></section>
      <section className={styles.groups}>{groups.map((group) => <article key={group.name}><header><div><b>{group.name}</b><small>{group.items.length} منتجات</small></div><strong>{group.total} <i>EGP</i></strong></header>{group.items.map((item) => <div className={styles.item} key={item.id}><div><b>{item.productName}</b><small>{item.selectedOptions.map((option) => selectedCustomizationLabel(option)).filter(Boolean).join(" · ") || "بدون إضافات"}</small></div><span>×{item.quantity}</span><strong>{item.totalPrice} EGP</strong></div>)}</article>)}</section>
      <section className={styles.total}><span>إجمالي الطاولة</span><strong>{order.total} <small>EGP</small></strong></section>
      <p className={styles.note}>الدفع وإنهاء الجلسة يتمان عن طريق الباريستا بعد مراجعة الحساب.</p>
    </>}
  </div></main>;
}
