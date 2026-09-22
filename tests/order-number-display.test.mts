import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

test("customer order UI uses the sequential order number, never the UUID", () => {
  const type = source("src/features/cart/types/draft-cart.ts");
  const submit = source("src/features/cart/services/local-draft-cart.service.ts");
  const tracking = source("src/features/table-navigation/services/supabase-order-tracking.service.ts");
  const cart = source("src/features/cart/components/cart-screen.tsx");
  const animated = source("src/features/table-navigation/components/animated-order-tracking-screen.tsx");
  const legacy = source("src/features/table-navigation/components/table-utility-screen.tsx");

  assert.match(type, /orderNumber\?: number/);
  assert.match(submit, /\.select\("order_number"\)/);
  assert.match(submit, /orderNumber,\s*tableId/);
  assert.match(tracking, /orderNumber:\s*orders\[orders\.length - 1\]\.order_number/);
  assert.match(cart, /submittedOrderNumber/);
  assert.match(cart, /#\{submittedOrderNumber/);
  assert.match(animated, /#\{order\.orderNumber \?\? "—"\}/);
  assert.match(legacy, /#\{order\.orderNumber \?\? "—"\}/);
  assert.doesNotMatch(cart, /#\{submittedOrderId\}/);
  assert.doesNotMatch(animated, /#\{order\.id\}/);
  assert.doesNotMatch(legacy, /#\{order\.id\}/);
});
