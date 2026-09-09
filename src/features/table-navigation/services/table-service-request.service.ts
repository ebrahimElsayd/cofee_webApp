import { createSupabaseBrowserClient } from "@/shared/lib/supabase/browser";
import { getActiveTableSessionId } from "./supabase-order-tracking.service";

export async function requestTableService(type: "waiter" | "tissues" | "water" | "bill", note?: string) {
  const sessionId = getActiveTableSessionId();
  if (!sessionId) throw new Error("No active table session");
  const supabase = createSupabaseBrowserClient();
  if (type === "bill") {
    const result = await supabase.rpc("request_table_bill", { p_session_id: sessionId });
    if (result.error) throw result.error;
    return result.data as string;
  }
  const result = await supabase.from("service_requests").insert({ session_id: sessionId, type, note: note ?? null }).select("id").single();
  if (result.error) throw result.error;
  return result.data.id;
}
