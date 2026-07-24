import { access, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRunArtifact, writeRunArtifact } from "./write-run-artifacts.js";

async function createFreshRunsRoot(): Promise<{
  readonly sandbox: string;
  readonly runsRoot: string;
}> {
  const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-artifacts-"));
  const runsRoot = await mkdtemp(join(sandbox, "runs-"));
  return { sandbox, runsRoot };
}

describe("writeRunArtifact", () => {
  it("writes every allowlisted run-level diagnostic artifact", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    try {
      for (const filename of [
        "impact-report.md",
        "change-context.json",
        "migration-package-draft.json",
        "validation-findings.json",
        "run-metadata.json",
      ] as const) {
        await expect(
          writeRunArtifact({ runsRoot, runId: `run-${filename}`, filename, content: "safe" }),
        ).resolves.toContain(filename);
      }
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects filenames outside the fixed allowlist", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    try {
      await expect(
        writeRunArtifact({
          runsRoot,
          runId: "run-1",
          filename: "../../secret.txt" as never,
          content: "unsafe",
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("reads only a real allowlisted file beneath the run root", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    try {
      await writeRunArtifact({
        runsRoot,
        runId: "run-1",
        filename: "impact-report.md",
        content: "# Sanitized impact report\n",
      });
      await expect(
        readRunArtifact({ runsRoot, runId: "run-1", filename: "impact-report.md" }),
      ).resolves.toBe("# Sanitized impact report\n");
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("does not create an artifact when its signal is already aborted", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(
        writeRunArtifact({
          runsRoot,
          runId: "run-aborted",
          filename: "impact-report.md",
          content: "# Impact report\n",
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      await expect(access(join(runsRoot, "run-aborted", "impact-report.md"))).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

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

  it("rejects an existing run-directory symlink that points outside the runs root", async () => {
    const { sandbox, runsRoot } = await createFreshRunsRoot();
    const outside = join(sandbox, "outside");
    const linkedRun = join(runsRoot, "run-link");
    const escapedOutput = join(outside, "impact-report.md");

    try {
      await mkdir(outside);
      await symlink(outside, linkedRun, process.platform === "win32" ? "junction" : "dir");

      await expect(
        writeRunArtifact({
          runsRoot,
          runId: "run-link",
          filename: "impact-report.md",
          content: "# Impact report\n",
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      await expect(access(escapedOutput)).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a configured runs-root junction that points elsewhere", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-artifacts-root-link-"));
    const outside = join(sandbox, "outside");
    const linkedRoot = join(sandbox, "linked-runs");
    const escapedOutput = join(outside, "run-001", "impact-report.md");

    try {
      await mkdir(outside);
      await symlink(outside, linkedRoot, process.platform === "win32" ? "junction" : "dir");

      await expect(
        writeRunArtifact({
          runsRoot: linkedRoot,
          runId: "run-001",
          filename: "impact-report.md",
          content: "# Impact report\n",
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      await expect(access(escapedOutput)).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a linked ancestor of a not-yet-created runs root", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-artifacts-parent-link-"));
    const outside = join(sandbox, "outside");
    const linkedParent = join(sandbox, "linked-parent");
    const linkedRoot = join(linkedParent, "runs");
    const escapedOutput = join(outside, "runs", "run-001", "impact-report.md");

    try {
      await mkdir(outside);
      await symlink(outside, linkedParent, process.platform === "win32" ? "junction" : "dir");

      await expect(
        writeRunArtifact({
          runsRoot: linkedRoot,
          runId: "run-001",
          filename: "impact-report.md",
          content: "# Impact report\n",
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      await expect(access(escapedOutput)).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it.each([
    "../outside",
    "..\\outside",
    "C:\\outside",
    "/outside",
    "run-001/../../outside",
    "run-001/../run-002",
    "run-001\\..\\run-002",
    "run-001/child",
    "run-001\\child",
  ])("rejects unsafe run ID %s with ARTIFACT_WRITE_FAILED", async (runId) => {
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
  });
});
