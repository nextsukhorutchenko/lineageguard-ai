import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_VIRTUAL_ARTIFACT_BYTES } from "../runs/run-envelope.js";
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
  async function expectRejectedBeforePublication(
    overrides: Partial<Parameters<typeof writeRunArtifact>[0]>,
    forbiddenValue: string,
  ): Promise<void> {
    const { sandbox, runsRoot } = await createFreshRunsRoot();

    try {
      const caught = await writeRunArtifact({
        runsRoot,
        runId: "safe-run",
        filename: "impact-report.md",
        content: "# Impact report\n",
        status: "COMPLETED",
        ...overrides,
      }).catch((error: unknown) => error);

      expect(caught).toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
        details: {},
      });
      expect(caught).not.toHaveProperty("issues");
      expect(JSON.stringify(caught)).not.toContain(runsRoot);
      expect(JSON.stringify(caught)).not.toContain(forbiddenValue);
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }

  it("rejects a runtime path-like filename before filesystem publication", async () => {
    const unsafeFilename = "../../outside.md";

    await expectRejectedBeforePublication(
      {
        filename: unsafeFilename as unknown as "impact-report.md",
      },
      unsafeFilename,
    );
  });

  it.each([
    {
      name: "unsafe run ID",
      overrides: { runId: "../outside" },
      forbiddenValue: "../outside",
    },
    {
      name: "unknown status",
      overrides: {
        status: "UNSAFE_STATUS" as unknown as "COMPLETED",
      },
      forbiddenValue: "UNSAFE_STATUS",
    },
    {
      name: "maximum-plus-one content",
      overrides: {
        content: "x".repeat(MAX_VIRTUAL_ARTIFACT_BYTES + 1),
      },
      forbiddenValue: "x".repeat(512),
    },
    {
      name: "credential-shaped content",
      overrides: {
        content: "# Report\nsk-proj-1234567890abcdefghijkl\n",
      },
      forbiddenValue: "sk-proj-1234567890abcdefghijkl",
    },
    {
      name: "control-bearing content",
      overrides: {
        content: "# Report\u001b[2J\n",
      },
      forbiddenValue: "\u001b[2J",
    },
    {
      name: "non-normalized content",
      overrides: {
        content: "# Cafe\u0301\n",
      },
      forbiddenValue: "Cafe\u0301",
    },
  ])("rejects $name before filesystem publication", async ({ overrides, forbiddenValue }) => {
    await expectRejectedBeforePublication(overrides, forbiddenValue);
  });

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
        details: {},
      });
      expect(JSON.stringify(caught)).not.toContain(runsRoot);
      expect(JSON.stringify(caught)).not.toContain(secretAbortReason);
      await expect(access(join(runsRoot, "run-run-aborted.json"))).rejects.toThrow();
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("preserves the lower create-only collision error", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    const input = {
      runsRoot,
      runId: "existing-run",
      filename: "impact-report.md",
      content: "# Impact report\n",
      status: "COMPLETED",
    } as const;

    try {
      await writeRunArtifact(input);

      await expect(writeRunArtifact(input)).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The run already exists.",
        details: {},
      });
      expect(await readdir(runsRoot)).toEqual(["run-existing-run.json"]);
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
