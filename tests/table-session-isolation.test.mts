import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real services with an in-memory browser and a read-only DB stub.
function setup(status = "open") {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const key = "kings-cafe:active-table-session";
  const session = (tableId: number) => ({ tableId, sessionId: `session-${tableId}`, cafeId: "cafe", guestId: `guest-${tableId}`, outcome: "joined" });
  storage.setItem(`${key}:5`, JSON.stringify(session(5)));
  storage.setItem(`${key}:10`, JSON.stringify(session(10)));
  storage.setItem(key, JSON.stringify(session(10)));
  storage.setItem("kings-cafe:table:10:draft-cart:v2", "[1]");
  const queried: string[] = [];
  const db = {
    rpc(name: string, args: { p_session_id: string }) {
      assert.equal(name, "customer_validate_table_session");
      queried.push(args.p_session_id);
      return { async maybeSingle() { return { data: { session_id: args.p_session_id, table_id: "table-5", session_status: status, cafe_id: "cafe", table_number: 5 }, error: null }; } };
    },
    from(name: string) {
    let id = "";
    const query = {
      select() { return query; }, eq(column: string, value: string) { if (column === "id") id = value; return query; },
      limit() { return query; },
      async maybeSingle() {
        if (name === "payments") return { data: null, error: null };
        return { data: { id, table_id: "table-5", status, cafe_tables: { table_number: 5, cafe_id: "cafe" } }, error: null };
      },
      async single() { return { data: { id: "cart-5" }, error: null }; },
      async order() { assert.equal(name, "cart_items"); return { data: [], error: null }; },
    };
    return query;
  } };
  const modules = new Map<string, unknown>();
  // Service exports are loaded dynamically after TypeScript compilation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const load = (path: string): any => {
    if (modules.has(path)) return modules.get(path);
    const loadedModule = { exports: {} };
    const source = ts.transpileModule(readFileSync(new URL(`../src/${path}.ts`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports,
      require(name: string) {
        if (name.includes("supabase/browser")) return { createSupabaseBrowserClient: () => db };
        if (name.includes("utils/uuid")) return { generateSafeUUID: () => "test-id" };
        if (name.includes("types/table-session")) return { TableSessionError: Error };
        if (name.includes("local-table-session.service")) return load("features/table-session/services/local-table-session.service");
        throw new Error(`Unexpected import ${name}`);
      },
      window: { localStorage: storage, location: { href: "https://test.local/table/5/cart" }, setTimeout, clearTimeout, dispatchEvent() {} },
      URL, CustomEvent: class {},
    });
    modules.set(path, loadedModule.exports);
    return loadedModule.exports;
  };
  return { storage, key, queried, load };
}

test("cart uses table 5 session while last opened table is 10", async () => {
  const env = setup();
  const cart = env.load("features/cart/services/local-draft-cart.service");
  assert.equal((await cart.getSharedDraftCart(5)).length, 0);
  assert.deepEqual(env.queried, ["session-5"]);
  assert.ok(env.storage.getItem(`${env.key}:10`));
});

test("closed table clears only its own context and preserves other table cart", async () => {
  const env = setup("closed");
  await assert.rejects(env.load("features/cart/services/local-draft-cart.service").getSharedDraftCart(5), /no longer active/);
  assert.equal(env.storage.getItem(`${env.key}:5`), null);
  assert.ok(env.storage.getItem(`${env.key}:10`));
  assert.match(env.storage.getItem(env.key)!, /session-10/);
  assert.equal(env.storage.getItem("kings-cafe:table:10:draft-cart:v2"), "[1]");
});

test("missing table context does not erase last opened table", async () => {
  const env = setup();
  env.storage.removeItem(`${env.key}:5`);
  await assert.rejects(env.load("features/cart/services/local-draft-cart.service").getSharedDraftCart(5), /CONTEXT_MISSING/);
  assert.equal(env.queried.length, 0);
  assert.ok(env.storage.getItem(env.key));
});

test("recipient names stay attached to each table session", async () => {
  const env = setup();
  const names = env.load("features/table-session/services/guest-recipient-names.service");
  await names.saveRecipientName(5, "Guest Five");
  await names.saveRecipientName(10, "Guest Ten");
  assert.equal(JSON.stringify(await names.getRecipientNames(5)), '["Guest Five"]');
  assert.equal(JSON.stringify(await names.getRecipientNames(10)), '["Guest Ten"]');
});

test("paid session remains available for tracking without clearing context", async () => {
  const env = setup("payment_pending");
  await env.load("features/table-navigation/services/supabase-order-tracking.service").validateActiveTableSession(5);
  assert.ok(env.storage.getItem(`${env.key}:5`));
  assert.ok(env.storage.getItem(`${env.key}:10`));
});

test("tracking distinguishes missing local context from confirmed closure", async () => {
  const env = setup();
  env.storage.removeItem(`${env.key}:5`);
  await assert.rejects(env.load("features/table-navigation/services/supabase-order-tracking.service").validateActiveTableSession(5), /CONTEXT_MISSING/);
  assert.ok(env.storage.getItem(env.key));
});

test("tracking rejects a confirmed closed session and preserves the other table", async () => {
  const env = setup("closed");
  await assert.rejects(env.load("features/table-navigation/services/supabase-order-tracking.service").validateActiveTableSession(5), /session has ended/);
  assert.equal(env.storage.getItem(`${env.key}:5`), null);
  assert.ok(env.storage.getItem(`${env.key}:10`));
});
