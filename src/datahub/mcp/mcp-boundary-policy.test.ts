import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../errors/app-error.js";
import {
  createBoundedMcpClose,
  DATAHUB_MCP_BOUNDARY_POLICY,
  runWithMcpToolDeadline,
} from "./mcp-boundary-policy.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DATAHUB_MCP_BOUNDARY_POLICY", () => {
  it("publishes only the certified constants", () => {
    expect(DATAHUB_MCP_BOUNDARY_POLICY).toEqual({
      toolCallMs: 15_000,
      closeMs: 5_000,
      maxToolResultBytes: 1_048_576,
      maxJsonDepth: 64,
      maxJsonNodes: 100_000,
    });
    expect(Object.isFrozen(DATAHUB_MCP_BOUNDARY_POLICY)).toBe(true);
  });
});

describe("runWithMcpToolDeadline", () => {
  it("owns a fifteen-second await and passes explicit SDK limits", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    let received:
      | {
          readonly signal: AbortSignal;
          readonly timeout: number;
          readonly maxTotalTimeout: number;
        }
      | undefined;
    const operation = runWithMcpToolDeadline(caller.signal, async (options) => {
      received = options;
      return new Promise<never>(() => undefined);
    });
    const rejected = expect(operation).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
      message: "DataHub is unavailable through the MCP adapter.",
      details: {},
    });

    expect(received).toMatchObject({ timeout: 15_000, maxTotalTimeout: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(received?.signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes its timer and caller listener after success", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");

    await expect(runWithMcpToolDeadline(caller.signal, async () => "ok")).resolves.toBe("ok");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the exact caller classification and disposes its listener", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const classified = new AppError("DATAHUB_UNAVAILABLE", "Parent scope owns cancellation.");
    const operation = runWithMcpToolDeadline(caller.signal, async () => {
      return new Promise<never>(() => undefined);
    });

    caller.abort(classified);

    await expect(operation).rejects.toBe(classified);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses registration order for deterministic same-turn first-winner behavior", async () => {
    vi.useFakeTimers();
    const callerWins = new AbortController();
    const classified = new AppError("DATAHUB_UNAVAILABLE", "Caller won.");
    setTimeout(() => callerWins.abort(classified), 15_000);
    const first = runWithMcpToolDeadline(callerWins.signal, async () => {
      return new Promise<never>(() => undefined);
    });
    const firstRejected = expect(first).rejects.toBe(classified);
    await vi.advanceTimersByTimeAsync(15_000);
    await firstRejected;
    expect(vi.getTimerCount()).toBe(0);

    const deadlineWins = new AbortController();
    const second = runWithMcpToolDeadline(deadlineWins.signal, async () => {
      return new Promise<never>(() => undefined);
    });
    setTimeout(() => deadlineWins.abort(classified), 15_000);
    const secondRejected = expect(second).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
      message: "DataHub is unavailable through the MCP adapter.",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await secondRejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sanitizes dependency rejection and disposes its boundary", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const deferred = Promise.withResolvers<string>();
    const operation = runWithMcpToolDeadline(caller.signal, async () => deferred.promise);
    deferred.reject(new Error("raw dependency failure with secret-token"));

    const error = await operation.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
    expect(JSON.stringify(error)).not.toContain("raw dependency failure");
    expect(JSON.stringify(error)).not.toContain("secret-token");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createBoundedMcpClose", () => {
  it("publishes its cached settlement before synchronously invoking close", async () => {
    let nested: Promise<void> | undefined;
    let closeCount = 0;
    const close: () => Promise<void> = createBoundedMcpClose(async () => {
      closeCount += 1;
      if (closeCount === 1) nested = close();
    });

    const first = close();

    expect(nested).toBe(first);
    expect(closeCount).toBe(1);
    await expect(first).resolves.toBeUndefined();
  });

  it("returns one cached settlement and closes once", async () => {
    const deferred = Promise.withResolvers<void>();
    let closeCount = 0;
    const close = createBoundedMcpClose(async () => {
      closeCount += 1;
      return deferred.promise;
    });

    const first = close();
    const second = close();

    expect(first).toBe(second);
    expect(closeCount).toBe(1);
    deferred.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(close()).resolves.toBeUndefined();
    expect(closeCount).toBe(1);
  });

  it("bounds a dependency that ignores cleanup and ignores late settlement", async () => {
    vi.useFakeTimers();
    const deferred = Promise.withResolvers<void>();
    let closeCount = 0;
    const close = createBoundedMcpClose(async () => {
      closeCount += 1;
      return deferred.promise;
    });
    const operation = close();
    const rejected = expect(operation).rejects.toMatchObject({
      code: "MCP_UNAVAILABLE",
      message: "The DataHub MCP client could not be closed.",
      details: {},
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    deferred.resolve();
    await Promise.resolve();
    expect(close()).toBe(operation);
    expect(closeCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sanitizes close rejection", async () => {
    const close = createBoundedMcpClose(async () => {
      throw new Error("raw close failure with secret-token");
    });

    const error = await close().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "MCP_UNAVAILABLE", details: {} });
    expect(JSON.stringify(error)).not.toContain("raw close failure");
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });
});
