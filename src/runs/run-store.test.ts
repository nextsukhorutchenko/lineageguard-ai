import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCompletedPackageFile, readRunMetadataFile } from "../artifacts/write-run-artifacts.js";
import { renderMigrationPackage } from "../migrations/render-snowflake-package.js";
import { WorkflowSnapshotSchema, type WorkflowSnapshot } from "../workflow/contracts.js";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import {
  loadRegenerationContext,
  loadRunSnapshot,
  persistCompletedRun,
  persistFailedRun,
  reserveGenerationRetry,
} from "./run-store.js";

async function freshRoot(): Promise<{ sandbox: string; runsRoot: string }> {
  const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-run-store-"));
  const runsRoot = await mkdtemp(join(sandbox, "runs-"));
  return { sandbox, runsRoot };
}

const jsonForTest = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function snapshot(
  runId: string,
  status: "COMPLETED" | "GENERATION_FAILED" | "VALIDATION_FAILED",
  contextHash: string,
): WorkflowSnapshot {
  return WorkflowSnapshotSchema.parse({
    runId,
    mode: "REPLAY",
    status,
    contextHash,
    activity: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    validation:
      status === "VALIDATION_FAILED"
        ? { outcome: "REJECTED", findingCount: 1, findingCodes: ["PROHIBITED_SQL"] }
        : {
            outcome: status === "COMPLETED" ? "PASSED" : "NOT_RUN",
            findingCount: 0,
            findingCodes: [],
          },
    artifacts: [],
    ...(status === "COMPLETED"
      ? {}
      : { failure: { code: status, message: "Generation did not complete." } }),
  });
}

