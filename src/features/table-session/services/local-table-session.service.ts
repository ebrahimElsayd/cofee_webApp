import {
  TableSessionError,
  type TableSessionResolution,
} from "../types/table-session";
import { createSupabaseBrowserClient } from "@/shared/lib/supabase/browser";

const SESSION_STORAGE_KEY = "kings-cafe:active-table-session";
const TABLE_SESSION_REQUEST_TIMEOUT_MS = 12_000;

export type StoredTableSession = TableSessionResolution;

export function getStoredTableSession(): StoredTableSession | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "null") as Partial<StoredTableSession> | null;
    if (!parsed || !Number.isSafeInteger(parsed.tableId) || typeof parsed.cafeId !== "string" || typeof parsed.sessionId !== "string" || typeof parsed.guestId !== "string") return null;
    return parsed as StoredTableSession;
  } catch {
    return null;
  }
}

export function isValidTableId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;

  return Number.isSafeInteger(Number(value));
}

function parseTableId(value: string): number {
  if (!isValidTableId(value)) {
    throw new TableSessionError("INVALID_TABLE", "Table ID must be a positive safe integer.");
  }

  return Number(value);
}

export async function resolveLocalTableSession(
  rawTableId: string,
  requestedCafeId?: string,
  requestedTableToken?: string,
): Promise<TableSessionResolution> {
  const tableId = parseTableId(rawTableId);

  if (!requestedCafeId) {
    throw new TableSessionError(
      "MISSING_CAFE_SCOPE",
      "Scan the cafe table QR code to start a secure table session.",
    );
  }

  try {
    const supabase = createSupabaseBrowserClient();
    let { data: authData } = await withTimeout(
      supabase.auth.getSession(),
      TABLE_SESSION_REQUEST_TIMEOUT_MS,
    );
    if (!authData.session) {
      const anonymous = await withTimeout(
        supabase.auth.signInAnonymously(),
        TABLE_SESSION_REQUEST_TIMEOUT_MS,
      );
      if (anonymous.error) throw anonymous.error;
      authData = anonymous.data;
    }

    if (!authData.session?.user.id) throw new Error("Anonymous user was not created");

    const tableResult = await withTimeout(supabase.rpc("customer_resolve_table", {
      p_cafe_id: requestedCafeId,
      p_table_number: tableId,
      p_qr_token: requestedTableToken ?? null,
    }), TABLE_SESSION_REQUEST_TIMEOUT_MS);
    let table: { id: string; cafe_id: string };
    if (tableResult.error && isMissingRpc(tableResult.error)) {
      let legacyQuery = supabase.from("cafe_tables").select("id,cafe_id").eq("table_number", tableId);
      if (requestedCafeId) legacyQuery = legacyQuery.eq("cafe_id", requestedCafeId);
      const legacy = await legacyQuery.limit(2);
      if (legacy.error) throw legacy.error;
      if (!legacy.data?.length) throw new Error("Table not found");
      if (!requestedCafeId && legacy.data.length > 1) throw new TableSessionError("AMBIGUOUS_TABLE", "This table number belongs to more than one cafe. Use the cafe QR code.");
      table = legacy.data[0];
    } else {
      if (tableResult.error) throw tableResult.error;
      if (!tableResult.data?.length) throw new Error("Table not found");
      if (!requestedCafeId && tableResult.data.length > 1) throw new TableSessionError("AMBIGUOUS_TABLE", "This table number belongs to more than one cafe. Use the cafe QR code.");
      table = tableResult.data[0];
    }

    const sessionResult = await withTimeout(
      supabase.rpc("customer_open_table_session", { p_table_id: table.id }),
      TABLE_SESSION_REQUEST_TIMEOUT_MS,
    );
    let opened: { session_id: string; guest_id: string; cafe_id: string; outcome: string } | undefined;
    if (sessionResult.error && isMissingRpc(sessionResult.error)) {
      opened = await legacyOpenTableSession(supabase, table.id, table.cafe_id, authData.session.user.id);
    } else {
      if (sessionResult.error) throw sessionResult.error;
      opened = sessionResult.data?.[0];
    }
    if (!opened?.session_id || !opened.guest_id) throw new Error("Table session was not created");

    const resolution = { tableId, cafeId: opened.cafe_id, sessionId: opened.session_id, guestId: opened.guest_id, outcome: opened.outcome as TableSessionResolution["outcome"] };
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(resolution));
    return resolution;
  } catch (error) {
    if (error instanceof TableSessionError) throw error;
    const message = error instanceof Error ? error.message : "Unable to start the table session.";
    throw new TableSessionError(
      "SERVICE_UNAVAILABLE",
      /timed out/i.test(message)
        ? "الاتصال بالخادم استغرق وقتًا طويلًا. تحقق من الإنترنت وحاول مرة أخرى."
        : message,
    );
  }
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Table session request timed out")),
      timeoutMs,
    );
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

function isMissingRpc(error: { code?: string; message?: string }) {
  return error.code === "42883" || /function .* does not exist/i.test(error.message ?? "");
}

async function legacyOpenTableSession(supabase: ReturnType<typeof createSupabaseBrowserClient>, tableId: string, cafeId: string, authUserId: string) {
  const active = await supabase.from("table_sessions").select("id").eq("table_id", tableId).in("status", ["open", "ordering", "payment_pending"]).order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (active.error) throw active.error;
  let sessionId = active.data?.id;
  let outcome = sessionId ? "joined" : "created";
  if (!sessionId) {
    const created = await supabase.from("table_sessions").insert({ table_id: tableId }).select("id").single();
    if (created.error) {
      const retry = await supabase.from("table_sessions").select("id").eq("table_id", tableId).in("status", ["open", "ordering", "payment_pending"]).order("opened_at", { ascending: false }).limit(1).single();
      if (retry.error) throw created.error;
      sessionId = retry.data.id;
      outcome = "joined";
    } else sessionId = created.data.id;
  }
  const guest = await supabase.from("table_guests").upsert({ session_id: sessionId, auth_user_id: authUserId }, { onConflict: "session_id,auth_user_id" }).select("id").single();
  if (guest.error) throw guest.error;
  return { session_id: sessionId, guest_id: guest.data.id, cafe_id: cafeId, outcome };
}
