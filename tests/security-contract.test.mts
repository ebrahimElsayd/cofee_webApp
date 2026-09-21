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
