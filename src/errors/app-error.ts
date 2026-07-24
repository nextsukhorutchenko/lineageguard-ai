export type AppErrorCode =
  | "INVALID_REQUEST"
  | "TARGET_NOT_FOUND"
  | "NEEDS_USER_CLARIFICATION"
  | "COLUMN_NOT_FOUND"
  | "DATAHUB_UNAVAILABLE"
  | "MCP_UNAVAILABLE"
  | "ARTIFACT_WRITE_FAILED"
  | "CANCELLED";

export interface SuppressedFailure {
  readonly code: AppErrorCode;
  readonly message: string;
}

export class AppError extends Error {
  readonly #suppressedFailures: SuppressedFailure[] = [];

  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AppError";
  }

  get suppressedFailures(): readonly SuppressedFailure[] {
    return this.#suppressedFailures;
  }

  addSuppressedFailure(failure: SuppressedFailure): void {
    this.#suppressedFailures.push(Object.freeze({ ...failure }));
  }
}