describe("run store", () => {
  it("atomically persists and manifest-gates a completed package", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const rendered = renderMigrationPackage(context, draft);
    try {
      const persisted = await persistCompletedRun({
        runsRoot,
        runId: "run-completed",
        context,
        draft,
        rendered,
        snapshot: snapshot("run-completed", "COMPLETED", context.contextHash),
      });

      expect(persisted.status).toBe("COMPLETED");
      const packageDirectory = join(runsRoot, "run-completed", "package");
      expect((await readdir(packageDirectory)).sort()).toEqual(
        [
          "change-context.json",
          "manifest.json",
          "migration-down.sql",
          "migration-package-draft.json",
          "migration-up.sql",
          "rollout-plan.md",
          "run-metadata.json",
          "validation-findings.json",
          "validation.sql",
        ].sort(),
      );
      const metadata = WorkflowSnapshotSchema.parse(
        JSON.parse(await readFile(join(packageDirectory, "run-metadata.json"), "utf8")),
      );
      expect(metadata.status).toBe("COMPLETED");
      expect(metadata.artifacts).toHaveLength(4);
      expect(metadata.artifacts.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
      const manifest = JSON.parse(await readFile(join(packageDirectory, "manifest.json"), "utf8"));
      expect(manifest.files["run-metadata.json"]).toMatch(/^[a-f0-9]{64}$/);
      await expect(
        readCompletedPackageFile({
          runsRoot,
          runId: "run-completed",
          filename: "migration-up.sql",
        }),
      ).resolves.toBe(rendered.files["migration-up.sql"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("persists only sanitized post-analysis failure diagnostics outside package", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const secret = "private-provider-token";
    try {
      await persistFailedRun({
        runsRoot,
        runId: "run-failed",
        snapshot: snapshot("run-failed", "VALIDATION_FAILED", context.contextHash),
        secrets: [secret],
        context,
        draft,
        findings: [
          {
            code: "PROHIBITED_SQL",
            message: `Provider returned ${secret}`,
            filename: "migration-up.sql",
          },
        ],
      });

      expect((await readdir(join(runsRoot, "run-failed"))).sort()).toEqual(
        [
          "change-context.json",
          "migration-package-draft.json",
          "run-metadata.json",
          "validation-findings.json",
        ].sort(),
      );
      expect(
        await readFile(join(runsRoot, "run-failed", "validation-findings.json"), "utf8"),
      ).toContain("[REDACTED]");
      await expect(access(join(runsRoot, "run-failed", "package"))).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects metadata beneath a symlinked run directory", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const outside = join(sandbox, "outside");
    try {
      await mkdir(outside);
      await writeFile(join(outside, "run-metadata.json"), "{}");
      await symlink(
        outside,
        join(runsRoot, "run-link"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(readRunMetadataFile({ runsRoot, runId: "run-link" })).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("loads eligible diagnostic regeneration context only when both hashes match", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    try {
      await persistFailedRun({
        runsRoot,
        runId: "run-parent",
        snapshot: snapshot("run-parent", "GENERATION_FAILED", context.contextHash),
        secrets: [],
        context,
      });
      await expect(
        loadRegenerationContext({ runsRoot, runId: "run-parent" }),
      ).resolves.toMatchObject({
        snapshot: { status: "GENERATION_FAILED" },
        context: { contextHash: context.contextHash },
      });

      const path = join(runsRoot, "run-parent", "change-context.json");
      const tampered = JSON.parse(await readFile(path, "utf8"));
      tampered.request = "Tampered request";
      await writeFile(path, JSON.stringify(tampered));
      await expect(
        loadRegenerationContext({ runsRoot, runId: "run-parent" }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The parent run cannot be regenerated.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("loads an integrity-matched validation failure diagnostic context", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    try {
      await persistFailedRun({
        runsRoot,
        runId: "run-validation-parent",
        snapshot: snapshot("run-validation-parent", "VALIDATION_FAILED", context.contextHash),
        secrets: [],
        context,
        findings: [
          {
            code: "PROHIBITED_SQL",
            message: "SQL is outside the exact statement allowlist.",
            filename: "migration-up.sql",
          },
        ],
      });
      await expect(
        loadRegenerationContext({ runsRoot, runId: "run-validation-parent" }),
      ).resolves.toMatchObject({
        snapshot: { status: "VALIDATION_FAILED" },
        context: { contextHash: context.contextHash },
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects ineligible or missing diagnostic regeneration context with fixed text", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    try {
      await persistFailedRun({
        runsRoot,
        runId: "run-validation",
        snapshot: snapshot("run-validation", "GENERATION_FAILED", context.contextHash),
        secrets: [],
      });
      await expect(
        loadRegenerationContext({ runsRoot, runId: "run-validation" }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The parent run cannot be regenerated.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("cleans staging and exposes no package when a staged write fails", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const rendered = renderMigrationPackage(context, draft);
    try {
      await expect(
        persistCompletedRun({
          runsRoot,
          runId: "run-write-failure",
          context,
          draft,
          rendered,
          snapshot: snapshot("run-write-failure", "COMPLETED", context.contextHash),
          hooks: {
            afterStagedWrite: ({ index }) => {
              if (index === 2) throw new Error("injected write failure");
            },
          },
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      expect(
        (await readdir(join(runsRoot, "run-write-failure"))).filter((name) =>
          name.startsWith(".package-"),
        ),
      ).toEqual([]);
      await expect(
        access(join(runsRoot, "run-write-failure", "package", "manifest.json")),
      ).rejects.toThrow();
      await expect(
        readCompletedPackageFile({
          runsRoot,
          runId: "run-write-failure",
          filename: "migration-up.sql",
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("cleans staging when cancellation is injected after the second staged file", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const rendered = renderMigrationPackage(context, draft);
    const controller = new AbortController();
    try {
      await expect(
        persistCompletedRun({
          runsRoot,
          runId: "run-write-abort",
          context,
          draft,
          rendered,
          snapshot: snapshot("run-write-abort", "COMPLETED", context.contextHash),
          signal: controller.signal,
          hooks: {
            afterStagedWrite: ({ index }) => {
              if (index === 2) controller.abort();
            },
          },
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(
        (await readdir(join(runsRoot, "run-write-abort"))).filter((name) =>
          name.startsWith(".package-"),
        ),
      ).toEqual([]);
      await expect(
        access(join(runsRoot, "run-write-abort", "package", "manifest.json")),
      ).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("cleans pre-rename cancellation but keeps a post-rename committed package authoritative", async () => {
    const first = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const rendered = renderMigrationPackage(context, draft);
    const pre = new AbortController();
    try {
      await expect(
        persistCompletedRun({
          runsRoot: first.runsRoot,
          runId: "run-pre-abort",
          context,
          draft,
          rendered,
          snapshot: snapshot("run-pre-abort", "COMPLETED", context.contextHash),
          signal: pre.signal,
          hooks: { beforeRename: () => pre.abort() },
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      await expect(access(join(first.runsRoot, "run-pre-abort", "package"))).rejects.toThrow();
    } finally {
      await rm(first.sandbox, { recursive: true, force: true });
    }

    const second = await freshRoot();
    const post = new AbortController();
    try {
      await expect(
        persistCompletedRun({
          runsRoot: second.runsRoot,
          runId: "run-post-abort",
          context,
          draft,
          rendered,
          snapshot: snapshot("run-post-abort", "COMPLETED", context.contextHash),
          signal: post.signal,
          hooks: { afterRename: () => post.abort() },
        }),
      ).resolves.toMatchObject({ status: "COMPLETED" });
      await expect(
        loadRunSnapshot({ runsRoot: second.runsRoot, runId: "run-post-abort" }),
      ).resolves.toMatchObject({
        status: "COMPLETED",
      });
    } finally {
      await rm(second.sandbox, { recursive: true, force: true });
    }
  });

  it("reserves exactly one child and does not consume the parent on child collisions", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    try {
      await mkdir(join(runsRoot, "parent"));
      await mkdir(join(runsRoot, "occupied"));
      await expect(
        reserveGenerationRetry({ runsRoot, parentRunId: "parent", childRunId: "occupied" }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(access(join(runsRoot, "parent", "generation-retry.lock"))).rejects.toThrow();

      const outcomes = await Promise.allSettled([
        reserveGenerationRetry({ runsRoot, parentRunId: "parent", childRunId: "child-a" }),
        reserveGenerationRetry({ runsRoot, parentRunId: "parent", childRunId: "child-b" }),
      ]);
      expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
      const lock = JSON.parse(
        await readFile(join(runsRoot, "parent", "generation-retry.lock"), "utf8"),
      );
      expect(["child-a", "child-b"]).toContain(lock.childRunId);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("never falls back to run-root metadata after completed package tampering", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const rendered = renderMigrationPackage(context, draft);
    try {
      await persistCompletedRun({
        runsRoot,
        runId: "run-tampered-package",
        context,
        draft,
        rendered,
        snapshot: snapshot("run-tampered-package", "COMPLETED", context.contextHash),
      });
      await writeFile(
        join(runsRoot, "run-tampered-package", "run-metadata.json"),
        jsonForTest(snapshot("run-tampered-package", "GENERATION_FAILED", context.contextHash)),
      );
      await writeFile(
        join(runsRoot, "run-tampered-package", "package", "migration-up.sql"),
        "tampered",
      );

      await expect(
        readCompletedPackageFile({
          runsRoot,
          runId: "run-tampered-package",
          filename: "migration-up.sql",
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      await writeFile(join(runsRoot, "run-tampered-package", "package", "run-metadata.json"), "{}");
      await expect(
        readRunMetadataFile({ runsRoot, runId: "run-tampered-package" }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects extra manifest keys at the completed download boundary", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const rendered = renderMigrationPackage(context, draft);
    try {
      await persistCompletedRun({
        runsRoot,
        runId: "run-extra-manifest-key",
        context,
        draft,
        rendered,
        snapshot: snapshot("run-extra-manifest-key", "COMPLETED", context.contextHash),
      });
      const manifestPath = join(runsRoot, "run-extra-manifest-key", "package", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      await writeFile(manifestPath, jsonForTest({ ...manifest, nativePath: "must-not-be-kept" }));

      await expect(
        readCompletedPackageFile({
          runsRoot,
          runId: "run-extra-manifest-key",
          filename: "migration-up.sql",
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it.each(["file", "symlink"] as const)(
    "rejects an existing child %s without consuming the parent retry",
    async (kind) => {
      const { sandbox, runsRoot } = await freshRoot();
      try {
        await mkdir(join(runsRoot, "parent"));
        const occupied = join(runsRoot, "occupied");
        if (kind === "file") {
          await writeFile(occupied, "occupied");
        } else {
          const outside = join(sandbox, "outside");
          await mkdir(outside);
          await symlink(outside, occupied, process.platform === "win32" ? "junction" : "dir");
        }

        await expect(
          reserveGenerationRetry({
            runsRoot,
            parentRunId: "parent",
            childRunId: "occupied",
          }),
        ).rejects.toMatchObject({
          code: "INVALID_REQUEST",
          message: "The child run ID is unavailable.",
        });
        await expect(access(join(runsRoot, "parent", "generation-retry.lock"))).rejects.toThrow();
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it("prevents a competing creator between child creation and parent locking", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    let release!: () => void;
    let childCreated!: () => void;
    const created = new Promise<void>((resolve) => {
      childCreated = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await mkdir(join(runsRoot, "parent"));
      const reservation = reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child",
        hooks: {
          afterChildCreated: async () => {
            childCreated();
            await barrier;
          },
        },
      });
      await created;
      await expect(mkdir(join(runsRoot, "child"))).rejects.toMatchObject({ code: "EEXIST" });
      release();
      await expect(reservation).resolves.toMatchObject({ childRunId: "child" });
    } finally {
      release();
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("does not recursively remove a non-empty child when parent locking loses a race", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    try {
      await mkdir(join(runsRoot, "parent"));
      await writeFile(join(runsRoot, "parent", "generation-retry.lock"), "occupied");
      await expect(
        reserveGenerationRetry({
          runsRoot,
          parentRunId: "parent",
          childRunId: "child",
          hooks: {
            afterChildCreated: async () => {
              await writeFile(join(runsRoot, "child", "competitor-owned"), "preserve");
            },
          },
        }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The parent run cannot be regenerated.",
      });
      await expect(readFile(join(runsRoot, "child", "competitor-owned"), "utf8")).resolves.toBe(
        "preserve",
      );
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a snapshot hash that does not match the diagnostic context", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const mismatchedContext = makeChangeContext({ score: 70 });
    try {
      await expect(
        persistFailedRun({
          runsRoot,
          runId: "run-mismatch",
          snapshot: snapshot("run-mismatch", "GENERATION_FAILED", context.contextHash),
          secrets: [],
          context: mismatchedContext,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a completed context whose internal hash was not recomputed", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const tamperedContext = { ...context, request: "Tampered after hashing" };
    const draft = makeMigrationDraft(context);
    const rendered = renderMigrationPackage(context, draft);
    try {
      await expect(
        persistCompletedRun({
          runsRoot,
          runId: "run-tampered-context",
          context: tamperedContext,
          draft,
          rendered,
          snapshot: snapshot("run-tampered-context", "COMPLETED", context.contextHash),
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The completed context is inconsistent.",
      });
      await expect(access(join(runsRoot, "run-tampered-context", "package"))).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
