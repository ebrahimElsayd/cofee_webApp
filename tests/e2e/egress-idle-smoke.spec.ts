import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const customerUrl = process.env.E2E_CUSTOMER_URL ?? "http://localhost:3002";
const tableId = process.env.E2E_TABLE_ID ?? "20";
const cafeId = process.env.E2E_CAFE_ID ?? "00000000-0000-0000-0000-000000000001";

test("customer app performs no periodic PostgREST reads while idle", async ({ page }) => {
  test.setTimeout(45_000);
  let phase: "startup" | "idle" = "startup";
  const metrics = new Map<string, { startupCalls: number; startupBytes: number; idleCalls: number; idleBytes: number }>();
  const pendingMeasurements: Promise<void>[] = [];
  let menuShape: { products: number; imageCharacters: number; embeddedImages: number; modifierOptions: number } | null = null;

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/rest/v1/")) return;
    const endpoint = url.pathname;
    const observedPhase = phase;
    pendingMeasurements.push(response.body().then(async (body) => {
      const current = metrics.get(endpoint) ?? { startupCalls: 0, startupBytes: 0, idleCalls: 0, idleBytes: 0 };
      if (observedPhase === "startup") { current.startupCalls += 1; current.startupBytes += body.byteLength; }
      else { current.idleCalls += 1; current.idleBytes += body.byteLength; }
      metrics.set(endpoint, current);
      if (endpoint === "/rest/v1/menu_products") {
        const products = JSON.parse(body.toString()) as Array<{ id?: unknown; name?: unknown; image_url?: unknown; product_modifier_groups?: Array<{ modifier_groups?: { modifier_options?: unknown[] } | null }> }>;
        menuShape = {
          products: products.length,
          imageCharacters: products.reduce((sum, product) => sum + (typeof product.image_url === "string" ? product.image_url.length : 0), 0),
          embeddedImages: products.filter((product) => typeof product.image_url === "string" && product.image_url.startsWith("data:image/")).length,
          modifierOptions: products.reduce((sum, product) => sum + (product.product_modifier_groups ?? []).reduce((groupSum, link) => groupSum + (link.modifier_groups?.modifier_options?.length ?? 0), 0), 0),
        };
        const source = products.find((product) => typeof product.image_url === "string" && product.image_url.startsWith("data:image/"));
        if (source && typeof source.image_url === "string") {
          const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(source.image_url);
          if (match) {
            const extension = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
            await mkdir("test-results", { recursive: true });
            await writeFile(`test-results/embedded-menu-image.${extension}`, Buffer.from(match[2], "base64"));
            console.log(`[embedded-menu-image] product_id=${String(source.id ?? "")} product_name=${String(source.name ?? "")} extension=${extension}`);
          }
        }
      }
    }).catch(() => undefined));
  });

  await page.goto(`${customerUrl}/table/${tableId}?cafe=${cafeId}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(`/table/${tableId}/menu`), { timeout: 20_000 });
  await page.waitForTimeout(3_000);
  await Promise.all(pendingMeasurements);
  phase = "idle";
  await page.waitForTimeout(15_000);
  await Promise.all(pendingMeasurements);

  const rows = [...metrics.entries()].map(([endpoint, value]) => ({ endpoint, ...value }));
  console.log(`[egress-measurement] ${JSON.stringify(rows)}`);
  console.log(`[menu-shape] ${JSON.stringify(menuShape)}`);
  expect(rows.reduce((total, row) => total + row.idleCalls, 0)).toBe(0);

  const menuCallsBeforeReload = metrics.get("/rest/v1/menu_products")?.startupCalls ?? 0;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(`/table/${tableId}/menu`), { timeout: 20_000 });
  await page.waitForTimeout(3_000);
  await Promise.all(pendingMeasurements);
  const menuMetric = metrics.get("/rest/v1/menu_products");
  const menuCallsAfterReload = (menuMetric?.startupCalls ?? 0) + (menuMetric?.idleCalls ?? 0);
  console.log(`[menu-warm-reload] menu_products_calls=${menuCallsAfterReload - menuCallsBeforeReload}`);
  expect(menuCallsAfterReload - menuCallsBeforeReload).toBe(0);
});
