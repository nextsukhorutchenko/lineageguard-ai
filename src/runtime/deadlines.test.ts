import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeadline, createRequestAbortScope } from "./deadlines.js";

afterEach(() => vi.useRealTimers());

describe("createDeadline", () => {
  it("preserves browser cancellation as CANCELLED", async () => {
    const browser = new AbortController();
    const request = createRequestAbortScope(browser.signal);
    const deadline = createDeadline(request, 1_000, "DATAHUB_ANALYSIS_TIMEOUT");
    const aborted = new Promise((_, reject) => {
      deadline.signal.addEventListener("abort", () => reject(deadline.classifyAbort().error), {
        once: true,
      });
    });

    browser.abort(new DOMException("Cancelled", "AbortError"));

    await expect(aborted).rejects.toMatchObject({ code: "CANCELLED" });
    deadline.dispose();
  });

  it("classifies its own expiry without exposing the DOMException", async () => {
    vi.useFakeTimers();
    const request = createRequestAbortScope(new AbortController().signal);
    const deadline = createDeadline(request, 1, "DATAHUB_ANALYSIS_TIMEOUT");
    const aborted = new Promise((resolve) =>
      deadline.signal.addEventListener("abort", resolve, { once: true }),
    );

    await vi.advanceTimersByTimeAsync(1);
    await aborted;

    expect(deadline.classifyAbort()).toMatchObject({
      owner: "DATAHUB_ANALYSIS_TIMEOUT",
      error: {
        code: "DATAHUB_UNAVAILABLE",
        message: "DataHub analysis exceeded its deadline.",
      },
    });
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves an upstream agent deadline through a nested generation deadline", async () => {
    vi.useFakeTimers();
    const request = createRequestAbortScope(new AbortController().signal);
    const agent = createDeadline(request, 90_000, "AGENT_TIMEOUT");
    await vi.advanceTimersByTimeAsync(70_000);
    const generation = createDeadline(agent, 30_000, "GENERATION_TIMEOUT");

    await vi.advanceTimersByTimeAsync(20_000);

    expect(generation.classifyAbort()).toMatchObject({
      owner: "AGENT_TIMEOUT",
      error: { code: "GENERATION_FAILED" },
    });
    generation.dispose();
    agent.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects non-positive and non-integral durations", () => {
    const request = createRequestAbortScope(new AbortController().signal);

    for (const duration of [0, -1, 1.5, Number.NaN]) {
      expect(() => createDeadline(request, duration, "WORKFLOW_TIMEOUT")).toThrow(RangeError);
    }
  });
});
