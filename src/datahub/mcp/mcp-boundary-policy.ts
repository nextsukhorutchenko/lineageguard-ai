import { AppError } from "../../errors/app-error.js";

export const DATAHUB_MCP_BOUNDARY_POLICY = Object.freeze({
  toolCallMs: 15_000,
  closeMs: 5_000,
  maxToolResultBytes: 1_048_576,
  maxJsonDepth: 64,
  maxJsonNodes: 100_000,
} as const);

export interface OwnedMcpToolCallOptions {
  readonly signal: AbortSignal;
  readonly timeout: number;
  readonly maxTotalTimeout: number;
}

const toolUnavailable = (): AppError =>
  new AppError("DATAHUB_UNAVAILABLE", "DataHub is unavailable through the MCP adapter.");

const closeUnavailable = (): AppError =>
  new AppError("MCP_UNAVAILABLE", "The DataHub MCP client could not be closed.");

export async function runWithMcpToolDeadline<T>(
  callerSignal: AbortSignal | undefined,
  invoke: (options: OwnedMcpToolCallOptions) => Promise<T>,
): Promise<T> {
  callerSignal?.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onCallerAbort = (): void => {
      if (finished || callerSignal === undefined) return;

      let classified: unknown;
      try {
        callerSignal.throwIfAborted();
        return;
      } catch (error) {
        classified = error;
      }

      if (!finish(() => reject(classified))) return;
      controller.abort();
    };

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };

    const finish = (settle: () => void): boolean => {
      if (finished) return false;
      finished = true;
      cleanup();
      settle();
      return true;
    };

    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    timer = setTimeout(() => {
      if (!finish(() => reject(toolUnavailable()))) return;
      controller.abort();
    }, DATAHUB_MCP_BOUNDARY_POLICY.toolCallMs);
    timer.unref();

    if (callerSignal?.aborted) {
      onCallerAbort();
      return;
    }

    let pending: Promise<T>;
    try {
      pending = invoke({
        signal: controller.signal,
        timeout: DATAHUB_MCP_BOUNDARY_POLICY.toolCallMs,
        maxTotalTimeout: DATAHUB_MCP_BOUNDARY_POLICY.toolCallMs,
      });
    } catch {
      finish(() => reject(toolUnavailable()));
      return;
    }

    void pending.then(
      (value) => {
        finish(() => resolve(value));
      },
      () => {
        finish(() => reject(toolUnavailable()));
      },
    );
  });
}

export function createBoundedMcpClose(close: () => Promise<void>): () => Promise<void> {
  let settlement: Promise<void> | undefined;

  return (): Promise<void> => {
    settlement ??= new Promise<void>((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => {
        finish(() => reject(closeUnavailable()));
      }, DATAHUB_MCP_BOUNDARY_POLICY.closeMs);
      timer.unref();

      const finish = (settle: () => void): boolean => {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        settle();
        return true;
      };

      let pending: Promise<void>;
      try {
        pending = close();
      } catch {
        finish(() => reject(closeUnavailable()));
        return;
      }

      void pending.then(
        () => {
          finish(resolve);
        },
        () => {
          finish(() => reject(closeUnavailable()));
        },
      );
    });

    return settlement;
  };
}
