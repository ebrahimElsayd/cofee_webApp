import { defineConfig, devices } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const customerRoot = dirname(fileURLToPath(import.meta.url));
const managerRoot = process.env.E2E_MANAGER_APP_DIR ?? resolve(customerRoot, "..", "coffee_managar");
const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.E2E_SUPABASE_ANON_KEY ?? "";

function assertLocalOrigin(value: string, expectedPort: string) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== expectedPort) {
    throw new Error(`E2E safety stop: application URL must use localhost:${expectedPort}.`);
  }
}

function validateQaTarget() {
  if (process.argv.some((argument) => argument === "--list" || argument.startsWith("--list="))) return;
  if (process.env.E2E_RUN_MUTATING !== "1") {
    throw new Error("E2E safety stop: set E2E_RUN_MUTATING=1 only when intentionally running the mutating QA lifecycle test.");
  }
  if (process.env.E2E_TARGET !== "coffee-qa") {
    throw new Error("E2E safety stop: E2E_TARGET must equal coffee-qa.");
  }
  if (!process.env.E2E_TABLE_ID || !process.env.E2E_QR_TOKEN || !process.env.E2E_MANAGER_EMAIL || !process.env.E2E_MANAGER_PASSWORD) {
    throw new Error("E2E requires an explicitly selected disposable QA table, its QR token, and QA cashier credentials.");
  }
  const ref = process.env.E2E_QA_PROJECT_REF;
  const projectUrl = new URL(supabaseUrl);
  if (!ref || ref !== "vtysgrsgmvwsnnokcitc" || projectUrl.hostname !== `${ref}.supabase.co` || !supabaseAnonKey) {
    throw new Error("E2E safety stop: this suite is pinned to the coffee-qa Supabase project and requires its matching URL and anon key.");
  }
  if (process.env.E2E_TABLE_ID !== "12") {
    throw new Error("E2E safety stop: use reserved QA table 12 only; the lifecycle test closes and settles its table.");
  }
  assertLocalOrigin(process.env.E2E_CUSTOMER_URL ?? "http://127.0.0.1:3002", "3002");
  assertLocalOrigin(process.env.E2E_MANAGER_URL ?? "http://127.0.0.1:3000", "3000");
}

// Validate before Playwright starts either app process, not merely before its
// test worker. Listing tests stays safe and does not require QA credentials.
validateQaTarget();

const serverEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["full-order-lifecycle.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3002",
      cwd: customerRoot,
      url: "http://127.0.0.1:3002",
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
      cwd: managerRoot,
      url: "http://127.0.0.1:3000",
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
