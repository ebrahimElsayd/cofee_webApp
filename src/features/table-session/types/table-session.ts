export type TableSessionResolution = {
  tableId: number;
  cafeId: string;
  sessionId: string;
  guestId?: string;
  outcome: "created" | "joined";
};

export type TableSessionErrorCode = "INVALID_TABLE" | "AMBIGUOUS_TABLE" | "MISSING_CAFE_SCOPE" | "SERVICE_UNAVAILABLE";

export class TableSessionError extends Error {
  constructor(
    public readonly code: TableSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TableSessionError";
  }
}
