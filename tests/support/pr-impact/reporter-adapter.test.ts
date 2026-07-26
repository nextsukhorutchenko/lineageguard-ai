import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { PrImpactReporter } from "../../e2e/reporters/pr-impact-reporter.js";

describe("PR impact reporter adapter", () => {
  it("never overrides the Playwright status when publication fails", async () => {
    const publish = vi.fn(async () => {
      throw new Error("untrusted publication detail");
    });
    const reporter = new PrImpactReporter({
      cwd: await mkdtemp(join(tmpdir(), "lineageguard-reporter-")),
      publish,
    });

    const result = await reporter.onEnd({ status: "failed" } as never);

    expect(result).toBeUndefined();
    expect(publish).toHaveBeenCalledOnce();
    expect(reporter.printsToStdio()).toBe(false);
  });
});
