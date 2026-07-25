import { AppError } from "../errors/app-error.js";

export const DEADLINES_MS = Object.freeze({
  mcpConnect: 15_000,
  datahubAnalysis: 55_000,
  analysisTool: 60_000,
  generationTool: 30_000,
  agent: 90_000,
  workflow: 95_000,
});

export type DeadlineKind =
  | "MCP_CONNECT_TIMEOUT"
  | "DATAHUB_ANALYSIS_TIMEOUT"
  | "GENERATION_TIMEOUT"
  | "AGENT_TIMEOUT"
  | "WORKFLOW_TIMEOUT";

export type AbortOwner = "REQUEST_CANCELLED" | DeadlineKind;

export interface AbortClassification {
  readonly owner: AbortOwner;
  readonly error: AppError;
}

export interface ClassifiedAbortScope {
  readonly signal: AbortSignal;
  classifyAbort(): AbortClassification;
  dispose(): void;
}

const timeoutFailure = (kind: DeadlineKind): AppError => {
  switch (kind) {
    case "MCP_CONNECT_TIMEOUT":
      return new AppError("MCP_UNAVAILABLE", "The DataHub MCP connection exceeded its deadline.");
    case "DATAHUB_ANALYSIS_TIMEOUT":
      return new AppError("DATAHUB_UNAVAILABLE", "DataHub analysis exceeded its deadline.");
    case "GENERATION_TIMEOUT":
    case "AGENT_TIMEOUT":
      return new AppError("GENERATION_FAILED", "Migration generation exceeded its deadline.");
    case "WORKFLOW_TIMEOUT":
      return new AppError("CANCELLED", "The workflow deadline was exceeded.");
  }
};

export function createRequestAbortScope(signal: AbortSignal): ClassifiedAbortScope {
  return {
    signal,
    classifyAbort(): AbortClassification {
      if (!signal.aborted) throw new Error("The request scope has not aborted.");
      return {
        owner: "REQUEST_CANCELLED",
        error: new AppError("CANCELLED", "The workflow was cancelled."),
      };
    },
    dispose() {},
  };
}

export function createDeadline(
  parent: ClassifiedAbortScope,
  milliseconds: number,
  kind: DeadlineKind,
): ClassifiedAbortScope {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new RangeError("Deadline must be a positive integer number of milliseconds.");
  }
  const controller = new AbortController();
  let winner: "parent" | "own" | undefined;
  const abortFrom = (source: "parent" | "own") => {
    if (winner !== undefined) return;
    winner = source;
    controller.abort();
  };
  const onParent = () => abortFrom("parent");
  const onOwn = () => abortFrom("own");
  parent.signal.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(onOwn, milliseconds);
  timer.unref();
  if (parent.signal.aborted) onParent();
  return {
    signal: controller.signal,
    classifyAbort(): AbortClassification {
      if (!controller.signal.aborted || winner === undefined) {
        throw new Error("The deadline scope has not aborted.");
      }
      return winner === "parent"
        ? parent.classifyAbort()
        : { owner: kind, error: timeoutFailure(kind) };
    },
    dispose() {
      clearTimeout(timer);
      parent.signal.removeEventListener("abort", onParent);
    },
  } as const;
}
