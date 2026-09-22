import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

test("order submission sends identifiers only and retains idempotency", () => {
  const cart = source("src/features/cart/services/local-draft-cart.service.ts");
  const rpcPayload = cart.slice(cart.indexOf('supabase.rpc("submit_table_order"'), cart.indexOf("if (submitError"));
  assert.match(rpcPayload, /p_idempotency_key:\s*idempotencyKey/);
  assert.match(rpcPayload, /selected_modifier_option_ids/);
  assert.doesNotMatch(rpcPayload, /unit_price|p_total/);
});

test("shared cart assigns one responsible guest and synchronizes real-time submission", () => {
  const cart = source("src/features/cart/services/local-draft-cart.service.ts");
  const screen = source("src/features/cart/components/cart-screen.tsx");
  const migration = source("supabase/migrations/202609220002_cart_responsibility_and_realtime.sql");

  assert.match(migration, /responsible_guest_id\s*=\s*coalesce\(responsible_guest_id, v_guest_id\)/);
  assert.match(migration, /Only the responsible guest can submit this cart/);
  assert.match(migration, /for update/);
  assert.match(migration, /supabase_realtime add table public\.carts/);
  assert.match(migration, /supabase_realtime add table public\.cart_items/);
  assert.match(cart, /customer-cart-live:/);
  assert.match(cart, /table:\s*"carts"/);
  assert.match(cart, /filter: `session_id=eq\.\$\{session\.sessionId\}`/);
  assert.match(screen, /disabled=\{!canSubmit/);
  assert.match(screen, /subscribeToSharedDraftCart/);
});

test("only the first submission is owner-controlled", () => {
  const migration = source("supabase/migrations/202609220004_allow_followup_guest_submissions.sql");
  const cart = source("src/features/cart/services/local-draft-cart.service.ts");
  const screen = source("src/features/cart/components/cart-screen.tsx");
  assert.match(migration, /v_has_previous_orders/);
  assert.match(migration, /not v_has_previous_orders/);
  assert.match(migration, /submit the first order/);
  assert.match(cart, /canCurrentGuestSubmit/);
  assert.match(screen, /بعد أول طلب يمكن لأي ضيف/);
});

test("cart realtime refresh does not reload the menu catalog", () => {
  const screen = source("src/features/cart/components/cart-screen.tsx");
  assert.match(screen, /refreshCart\(\{ checkCatalog: true \}\)/);
  assert.match(screen, /subscribeToSharedDraftCart\(tableId, \(\) => \{ void refreshCart\(\); \}\)/);
});

test("customer order tracking is scoped to the active session", () => {
  const tracking = source("src/features/table-navigation/services/supabase-order-tracking.service.ts");
  assert.match(tracking, /table:\s*"orders",\s*filter:\s*`session_id=eq\.\$\{pointer\.sessionId\}`/);
  assert.match(tracking, /table:\s*"order_items",\s*filter:\s*`session_id=eq\.\$\{pointer\.sessionId\}`/);
  assert.match(tracking, /table:\s*"notifications",\s*filter:\s*`session_id=eq\.\$\{pointer\.sessionId\}`/);
});

test("menu uses persistent versioned cache and merges concurrent loads", () => {
  const menu = source("src/features/menu/services/supabase-menu.service.ts");
  assert.match(menu, /readStoredMenuCatalog\(activeCafeId\)/);
  assert.match(menu, /catalogRequest\s*&&\s*catalogRequestCafeId\s*===\s*activeCafeId/);
  assert.match(menu, /get_customer_menu_version/);
});

test("all menu catalog access is scoped to the current table session", () => {
  const route = source("src/features/menu/components/product-details-route.tsx");
  const menu = source("src/features/menu/services/supabase-menu.service.ts");
  assert.match(route, /getSupabaseMenuProduct\(\{ tableId, productSlug \}\)/);
  assert.match(menu, /getSupabaseMenuProduct\(options: \{ tableId: number; productSlug: string \}\)/);
  assert.match(menu, /\.eq\("cafe_id", cafeId\)\.eq\("slug", slug\)/);
  assert.match(menu, /getSupabaseMenuCatalog\(options: \{ forceRefresh\?: boolean; tableId: number \}\)/);
});

test("table session bootstrap uses bounded secure RPCs", () => {
  const session = source("src/features/table-session/services/local-table-session.service.ts");
  assert.match(session, /rpc\("customer_resolve_table"/);
  assert.match(session, /rpc\("customer_open_table_session"/);
  assert.match(session, /TABLE_SESSION_REQUEST_TIMEOUT_MS/);
});

test("remote product images use the Next optimizer instead of direct full-size downloads", () => {
  const image = source("src/shared/presentation/components/resilient-image.tsx");
  const config = source("next.config.ts");
  assert.doesNotMatch(image, /\bunoptimized\s*(?:\/?>|=\{true\})/);
  assert.match(image, /unoptimized=\{currentSrc\.startsWith\("data:image\/"\)\}/);
  assert.match(config, /\/storage\/v1\/object\/public\/product-images\/\*\*/);
});

test("bill requests are deduplicated in the client and rejected after settlement", () => {
  const service = source("src/features/table-navigation/services/table-service-request.service.ts");
  const tracking = source("src/features/table-navigation/components/animated-order-tracking-screen.tsx");
  const utility = source("src/features/table-navigation/components/table-utility-screen.tsx");
  const migration = source("supabase/migrations/202609210007_harden_bill_request_session_state.sql");
  assert.match(service, /inFlightRequests/);
  assert.match(service, /existingRequest/);
  assert.match(tracking, /billRequestSubmitting/);
  assert.match(utility, /submittingService/);
  assert.match(utility, /succeeded = true/);
  assert.match(utility, /تعذر إرسال الطلب/);
  assert.match(tracking, /billRequestError/);
  assert.match(migration, /v_status IN \('open', 'ordering'\)/);
  assert.match(migration, /session_has_paid_payment/);
  assert.match(migration, /service_requests_one_open_bill_per_session/);
});

test("manager product removal is a cafe-scoped archive that preserves order history", () => {
  const migration = source("supabase/migrations/202609220001_archive_product.sql");
  assert.match(migration, /public\.is_staff_user\(\)/);
  assert.match(migration, /v_cafe_id <> public\.current_staff_cafe_id\(\)/);
  assert.match(migration, /set availability = 'hidden'/);
  assert.match(migration, /product_availability/);
  assert.doesNotMatch(migration, /delete from public\.menu_products/);
});

test("archived products restore as temporarily unavailable within the active cafe", () => {
  const migration = source("supabase/migrations/202609220002_restore_archived_product.sql");
  assert.match(migration, /public\.is_staff_user\(\)/);
  assert.match(migration, /v_cafe_id <> public\.current_staff_cafe_id\(\)/);
  assert.match(migration, /and availability = 'hidden'/);
  assert.match(migration, /set availability = 'unavailable'/);
  assert.match(migration, /values \(p_product_id, false, now\(\)\)/);
});

test("archived products are excluded from customer catalog and detail routes", () => {
  const menu = source("src/features/menu/services/supabase-menu.service.ts");
  const hiddenFilters = menu.match(/\.neq\("availability", "hidden"\)/g) ?? [];
  assert.ok(hiddenFilters.length >= 3, "catalog, id lookup, and slug lookup must all exclude hidden products");
  assert.match(menu, /\.eq\("cafe_id", cafeId\)\.eq\("id", productId\)\.neq\("availability", "hidden"\)/);
  assert.match(menu, /\.eq\("cafe_id", cafeId\)\.eq\("slug", slug\)\.neq\("availability", "hidden"\)/);
});

test("unused test categories are hidden without deleting history or active catalog groups", () => {
  const migration = source("supabase/migrations/202609220003_hide_unused_test_categories.sql");
  assert.match(migration, /set is_active = false/);
  assert.match(migration, /not exists/);
  assert.match(migration, /product\.availability <> 'hidden'/);
  assert.doesNotMatch(migration, /delete from public\.menu_categories/);
});

test("temporarily unavailable products are consistently blocked across menu, details, and cart", () => {
  const menuTypes = source("src/features/menu/types/menu.ts");
  const menuScreen = source("src/features/menu/components/menu-screen.tsx");
  const details = source("src/features/menu/components/product-details-screen.tsx");
  const cart = source("src/features/cart/components/cart-screen.tsx");
  const service = source("src/features/menu/services/supabase-menu.service.ts");
  assert.match(menuTypes, /"temporarily-unavailable"/);
  assert.match(menuScreen, /غير متاح مؤقتًا/);
  assert.match(details, /disabled=\{isSaving \|\| isUnavailable\}/);
  assert.match(cart, /blockedProductIds\.size > 0/);
  assert.match(cart, /forceRefresh: true/);
  assert.match(service, /product\.availability === "available" \? "available" : "temporarily-unavailable"/);
  assert.doesNotMatch(menuTypes, /sold-out/);
});

test("product add is synchronously deduplicated against rapid double taps", () => {
  const details = source("src/features/menu/components/product-details-screen.tsx");
  assert.match(details, /saveInFlightRef/);
  assert.match(details, /if \(saveInFlightRef\.current\) return/);
  assert.match(details, /saveInFlightRef\.current = true/);
  assert.match(details, /saveInFlightRef\.current = false/);
});
