const ACTIVE_SESSION_KEY = "kings-cafe:active-table-session";

type ActiveResolution = { tableId: number; sessionId: string };

function getActiveResolution(tableId: number): ActiveResolution | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_SESSION_KEY) || "null") as Partial<ActiveResolution> | null;
    return parsed?.tableId === tableId && typeof parsed.sessionId === "string" && parsed.sessionId
      ? { tableId, sessionId: parsed.sessionId }
      : null;
  } catch {
    return null;
  }
}

function getStorageKey(tableId: number): string | null {
  const active = getActiveResolution(tableId);
  return active ? `kings-cafe:table:${tableId}:session:${active.sessionId}:recipient-names` : null;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function readNames(tableId: number): string[] {
  const key = getStorageKey(tableId);
  if (!key) return [];
  try {
    const legacyKey = `kings-cafe:table:${tableId}:recipient-names`;
    const stored = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey) ?? "[]";
    const parsed: unknown = JSON.parse(stored);
    const names = Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
      : [];
    if (!window.localStorage.getItem(key) && names.length) window.localStorage.setItem(key, JSON.stringify(names));
    return names;
  } catch {
    return [];
  }
}

/** Names are per-device/session suggestions; order_items remain the source of truth. */
export async function getRecipientNames(tableId: number): Promise<string[]> {
  return readNames(tableId);
}

export async function saveRecipientName(tableId: number, value: string): Promise<string[]> {
  const key = getStorageKey(tableId);
  const name = normalizeName(value);
  if (!key || !name) return readNames(tableId);

  const currentNames = readNames(tableId);
  const exists = currentNames.some((item) => item.toLocaleLowerCase("ar") === name.toLocaleLowerCase("ar"));
  const nextNames = exists ? currentNames : [...currentNames, name];
  window.localStorage.setItem(key, JSON.stringify(nextNames));
  return nextNames;
}
