export type TableSessionResolution = {
  tableId: number;
  sessionId: string;
  outcome: "created" | "joined";
};

export type TableSessionErrorCode = "INVALID_TABLE" | "SERVICE_UNAVAILABLE";

export class TableSessionError extends Error {
  constructor(
    public readonly code: TableSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TableSessionError";
  }
}
