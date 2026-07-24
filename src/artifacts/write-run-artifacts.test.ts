import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowSnapshotSchema } from "../workflow/contracts.js";
import { persistFailedRun } from "../runs/run-store.js";
import { readImpactReport, writeRunArtifact } from "./write-run-artifacts.js";

async function createFreshRunsRoot(): Promise<{
  readonly sandbox: string;
  readonly runsRoot: string;
}> {
  const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-artifacts-"));
  const runsRoot = await mkdtemp(join(sandbox, "recognizable-private-runs-root-"));
  return { sandbox, runsRoot };
}

describe("impact report compatibility", () => {
  it.each([
    "COMPLETED",
    "COMPLETED_WITH_LIMITATIONS",
    "INSUFFICIENT_METADATA",
    "INCOMPLETE_EVIDENCE",
  ] as const)(
    "publishes %s as one strict flat envelope behind a virtual filename",
    async (status) => {
      const { sandbox, runsRoot } = await createFreshRunsRoot();
      const report = `# Sanitized ${status} impact report\n`;

      try {
        await expect(
          writeRunArtifact({
            runsRoot,
            runId: `run-${status.toLowerCase()}`,
            filename: "impact-report.md",
            content: report,
            status,
          }),
        ).resolves.toBe("impact-report.md");

        const runId = `run-${status.toLowerCase()}`;
        expect(await readdir(runsRoot)).toEqual([`run-${runId}.json`]);
        await expect(readImpactReport({ runsRoot, runId })).resolves.toBe(report);

        const stored = await readFile(join(runsRoot, `run-${runId}.json`), "utf8");
        expect(JSON.parse(stored)).toMatchObject({
          schemaVersion: "1",
          kind: "impact-report",
          runId,
          status,
          report,
        });
        expect(stored).not.toContain(runsRoot);
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it("returns a fixed typed cancellation without persisting the root or custom abort reason", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    const controller = new AbortController();
    const secretAbortReason = "secret-bearing-custom-abort-reason";
    controller.abort(new Error(secretAbortReason));

    try {
      const caught = await writeRunArtifact({
        runsRoot,
        runId: "run-aborted",
        filename: "impact-report.md",
        content: "# Impact report\n",
        status: "COMPLETED",
        signal: controller.signal,
      }).catch((error: unknown) => error);

      expect(caught).toMatchObject({
        code: "CANCELLED",
        message: "The run was cancelled.",
      });
      expect(JSON.stringify(caught)).not.toContain(runsRoot);
      expect(JSON.stringify(caught)).not.toContain(secretAbortReason);
      await expect(access(join(runsRoot, "run-run-aborted.json"))).rejects.toThrow();
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("does not interpret another strict terminal envelope as an impact report", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    const runId = "failed-run";
    const snapshot = WorkflowSnapshotSchema.parse({
      runId,
      mode: "REPLAY",
      status: "GENERATION_FAILED",
      activity: [],
      evidence: [],
      facts: [],
      assumptions: [],
      unknowns: [],
      validation: { outcome: "NOT_RUN", findingCount: 0, findingCodes: [] },
      artifacts: [],
      failure: { code: "GENERATION_FAILED", message: "Generation failed." },
    });

    try {
      await persistFailedRun({ runsRoot, runId, snapshot, secrets: [] });

      await expect(readImpactReport({ runsRoot, runId })).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored impact report is unavailable.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
