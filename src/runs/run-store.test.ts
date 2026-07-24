import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMigrationPackage } from "../migrations/render-snowflake-package.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import {
  WorkflowSnapshotSchema,
  type DemoMode,
  type WorkflowSnapshot,
} from "../workflow/contracts.js";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import {
  MAX_RUN_ENVELOPE_BYTES,
  virtualArtifactFilenames,
  type VirtualArtifactFilename,
} from "./run-envelope.js";
import {
  __testOnly,
  loadRegenerationContext,
  loadRunSnapshot,
  persistCompletedRun,
  persistFailedRun,
  readCompletedPackageFile,
  reserveGenerationRetry,
  type ReservedChildRun,
} from "./run-store.js";

async function freshRoot(): Promise<{ sandbox: string; runsRoot: string }> {
  const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-run-store-"));
  const runsRoot = await mkdtemp(join(sandbox, "runs-"));
  return { sandbox, runsRoot };
}

function completedSnapshot(
  runId: string,
  contextHash: string,
  options: {
    readonly mode?: DemoMode;
    readonly parentRunId?: string;
    readonly classification?:
      "ADVISORY_ONLY" | "EXECUTABLE_WITH_REVIEW" | "NON_EXECUTABLE_TEMPLATE";
  } = {},
): WorkflowSnapshot {
  return WorkflowSnapshotSchema.parse({
    runId,
    mode: options.mode ?? "REPLAY",
    status: "COMPLETED",
    contextHash,
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    activity: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    executionClassification: options.classification ?? "ADVISORY_ONLY",
    validation: { outcome: "PASSED", findingCount: 0, findingCodes: [] },
    artifacts: [],
  });
}

