import { createSupabaseBrowserClient } from "@/shared/lib/supabase/browser";
import { getActiveTableSessionId } from "./supabase-order-tracking.service";

const inFlightRequests = new Map<string, Promise<string>>();

export async function requestTableService(type: "waiter" | "tissues" | "water" | "bill", note?: string, tableId?: number) {
  const sessionId = getActiveTableSessionId(tableId);
  if (!sessionId) throw new Error("No active table session");
  const requestKey = `${sessionId}:${type}:${note ?? ""}`;
  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = requestTableServiceOnce(sessionId, type, note);
  inFlightRequests.set(requestKey, request);
  void request.finally(() => {
    if (inFlightRequests.get(requestKey) === request) inFlightRequests.delete(requestKey);
  }).catch(() => undefined);
  return request;
}

async function requestTableServiceOnce(sessionId: string, type: "waiter" | "tissues" | "water" | "bill", note?: string) {
  const supabase = createSupabaseBrowserClient();
  if (type === "bill") {
    const result = await supabase.rpc("request_table_bill", { p_session_id: sessionId });
    if (result.error) throw result.error;
    return result.data as string;
  }
  const result = await supabase.rpc("request_table_service", {
    p_session_id: sessionId,
    p_type: type,
    p_note: note ?? null,
  });
  if (result.error) throw result.error;
  return result.data as string;
}
