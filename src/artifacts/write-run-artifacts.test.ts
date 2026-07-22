import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeRunArtifact } from "./write-run-artifacts.js";

async function createFreshRunsRoot(): Promise<{
  readonly sandbox: string;
  readonly runsRoot: string;
}> {
  const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-artifacts-"));
  const runsRoot = await mkdtemp(join(sandbox, "runs-"));
  return { sandbox, runsRoot };
}

describe("writeRunArtifact", () => {
  it("writes impact-report.md beneath the configured runs directory", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();

    try {
      const output = await writeRunArtifact({
        runsRoot,
        runId: "run-001",
        filename: "impact-report.md",
        content: "# Impact report\n",
      });

      expect(output).toBe(join(runsRoot, "run-001", "impact-report.md"));
      await expect(readFile(output, "utf8")).resolves.toBe("# Impact report\n");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it.each(["../outside", "..\\outside", "C:\\outside", "/outside", "run-001/../../outside"])(
    "rejects unsafe run ID %s with ARTIFACT_WRITE_FAILED",
    async (runId) => {
      const { sandbox, runsRoot } = await createFreshRunsRoot();

      try {
        await expect(
          writeRunArtifact({
            runsRoot,
            runId,
            filename: "impact-report.md",
            content: "# Impact report\n",
          }),
        ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );
});
