import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { appendImpactSummary } from "./summary.js";

const createWorkspace = async (): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "lineageguard-summary-"));
  await mkdir(join(cwd, "test-results", "pr-impact"), { recursive: true });
  return cwd;
};

describe("PR impact job summary", () => {
  it("skips non-pull-request events and missing reports", async () => {
    const cwd = await createWorkspace();
    const summary = join(cwd, "summary.md");
    await writeFile(summary, "existing\n");

    await expect(
      appendImpactSummary({ cwd, eventName: "push", summaryPath: summary }),
    ).resolves.toBe("SKIPPED");
    await expect(
      appendImpactSummary({
        cwd: await mkdtemp(join(tmpdir(), "lineageguard-summary-")),
        eventName: "pull_request",
        summaryPath: summary,
      }),
    ).resolves.toBe("SKIPPED");
    expect(await readFile(summary, "utf8")).toBe("existing\n");
  });

  it("requires an absolute summary target", async () => {
    const cwd = await createWorkspace();
    await writeFile(join(cwd, "test-results", "pr-impact", "report.md"), "# Impact\n");
    expect(isAbsolute("summary.md")).toBe(false);

    await expect(
      appendImpactSummary({
        cwd,
        eventName: "pull_request",
        summaryPath: "summary.md",
      }),
    ).rejects.toThrow("PR impact summary is unavailable.");
  });

  it("rejects reports over 32 KiB", async () => {
    const cwd = await createWorkspace();
    await writeFile(
      join(cwd, "test-results", "pr-impact", "report.md"),
      "a".repeat(32 * 1_024 + 1),
    );

    await expect(
      appendImpactSummary({
        cwd,
        eventName: "pull_request",
        summaryPath: join(cwd, "summary.md"),
      }),
    ).rejects.toThrow("PR impact summary is unavailable.");
  });

  it("appends a valid report byte-for-byte plus one newline", async () => {
    const cwd = await createWorkspace();
    const report = "# Impact\n\nSafe report.\n";
    const summary = join(cwd, "summary.md");
    await writeFile(join(cwd, "test-results", "pr-impact", "report.md"), report);
    await writeFile(summary, "existing\n");

    await expect(
      appendImpactSummary({ cwd, eventName: "pull_request", summaryPath: summary }),
    ).resolves.toBe("APPENDED");
    expect(await readFile(summary, "utf8")).toBe(`existing\n${report}\n`);
  });
});
