"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  getCartUpdatedEventName,
  getSharedDraftCart,
} from "@/features/cart/services/local-draft-cart.service";
import { getCustomerNotifications, markCustomerNotificationsRead, subscribeToTableOrderUpdates, TableSessionClosedError, validateActiveTableSession } from "../services/supabase-order-tracking.service";
import styles from "./table-bottom-navigation.module.css";

type CustomerNotification = { id: string; title: string; message: string; createdAt: string; read: boolean };

export function TableBottomNavigation({ tableId }: { tableId: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const cafeId = searchParams.get("cafe");
  const [cartCount, setCartCount] = useState(0);
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readyToast, setReadyToast] = useState<CustomerNotification | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const storageKey = `kings-cafe:customer-notifications:${tableId}`;
    let active = true;
    let remoteHydrated = false;
    const mountedAt = Date.now();
    const knownRemoteIds = new Set<string>();
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as CustomerNotification[];
      if (Array.isArray(stored)) {
        const cachedNotifications = stored
          .filter((item) => item.title === "الطلب جاهز" || item.title === "تنبيه من الكاشير")
          .slice(0, 8);
        queueMicrotask(() => { if (active) setNotifications(cachedNotifications); });
      }
    } catch { /* A notification center must never block the order flow. */ }

    const refresh = async (options: { notifications?: boolean; session?: boolean } = { notifications: true, session: true }) => {
      try {
        if (options.notifications) try {
          const remoteNotifications = await getCustomerNotifications();
          if (active) {
            const mapped = remoteNotifications.map((item) => ({ id: item.id, title: item.title, message: item.body, createdAt: item.created_at, read: item.is_read }));
            const newSignal = remoteHydrated
              ? mapped.find((item) => !knownRemoteIds.has(item.id))
              : mapped.find((item) => !item.read && Date.parse(item.createdAt) >= mountedAt);
            mapped.forEach((item) => knownRemoteIds.add(item.id));
            remoteHydrated = true;
            setNotifications(mapped);
            try { window.localStorage.setItem(storageKey, JSON.stringify(mapped)); } catch { /* best effort */ }
            if (newSignal) {
              setReadyToast(newSignal);
              if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
              toastTimerRef.current = window.setTimeout(() => setReadyToast(null), 7_000);
            }
          }
        } catch { /* Older deployments may not have the notifications migration yet. */ }
        if (options.session) await validateActiveTableSession(tableId);
        if (!active) return;
      } catch (error) {
        if (error instanceof TableSessionClosedError && active) router.replace(tableRootFor(tableId, cafeId));
        /* Realtime and the order screen polling remain independent. */
      }
    };
    void refresh();
    const unsubscribe = subscribeToTableOrderUpdates((updates) => {
      if (updates.has("notifications")) void refresh({ notifications: true, session: false });
      if (updates.has("session")) void refresh({ notifications: false, session: true });
    });
    const reconcile = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void refresh();
    };
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, [cafeId, router, tableId]);

  useEffect(() => {
    function refreshCartCount() {
      void getSharedDraftCart(tableId)
        .then((items) => setCartCount(items.reduce((total, item) => total + item.quantity, 0)))
        .catch(() => setCartCount(0));
    }

    const timer = window.setTimeout(refreshCartCount, 0);
    const eventName = getCartUpdatedEventName();
    window.addEventListener(eventName, refreshCartCount);
    window.addEventListener("storage", refreshCartCount);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(eventName, refreshCartCount);
      window.removeEventListener("storage", refreshCartCount);
    };
  }, [tableId]);

  const tableRoot = `/table/${tableId}`;
  if (pathname === tableRoot || pathname.includes("/menu/product/")) return null;

  const items = [
    { href: `${tableRoot}/menu`, label: "القائمة", icon: "menu" },
    { href: `${tableRoot}/cart`, label: "الكارت", icon: "cart" },
    { href: `${tableRoot}/order`, label: "متابعة", icon: "track" },
    { href: `${tableRoot}/service`, label: "الخدمة", icon: "service" },
  ] as const;

  return (
    <>
      {readyToast && <div className={styles.readyToast} role="status" aria-live="polite"><span aria-hidden="true">☕✨</span><div><strong>{readyToast.title}</strong><small>{readyToast.message}</small></div><button type="button" onClick={() => setReadyToast(null)} aria-label="إغلاق">×</button></div>}
      <div className={styles.notificationArea}>
        <button type="button" className={`${styles.notificationButton} ${notifications.some((item) => !item.read) ? styles.hasUnread : ""}`} onClick={() => { setNotificationsOpen((open) => !open); void markCustomerNotificationsRead().catch(() => undefined); setNotifications((current) => { const next = current.map((item) => ({ ...item, read: true })); try { window.localStorage.setItem(`kings-cafe:customer-notifications:${tableId}`, JSON.stringify(next)); } catch { /* best effort */ } return next; }); }} aria-label="إشعارات الطلب" aria-expanded={notificationsOpen}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
          {notifications.some((item) => !item.read) && <b>{Math.min(99, notifications.filter((item) => !item.read).length)}</b>}
        </button>
        {notificationsOpen && <section className={styles.notificationPanel} role="dialog" aria-label="إشعارات الطلب">
          <header><strong>الإشعارات</strong><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="إغلاق">×</button></header>
          {notifications.length ? notifications.map((item) => <article key={item.id}><i /> <span><b>{item.title}</b><small>{item.message}</small></span></article>) : <p>لا توجد إشعارات جديدة</p>}
        </section>}
      </div>
      <nav className={styles.navigation} aria-label="التنقل الرئيسي">
      <div>
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? styles.active : undefined}
              aria-current={active ? "page" : undefined}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
              {item.icon === "cart" && cartCount > 0 && (
                <b aria-label={`${cartCount} منتجات في الكارت`}>{cartCount}</b>
              )}
            </Link>
          );
        })}
      </div>
      </nav>
    </>
  );
}

function tableRootFor(tableId: number, cafeId: string | null) {
  return cafeId ? `/table/${tableId}?cafe=${encodeURIComponent(cafeId)}` : `/table/${tableId}`;
}

function NavIcon({ name }: { name: "menu" | "cart" | "track" | "service" }) {
  if (name === "menu") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
  if (name === "cart") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></svg>;
  if (name === "track") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M12 14v6M8 20h8M4 7v2a3 3 0 0 0 3 3M20 7v2a3 3 0 0 1-3 3" /></svg>;
}
