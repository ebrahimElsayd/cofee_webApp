import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("settled sessions are locked at the database boundary", async () => {
  const sql = await readFile(new URL("supabase/migrations/202609200001_lock_settled_table_sessions.sql", root), "utf8");
  assert.match(sql, /status in \('open','ordering'\)/);
  assert.match(sql, /before insert on public\.orders/);
  assert.match(sql, /before insert or update on public\.cart_items/);
  assert.match(sql, /set status='abandoned'/);
  assert.match(sql, /members can create orders[\s\S]*session_accepts_customer_orders/);
});

test("customer cart rejects payment_pending while tracking keeps it visible", async () => {
  const cart = await readFile(new URL("src/features/cart/services/local-draft-cart.service.ts", root), "utf8");
  const tracking = await readFile(new URL("src/features/table-navigation/services/supabase-order-tracking.service.ts", root), "utf8");
  assert.match(cart, /ORDERABLE_SESSION_STATUSES = new Set\(\["active", "open", "ordering"\]\)/);
  assert.match(cart, /row\?\.status === "payment_pending"/);
  assert.match(tracking, /ACTIVE_SESSION_STATUSES = new Set\(\["open", "ordering", "payment_pending"\]\)/);
  assert.match(tracking, /sessionStatus: session\.status/);
});

test("customer UI explains the paid-session lock instead of suggesting a retry", async () => {
  const screen = await readFile(new URL("src/features/menu/components/product-details-screen.tsx", root), "utf8");
  assert.match(screen, /تم تحصيل حساب هذه الجلسة/);
  assert.match(screen, /اطلب من الكاشير إغلاق الطاولة/);
  assert.match(screen, /payment_pending/);
});

test("payment_pending is locked only when a paid payment record exists", async () => {
  const sql = await readFile(new URL("supabase/migrations/202609210001_reconcile_unpaid_payment_pending_sessions.sql", root), "utf8");
  assert.match(sql, /session_has_paid_payment/);
  assert.match(sql, /status = 'payment_pending'[\s\S]*not public\.session_has_paid_payment/);
  const cart = await readFile(new URL("src/features/cart/services/local-draft-cart.service.ts", root), "utf8");
  assert.match(cart, /from\("payments"\)/);
  assert.match(cart, /eq\("status", "paid"\)/);
});
