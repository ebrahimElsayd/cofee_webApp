import {
  TableSessionError,
  type TableSessionResolution,
} from "../types/table-session";

const activeSessions = new Map<number, string>();

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
): Promise<TableSessionResolution> {
  const tableId = parseTableId(rawTableId);

  // Keeps the async boundary that the future backend implementation will use.
  await new Promise((resolve) => setTimeout(resolve, 700));

  const existingSessionId = activeSessions.get(tableId);

  if (existingSessionId) {
    return { tableId, sessionId: existingSessionId, outcome: "joined" };
  }

  const sessionId = `local-table-${tableId}-${Date.now()}`;
  activeSessions.set(tableId, sessionId);

  return { tableId, sessionId, outcome: "created" };
}
