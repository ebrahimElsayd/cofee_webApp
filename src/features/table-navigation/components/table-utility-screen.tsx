"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLastSubmittedTableOrder } from "@/features/cart/services/local-draft-cart.service";
import type { SubmittedTableOrder } from "@/features/cart/types/draft-cart";
import styles from "./table-utility-screen.module.css";

export function OrderTrackingScreen({ tableId }: { tableId: number }) {
  const [order, setOrder] = useState<SubmittedTableOrder | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrder(getLastSubmittedTableOrder(tableId));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tableId]);

  return (
    <UtilityShell title="متابعة الطلب" subtitle="Order Tracking" tableId={tableId}>
      {!ready ? <div className={styles.loader} /> : order ? (
        <>
          <section className={styles.timerCard}>
            <div className={styles.progressRing}><strong>3:07</strong><span>دقائق متبقية</span></div>
            <p>طلب رقم <b>#{order.id}</b></p>
          </section>
          <section className={styles.orderSummary}>
            <div><span>طلب الطاولة</span><b>{order.itemCount} منتجات</b></div>
            <div><span>الإجمالي</span><b>{order.total} EGP</b></div>
          </section>
          <section className={styles.timeline}>
            <div className={styles.done}><i>✓</i><strong>تم استلام الطلب</strong><span>Received</span></div>
            <div className={styles.current}><i>2</i><strong>جاري التحضير</strong><span>Preparing</span></div>
            <div><i>3</i><strong>جاهز</strong><span>Ready</span></div>
          </section>
        </>
      ) : (
        <section className={styles.emptyState}>
          <span aria-hidden="true">◷</span>
          <h2>لا يوجد طلب قيد التحضير</h2>
          <p>أرسل طلب الطاولة من الكارت أولًا، وبعدها ستظهر مراحل التحضير هنا.</p>
          <Link href={`/table/${tableId}/cart`}>فتح الكارت</Link>
        </section>
      )}
    </UtilityShell>
  );
}

const serviceActions = [
  { id: "waiter", title: "طلب النادل", subtitle: "Call Waiter", icon: "☎" },
  { id: "tissues", title: "مناديل", subtitle: "Tissues", icon: "◌" },
  { id: "water", title: "مياه", subtitle: "Water", icon: "◉" },
  { id: "bill", title: "طلب الحساب", subtitle: "Ask for Bill", icon: "▣" },
] as const;

export function TableServiceScreen({ tableId }: { tableId: number }) {
  const [sentService, setSentService] = useState("");

  function requestService(title: string) {
    setSentService(title);
    window.setTimeout(() => setSentService(""), 2400);
  }

  return (
    <UtilityShell title="خدمة الطاولة" subtitle="Smart Service" tableId={tableId}>
      <section className={styles.serviceIntro}>
        <span>✦</span>
        <div><h2>تحتاج حاجة؟</h2><p>اختار الخدمة وسنبلغ فريق الكافيه فورًا.</p></div>
      </section>
      <section className={styles.serviceGrid}>
        {serviceActions.map((action) => (
          <button key={action.id} type="button" onClick={() => requestService(action.title)}>
            <i aria-hidden="true">{action.icon}</i>
            <strong>{action.title}</strong>
            <span lang="en">{action.subtitle}</span>
          </button>
        ))}
      </section>
      <p className={styles.serviceNote}>هذه الخدمات تجريبية الآن، وسيتم ربطها بنظام الكافيه في مرحلة الـBackend.</p>
      {sentService && <div className={styles.toast} role="status">✓ تم إرسال «{sentService}»</div>}
    </UtilityShell>
  );
}

function UtilityShell({
  title,
  subtitle,
  tableId,
  children,
}: {
  title: string;
  subtitle: string;
  tableId: number;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header>
          <div><p lang="en">{subtitle}</p><h1>{title}</h1></div>
          <span><i /> Table {tableId}</span>
        </header>
        {children}
      </div>
    </main>
  );
}
