import { createSupabaseBrowserClient } from "@/shared/lib/supabase/browser";
import { getActiveTableSessionId } from "./supabase-order-tracking.service";

export async function requestTableService(type: "waiter" | "tissues" | "water" | "bill", note?: string) {
  const sessionId = getActiveTableSessionId();
  if (!sessionId) throw new Error("No active table session");
  const supabase = createSupabaseBrowserClient();
  if (type === "bill") {
    const existing = await supabase.from("service_requests")
      .select("id")
      .eq("session_id", sessionId)
      .eq("type", "bill")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) return existing.data.id;
  }
  const result = await supabase.from("service_requests").insert({ session_id: sessionId, type, note: note ?? null }).select("id").single();
  if (result.error) {
    // A concurrent retry can win the unique bill-request index between the
    // lookup and insert. Return that row to keep the operation idempotent.
    if (type === "bill" && result.error.code === "23505") {
      const concurrent = await supabase.from("service_requests")
        .select("id")
        .eq("session_id", sessionId)
        .eq("type", "bill")
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!concurrent.error && concurrent.data?.id) return concurrent.data.id;
    }
    throw result.error;
  }
  return result.data.id;
}
