export type AppErrorCode =
  | "INVALID_REQUEST"
  | "TARGET_NOT_FOUND"
  | "NEEDS_USER_CLARIFICATION"
  | "COLUMN_NOT_FOUND"
  | "DATAHUB_UNAVAILABLE"
  | "MCP_UNAVAILABLE"
  | "ARTIFACT_WRITE_FAILED";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}
