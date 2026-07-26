import { describe, expect, it, vi } from "vitest";
import { prepareImpactContext } from "./change-context.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

describe("PR impact Git context", () => {
  it("collects and maps a bounded NUL-delimited pull-request comparison", async () => {
    const executeGit = vi.fn(async () => Buffer.from("app/page.tsx\0src/ui/client.tsx\0"));

    const result = await prepareImpactContext({
      cwd: process.cwd(),
      eventName: "pull_request",
      baseSha,
      headSha,
      executeGit,
    });

    expect(executeGit).toHaveBeenCalledExactlyOnceWith(process.cwd(), baseSha, headSha);
    expect(result).toMatchObject({
      schemaVersion: "1",
      source: "PULL_REQUEST",
      disposition: "MAPPED",
      changedPaths: ["app/page.tsx", "src/ui/client.tsx"],
    });
  });

  it("does not invoke Git for non-pull-request events", async () => {
    const executeGit = vi.fn();
    const result = await prepareImpactContext({
      cwd: process.cwd(),
      eventName: "push",
      baseSha,
      headSha,
      executeGit,
    });

    expect(executeGit).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "IMPACT_CONTEXT_UNAVAILABLE",
      disposition: "FULL_SUITE_REQUIRED",
      reasonCodes: ["NON_PULL_REQUEST"],
    });
  });

  it.each([
    ["short", headSha],
    [baseSha.toUpperCase(), headSha],
    [baseSha, undefined],
  ])("fails closed for invalid refs", async (base, head) => {
    const executeGit = vi.fn();
    const result = await prepareImpactContext({
      cwd: process.cwd(),
      eventName: "pull_request",
      baseSha: base,
      headSha: head,
      executeGit,
    });

    expect(executeGit).not.toHaveBeenCalled();
    expect(result.reasonCodes).toEqual(["GIT_COMPARISON_UNAVAILABLE"]);
  });

  it.each([Buffer.from("app/page.tsx"), Buffer.from([0xff, 0]), Buffer.alloc(262_145, 97)])(
    "fails closed for invalid Git output",
    async (output) => {
      const result = await prepareImpactContext({
        cwd: process.cwd(),
        eventName: "pull_request",
        baseSha,
        headSha,
        executeGit: async () => output,
      });

      expect(result.disposition).toBe("FULL_SUITE_REQUIRED");
      expect(result.reasonCodes).toEqual(["GIT_COMPARISON_UNAVAILABLE"]);
      expect(JSON.stringify(result)).not.toContain(process.cwd());
    },
  );

  it("replaces Git failures with a fixed reason", async () => {
    const result = await prepareImpactContext({
      cwd: process.cwd(),
      eventName: "pull_request",
      baseSha,
      headSha,
      executeGit: async () => {
        throw new Error("private native path");
      },
    });

    expect(result.reasonCodes).toEqual(["GIT_COMPARISON_UNAVAILABLE"]);
    expect(JSON.stringify(result)).not.toContain("private native path");
  });
});