function failedSnapshot(
  runId: string,
  status: "GENERATION_FAILED" | "VALIDATION_FAILED" | "CANCELLED",
  options: {
    readonly contextHash?: string;
    readonly mode?: DemoMode;
    readonly parentRunId?: string;
    readonly findings?: readonly PackageFinding[];
  } = {},
): WorkflowSnapshot {
  const findings = options.findings ?? [];
  const findingCodes = [...new Set(findings.map(({ code }) => code))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  return WorkflowSnapshotSchema.parse({
    runId,
    mode: options.mode ?? "REPLAY",
    status,
    ...(options.contextHash === undefined ? {} : { contextHash: options.contextHash }),
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    activity: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    validation: {
      outcome: status === "VALIDATION_FAILED" ? "REJECTED" : "NOT_RUN",
      findingCount: findings.length,
      findingCodes,
    },
    artifacts: [],
    failure: { code: status, message: "The workflow did not complete." },
  });
}

function completedFixture(runId: string, options: { readonly parentRunId?: string } = {}) {
  const context = makeChangeContext({ datasetName: "order_entry_db.analytics.order_details" });
  const draft = makeMigrationDraft(context);
  const rendered = renderMigrationPackage(context, draft);
  const snapshot = completedSnapshot(runId, context.contextHash, {
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    classification: rendered.classification,
  });
  return { context, draft, rendered, snapshot };
}

async function persistEligibleParent(runsRoot: string, runId = "parent"): Promise<void> {
  const context = makeChangeContext();
  await persistFailedRun({
    runsRoot,
    runId,
    snapshot: failedSnapshot(runId, "GENERATION_FAILED", { contextHash: context.contextHash }),
    secrets: [],
    context,
  });
}

interface MutableStoredEnvelope {
  parentRunId?: string;
  generationAttempt: number;
  hashes: Record<string, unknown> & {
    artifacts?: Record<string, string>;
  };
  package?: {
    files: Record<string, string>;
  };
}

async function readStoredEnvelope(runsRoot: string, runId: string): Promise<MutableStoredEnvelope> {
  return JSON.parse(await readFile(join(runsRoot, `run-${runId}.json`), "utf8"));
}

async function overwriteStoredEnvelope(
  runsRoot: string,
  runId: string,
  envelope: MutableStoredEnvelope,
): Promise<void> {
  await writeFile(join(runsRoot, `run-${runId}.json`), `${JSON.stringify(envelope, null, 2)}\n`);
}

function withFailedSnapshotString(
  snapshot: WorkflowSnapshot,
  surface: "failure" | "activity" | "facts" | "metadata",
  value: string,
): WorkflowSnapshot {
  if (surface === "failure") {
    return WorkflowSnapshotSchema.parse({
      ...snapshot,
      failure: { ...snapshot.failure, message: value },
    });
  }
  if (surface === "activity") {
    return WorkflowSnapshotSchema.parse({
      ...snapshot,
      activity: [
        {
          at: "2026-07-24T12:00:00.000Z",
          status: snapshot.status,
          label: value,
          outcome: "failed",
        },
      ],
    });
  }
  if (surface === "facts") {
    return WorkflowSnapshotSchema.parse({ ...snapshot, facts: [value] });
  }
  return WorkflowSnapshotSchema.parse({
    ...snapshot,
    datahub: {
      source: "fixture",
      verification: "REPLAY_FIXTURE",
      configuredMcpPackage: "mcp-server-datahub@0.6.0",
      allowedTools: ["search", "list_schema_fields", "get_lineage", "get_entities"],
      reportedServerName: value,
    },
  });
}

describe("flat run store", () => {
  it("persists one completed envelope and exposes only verified virtual values", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const fixture = completedFixture("completed");
    try {
      const persisted = await persistCompletedRun({
        runsRoot,
        runId: "completed",
        ...fixture,
      });

      await expect(loadRunSnapshot({ runsRoot, runId: "completed" })).resolves.toEqual(persisted);
      for (const filename of virtualArtifactFilenames) {
        await expect(
          readCompletedPackageFile({ runsRoot, runId: "completed", filename }),
        ).resolves.toBe(fixture.rendered.files[filename]);
      }
      expect(await readdir(runsRoot)).toEqual(["run-completed.json"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("persists one failed envelope with sanitized diagnostics and no public package", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    const draft = makeMigrationDraft(context);
    const secret = "provider-secret-value";
    const findings = [
      {
        code: "PROHIBITED_SQL",
        message: `Provider failed with ${secret}`,
        filename: "migration-up.sql" as const,
      },
    ];
    try {
      await persistFailedRun({
        runsRoot,
        runId: "failed",
        snapshot: failedSnapshot("failed", "VALIDATION_FAILED", {
          contextHash: context.contextHash,
          findings: [
            {
              code: "PROHIBITED_SQL",
              message: "Provider failed with [REDACTED]",
              filename: "migration-up.sql",
            },
          ],
        }),
        secrets: [secret],
        context,
        draft,
        findings,
      });

      const stored = await readFile(join(runsRoot, "run-failed.json"), "utf8");
      expect(stored).toContain("[REDACTED]");
      expect(stored).not.toContain(secret);
      expect((JSON.parse(stored) as { kind: string; package?: unknown }).kind).toBe("failed");
      expect((JSON.parse(stored) as { package?: unknown }).package).toBeUndefined();
      await expect(
        readCompletedPackageFile({
          runsRoot,
          runId: "failed",
          filename: "migration-up.sql",
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored run is unavailable.",
      });
      expect(await readdir(runsRoot)).toEqual(["run-failed.json"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it.each([
    ["failure", "private-provider-token", ["private-provider-token"]],
    ["activity", "sk-proj-12345678901234567890", []],
    ["facts", "unsafe\nfact", []],
    ["metadata", "Bearer abcdefghijklmnop", []],
  ] as const)(
    "rejects a failed snapshot whose %s string is not already boundary-safe",
    async (surface, value, secrets) => {
      const { sandbox, runsRoot } = await freshRoot();
      const context = makeChangeContext();
      const base = failedSnapshot("unsafe-failed", "GENERATION_FAILED", {
        contextHash: context.contextHash,
      });
      try {
        await expect(
          persistFailedRun({
            runsRoot,
            runId: "unsafe-failed",
            snapshot: withFailedSnapshotString(base, surface, value),
            secrets,
            context,
          }),
        ).rejects.toMatchObject({
          code: "ARTIFACT_WRITE_FAILED",
          message: "The failed run is inconsistent.",
        });
        expect(await readdir(runsRoot)).toEqual([]);
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it("rejects a completed snapshot with credential-shaped content before publication", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const fixture = completedFixture("unsafe-completed");
    try {
      await expect(
        persistCompletedRun({
          runsRoot,
          runId: "unsafe-completed",
          ...fixture,
          snapshot: WorkflowSnapshotSchema.parse({
            ...fixture.snapshot,
            facts: ["sk-proj-12345678901234567890"],
          }),
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The completed run is inconsistent.",
      });
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects completed and failed cross-field contradictions before publication", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const fixture = completedFixture("contradiction");
    try {
      await expect(
        persistCompletedRun({
          runsRoot,
          runId: "contradiction",
          ...fixture,
          snapshot: failedSnapshot("contradiction", "GENERATION_FAILED", {
            contextHash: fixture.context.contextHash,
          }),
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      await expect(
        persistFailedRun({
          runsRoot,
          runId: "failed-contradiction",
          snapshot: completedSnapshot("failed-contradiction", fixture.context.contextHash),
          secrets: [],
          context: fixture.context,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it.each(["missing", "extra"] as const)(
    "rejects a rendered package with %s artifacts before publication",
    async (kind) => {
      const { sandbox, runsRoot } = await freshRoot();
      const fixture = completedFixture(`artifact-${kind}`);
      const files: Record<string, string> = { ...fixture.rendered.files };
      if (kind === "missing") delete files["validation.sql"];
      else files["private-debug.json"] = "private";
      try {
        await expect(
          persistCompletedRun({
            runsRoot,
            runId: `artifact-${kind}`,
            ...fixture,
            rendered: { ...fixture.rendered, files } as typeof fixture.rendered,
          }),
        ).rejects.toMatchObject({ code: "ARTIFACT_WRITE_FAILED" });
        expect(await readdir(runsRoot)).toEqual([]);
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it.each(["snapshot", "context", "draft", "findings", "artifacts"] as const)(
    "rejects a tampered %s hash",
    async (section) => {
      const { sandbox, runsRoot } = await freshRoot();
      const runId = `tampered-${section}`;
      const fixture = completedFixture(runId);
      try {
        await persistCompletedRun({ runsRoot, runId, ...fixture });
        const envelope = await readStoredEnvelope(runsRoot, runId);
        if (section === "artifacts") {
          envelope.hashes.artifacts!["migration-up.sql"] = "0".repeat(64);
        } else {
          envelope.hashes[section] = "0".repeat(64);
        }
        await overwriteStoredEnvelope(runsRoot, runId, envelope);

        await expect(loadRunSnapshot({ runsRoot, runId })).rejects.toMatchObject({
          code: "ARTIFACT_WRITE_FAILED",
          message: "The stored run is unavailable.",
        });
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it("never falls back after completed envelope integrity failure", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const runId = "no-fallback";
    const fixture = completedFixture(runId);
    try {
      await persistCompletedRun({ runsRoot, runId, ...fixture });
      const envelope = await readStoredEnvelope(runsRoot, runId);
      envelope.package!.files["migration-up.sql"] = "tampered";
      await overwriteStoredEnvelope(runsRoot, runId, envelope);

      await expect(loadRunSnapshot({ runsRoot, runId })).rejects.toMatchObject({
        message: "The stored run is unavailable.",
      });
      await expect(
        readCompletedPackageFile({ runsRoot, runId, filename: "migration-up.sql" }),
      ).rejects.toMatchObject({ message: "The stored run is unavailable." });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects malformed and oversized final envelopes with fixed errors", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    try {
      await writeFile(join(runsRoot, "run-malformed.json"), "{");
      await writeFile(join(runsRoot, "run-oversized.json"), "x".repeat(MAX_RUN_ENVELOPE_BYTES + 1));

      for (const runId of ["malformed", "oversized"]) {
        await expect(loadRunSnapshot({ runsRoot, runId })).rejects.toMatchObject({
          code: "ARTIFACT_WRITE_FAILED",
          message: "The stored run is unavailable.",
        });
      }
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects public requests for private envelope sections", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const fixture = completedFixture("private-request");
    try {
      await persistCompletedRun({ runsRoot, runId: "private-request", ...fixture });
      await expect(
        readCompletedPackageFile({
          runsRoot,
          runId: "private-request",
          filename: "change-context.json" as VirtualArtifactFilename,
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored run is unavailable.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

describe("regeneration loading", () => {
  it.each(["COMPLETED", "GENERATION_FAILED", "VALIDATION_FAILED"] as const)(
    "loads an eligible %s parent only for the expected mode",
    async (status) => {
      const { sandbox, runsRoot } = await freshRoot();
      const runId = `eligible-${status.toLowerCase()}`;
      let context = makeChangeContext();
      try {
        if (status === "COMPLETED") {
          const fixture = completedFixture(runId);
          context = fixture.context;
          await persistCompletedRun({ runsRoot, runId, ...fixture });
        } else {
          const findings =
            status === "VALIDATION_FAILED"
              ? [
                  {
                    code: "PROHIBITED_SQL",
                    message: "SQL is outside the statement allowlist.",
                    filename: "migration-up.sql" as const,
                  },
                ]
              : [];
          await persistFailedRun({
            runsRoot,
            runId,
            snapshot: failedSnapshot(runId, status, {
              contextHash: context.contextHash,
              findings,
            }),
            secrets: [],
            context,
            findings,
          });
        }

        await expect(
          loadRegenerationContext({ runsRoot, runId, expectedMode: "REPLAY" }),
        ).resolves.toMatchObject({
          snapshot: { runId, status, mode: "REPLAY" },
          context: { contextHash: context.contextHash },
        });
        await expect(
          loadRegenerationContext({ runsRoot, runId, expectedMode: "LIVE" }),
        ).rejects.toMatchObject({
          code: "INVALID_REQUEST",
          message: "The parent run cannot be regenerated.",
        });
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["ineligible status", "CANCELLED"],
    ["missing context", "GENERATION_FAILED"],
  ] as const)("rejects %s with fixed text", async (_label, status) => {
    const { sandbox, runsRoot } = await freshRoot();
    const runId = `ineligible-${status.toLowerCase()}`;
    try {
      await persistFailedRun({
        runsRoot,
        runId,
        snapshot: failedSnapshot(runId, status),
        secrets: [],
      });
      await expect(
        loadRegenerationContext({ runsRoot, runId, expectedMode: "REPLAY" }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The parent run cannot be regenerated.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it.each(["parent", "generation-attempt"] as const)(
    "rejects a stored %s mismatch",
    async (kind) => {
      const { sandbox, runsRoot } = await freshRoot();
      const runId = `lineage-${kind}`;
      const context = makeChangeContext();
      try {
        await persistFailedRun({
          runsRoot,
          runId,
          snapshot: failedSnapshot(runId, "GENERATION_FAILED", {
            contextHash: context.contextHash,
          }),
          secrets: [],
          context,
        });
        const envelope = await readStoredEnvelope(runsRoot, runId);
        if (kind === "parent") envelope.parentRunId = "unexpected-parent";
        else envelope.generationAttempt = 2;
        await overwriteStoredEnvelope(runsRoot, runId, envelope);

        await expect(
          loadRegenerationContext({ runsRoot, runId, expectedMode: "REPLAY" }),
        ).rejects.toMatchObject({
          code: "INVALID_REQUEST",
          message: "The parent run cannot be regenerated.",
        });
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );
});

describe("generation retry reservation", () => {
  it("uses a real barrier so exactly one concurrent immutable reservation wins", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    let arrivals = 0;
    let release!: () => void;
    let bothArrived!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      bothArrived = resolve;
    });
    const beforePublish = async (): Promise<void> => {
      arrivals += 1;
      if (arrivals === 2) bothArrived();
      await gate;
    };
    try {
      await persistEligibleParent(runsRoot);
      const first = reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child-a",
        hooks: { beforePublish },
      });
      const second = reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child-b",
        hooks: { beforePublish },
      });
      await ready;
      release();

      const outcomes = await Promise.allSettled([first, second]);
      expect(arrivals).toBe(2);
      expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
      const winner = outcomes.find(
        (outcome): outcome is PromiseFulfilledResult<ReservedChildRun> =>
          outcome.status === "fulfilled",
      )!.value;
      const reservation = JSON.parse(await readFile(join(runsRoot, "retry-parent.json"), "utf8"));
      expect(reservation).toMatchObject({
        kind: "retry-reservation",
        parentRunId: "parent",
        childRunId: winner.childRunId,
        childMode: "REPLAY",
        generationAttempt: 2,
      });
      expect((await readdir(runsRoot)).sort()).toEqual(
        ["retry-parent.json", "run-parent.json"].sort(),
      );
    } finally {
      release();
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("requires the branded reservation for every child terminal envelope", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    try {
      await persistEligibleParent(runsRoot);
      const reservation = await reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child",
      });
      const childSnapshot = failedSnapshot("child", "GENERATION_FAILED", {
        contextHash: context.contextHash,
        parentRunId: "parent",
      });

      await expect(
        persistFailedRun({
          runsRoot,
          runId: "child",
          snapshot: childSnapshot,
          secrets: [],
          context,
        }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The child run has not been reserved.",
      });
      await expect(
        persistFailedRun({
          runsRoot,
          runId: "child",
          snapshot: childSnapshot,
          secrets: [],
          context,
          reservedChild: {
            canonicalRunsRoot: runsRoot,
            parentRunId: "parent",
            childRunId: "child",
            childMode: "REPLAY",
            generationAttempt: 2,
          } as unknown as ReservedChildRun,
        }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The child run has not been reserved.",
      });
      await expect(
        persistFailedRun({
          runsRoot,
          runId: "child",
          snapshot: childSnapshot,
          secrets: [],
          context,
          reservedChild: reservation,
        }),
      ).resolves.toBeUndefined();
      await expect(loadRunSnapshot({ runsRoot, runId: "child" })).resolves.toMatchObject({
        parentRunId: "parent",
        mode: "REPLAY",
        status: "GENERATION_FAILED",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("reaches the canonical-root comparison with an authentic reservation", async () => {
    const first = await freshRoot();
    const second = await freshRoot();
    const context = makeChangeContext();
    try {
      await persistEligibleParent(first.runsRoot);
      const reservation = await reserveGenerationRetry({
        runsRoot: first.runsRoot,
        parentRunId: "parent",
        childRunId: "child",
      });
      await expect(
        persistFailedRun({
          runsRoot: second.runsRoot,
          runId: "child",
          snapshot: failedSnapshot("child", "GENERATION_FAILED", {
            contextHash: context.contextHash,
            parentRunId: "parent",
          }),
          secrets: [],
          context,
          reservedChild: reservation,
        }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The child run has not been reserved.",
      });
      expect(await readdir(second.runsRoot)).toEqual([]);
    } finally {
      await rm(first.sandbox, { recursive: true, force: true });
      await rm(second.sandbox, { recursive: true, force: true });
    }
  });

  it.each([
    ["parent", "child", "different-parent", "REPLAY"],
    ["child", "different-child", "parent", "REPLAY"],
    ["mode", "child", "parent", "LIVE"],
  ] as const)(
    "reaches the %s comparison with an authentic reservation",
    async (_comparison, runId, parentRunId, mode) => {
      const { sandbox, runsRoot } = await freshRoot();
      const context = makeChangeContext();
      try {
        await persistEligibleParent(runsRoot);
        const reservation = await reserveGenerationRetry({
          runsRoot,
          parentRunId: "parent",
          childRunId: "child",
        });
        await expect(
          persistFailedRun({
            runsRoot,
            runId,
            snapshot: failedSnapshot(runId, "GENERATION_FAILED", {
              contextHash: context.contextHash,
              parentRunId,
              mode,
            }),
            secrets: [],
            context,
            reservedChild: reservation,
          }),
        ).rejects.toMatchObject({
          code: "INVALID_REQUEST",
          message: "The child run has not been reserved.",
        });
        expect((await readdir(runsRoot)).sort()).toEqual(
          ["retry-parent.json", "run-parent.json"].sort(),
        );
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it("directly proves the immutable generation-attempt predicate used by production", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    try {
      await persistEligibleParent(runsRoot);
      const reservation = await reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child",
      });
      const expected = {
        canonicalRunsRoot: reservation.canonicalRunsRoot,
        parentRunId: "parent",
        childRunId: "child",
        childMode: "REPLAY" as const,
      };

      expect(__testOnly.reservationFieldsMatch(reservation, expected)).toBe(true);
      expect(
        __testOnly.reservationFieldsMatch(
          {
            canonicalRunsRoot: reservation.canonicalRunsRoot,
            parentRunId: "parent",
            childRunId: "child",
            childMode: "REPLAY",
            generationAttempt: 1,
          },
          expected,
        ),
      ).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a reservation on a root run and a mismatched child mode", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    try {
      await persistEligibleParent(runsRoot);
      const reservation = await reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child",
      });
      await expect(
        persistFailedRun({
          runsRoot,
          runId: "root",
          snapshot: failedSnapshot("root", "GENERATION_FAILED", {
            contextHash: context.contextHash,
          }),
          secrets: [],
          context,
          reservedChild: reservation,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(
        persistFailedRun({
          runsRoot,
          runId: "child",
          snapshot: failedSnapshot("child", "GENERATION_FAILED", {
            contextHash: context.contextHash,
            parentRunId: "parent",
            mode: "LIVE",
          }),
          secrets: [],
          context,
          reservedChild: reservation,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("requires the branded reservation for a completed child", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    try {
      await persistEligibleParent(runsRoot);
      const reservation = await reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child",
      });
      const fixture = completedFixture("child", { parentRunId: "parent" });
      await expect(
        persistCompletedRun({ runsRoot, runId: "child", ...fixture }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(
        persistCompletedRun({
          runsRoot,
          runId: "child",
          ...fixture,
          reservedChild: reservation,
        }),
      ).resolves.toMatchObject({ status: "COMPLETED", parentRunId: "parent" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("does not release the parent reservation after a failed child run", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const context = makeChangeContext();
    try {
      await persistEligibleParent(runsRoot);
      const reservation = await reserveGenerationRetry({
        runsRoot,
        parentRunId: "parent",
        childRunId: "child",
      });
      await persistFailedRun({
        runsRoot,
        runId: "child",
        snapshot: failedSnapshot("child", "GENERATION_FAILED", {
          contextHash: context.contextHash,
          parentRunId: "parent",
        }),
        secrets: [],
        context,
        reservedChild: reservation,
      });

      await expect(
        reserveGenerationRetry({
          runsRoot,
          parentRunId: "parent",
          childRunId: "another-child",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        message: "The parent run cannot be regenerated.",
      });
      expect((await readdir(runsRoot)).sort()).toEqual(
        ["retry-parent.json", "run-child.json", "run-parent.json"].sort(),
      );
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("keeps public persistence errors free of native roots and dependency details", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const fixture = completedFixture("fixed-error");
    const secret = "secret-native-dependency-message";
    try {
      const error = await persistCompletedRun({
        runsRoot,
        runId: "fixed-error",
        ...fixture,
        hooks: { beforePublish: () => Promise.reject(new Error(`${secret}:${runsRoot}`)) },
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
      });
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(runsRoot);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
