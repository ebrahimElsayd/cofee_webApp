"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getCartUpdatedEventName,
  getLocalDraftCart,
} from "@/features/cart/services/local-draft-cart.service";
import styles from "./table-bottom-navigation.module.css";

export function TableBottomNavigation({ tableId }: { tableId: number }) {
  const pathname = usePathname();
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    function refreshCartCount() {
      setCartCount(
        getLocalDraftCart(tableId).reduce((total, item) => total + item.quantity, 0),
      );
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
  );
}

function NavIcon({ name }: { name: "menu" | "cart" | "track" | "service" }) {
  if (name === "menu") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
  if (name === "cart") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></svg>;
  if (name === "track") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M12 14v6M8 20h8M4 7v2a3 3 0 0 0 3 3M20 7v2a3 3 0 0 1-3 3" /></svg>;
}
