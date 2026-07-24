import { createHash } from "node:crypto";
import {
  access,
  constants,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import {
  MAX_RETRY_RESERVATION_BYTES,
  MAX_RUN_ENVELOPE_BYTES,
  serializeRetryReservation,
  serializeRunEnvelope,
  virtualArtifactFilenames,
} from "../runs/run-envelope.js";
import { WorkflowSnapshotSchema } from "../workflow/contracts.js";
import { MigrationPackageDraftSchema } from "../workflow/migration-draft.js";
import {
  __testOnly,
  assertTrustedRunsRoot,
  publishRetryReservation,
  publishRunEnvelope,
  readRetryReservation,
  readRunEnvelope,
} from "./run-envelope-files.js";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

async function freshRoot(): Promise<{ readonly sandbox: string; readonly runsRoot: string }> {
  const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-flat-envelope-"));
  const runsRoot = await mkdtemp(join(sandbox, "runs-"));
  return { sandbox, runsRoot };
}

async function listTemporaryFiles(runsRoot: string): Promise<string[]> {
  return (await readdir(runsRoot)).filter((name) => name.startsWith(".tmp-")).sort();
}

function twoPartyPreLinkBarrier(): {
  readonly hook: () => Promise<void>;
  readonly bothReady: Promise<void>;
  readonly release: () => void;
} {
  let arrivals = 0;
  let announceReady!: () => void;
  let release!: () => void;
  const bothReady = new Promise<void>((resolve) => {
    announceReady = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    hook: async () => {
      arrivals += 1;
      if (arrivals === 2) announceReady();
      await released;
    },
    bothReady,
    release,
  };
}

function makeSnapshot(options: {
  readonly runId: string;
  readonly status: "COMPLETED" | "GENERATION_FAILED";
  readonly contextHash: string;
  readonly classification?: "EXECUTABLE_WITH_REVIEW" | "ADVISORY_ONLY" | "NON_EXECUTABLE_TEMPLATE";
  readonly artifacts?: readonly {
    readonly filename: (typeof virtualArtifactFilenames)[number];
    readonly sha256: string;
    readonly validated: boolean;
  }[];
}) {
  return WorkflowSnapshotSchema.parse({
    runId: options.runId,
    mode: "REPLAY",
    status: options.status,
    contextHash: options.contextHash,
    ...(options.classification === undefined
      ? {}
      : { executionClassification: options.classification }),
    activity: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    validation: {
      outcome: options.status === "COMPLETED" ? "PASSED" : "NOT_RUN",
      findingCount: 0,
      findingCodes: [],
    },
    artifacts: [...(options.artifacts ?? [])],
    ...(options.status === "COMPLETED"
      ? {}
      : { failure: { code: "GENERATION_FAILED", message: "Generation failed." } }),
  });
}

function makeCompletedEnvelope(runId = "run-1") {
  const context = makeChangeContext();
  const draft = makeMigrationDraft(context);
  const files = {
    "migration-up.sql": "ALTER TABLE orders ADD COLUMN customer_key NUMBER;\n",
    "migration-down.sql": "ALTER TABLE orders DROP COLUMN customer_key;\n",
    "validation.sql": "SELECT COUNT(*) FROM orders;\n",
    "rollout-plan.md": "# Rollout\n",
  } as const;
  const artifactHashes = Object.fromEntries(
    virtualArtifactFilenames.map((filename) => [filename, sha256(files[filename])]),
  ) as Record<(typeof virtualArtifactFilenames)[number], string>;
  const snapshot = makeSnapshot({
    runId,
    status: "COMPLETED",
    contextHash: context.contextHash,
    classification: draft.executionClassification,
    artifacts: [...virtualArtifactFilenames]
      .sort()
      .map((filename) => ({ filename, sha256: artifactHashes[filename], validated: true })),
  });
  const findings: never[] = [];
  return {
    schemaVersion: "1" as const,
    kind: "completed" as const,
    runId,
    mode: "REPLAY" as const,
    generationAttempt: 1 as const,
    snapshot,
    context,
    draft,
    findings,
    package: { classification: draft.executionClassification, files },
    hashes: {
      snapshot: sha256(canonical(WorkflowSnapshotSchema.parse(snapshot))),
      context: sha256(canonical(context)),
      draft: sha256(canonical(MigrationPackageDraftSchema.parse(draft))),
      findings: sha256(canonical(findings)),
      artifacts: artifactHashes,
    },
  };
}

function makeFailedEnvelope(runId = "run-1") {
  const context = makeChangeContext();
  const snapshot = makeSnapshot({
    runId,
    status: "GENERATION_FAILED",
    contextHash: context.contextHash,
  });
  const findings: never[] = [];
  return {
    schemaVersion: "1" as const,
    kind: "failed" as const,
    runId,
    mode: "REPLAY" as const,
    generationAttempt: 1 as const,
    snapshot,
    context,
    findings,
    hashes: {
      snapshot: sha256(canonical(WorkflowSnapshotSchema.parse(snapshot))),
      context: sha256(canonical(context)),
      findings: sha256(canonical(findings)),
    },
  };
}

function reservation(parentRunId = "parent", childRunId = "child"): string {
  return serializeRetryReservation({
    schemaVersion: "1",
    kind: "retry-reservation",
    parentRunId,
    childRunId,
    childMode: "REPLAY",
    generationAttempt: 2,
  });
}

describe("trusted flat run-envelope files", () => {
  it("requires an absolute, pre-created, writable real directory", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    try {
      await expect(assertTrustedRunsRoot(runsRoot)).resolves.toBe(runsRoot);
      await expect(assertTrustedRunsRoot("relative-runs")).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
      });
      const missing = join(sandbox, "missing");
      await expect(assertTrustedRunsRoot(missing)).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
      });
      await expect(access(missing)).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a symlink or junction configured as the runs root", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "lineageguard-flat-root-link-"));
    const actualRoot = join(sandbox, "actual");
    const linkedRoot = join(sandbox, "linked");
    try {
      await mkdir(actualRoot);
      await symlink(actualRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
      await expect(assertTrustedRunsRoot(linkedRoot)).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("validates the serialized run before touching the filesystem", async () => {
    await expect(
      publishRunEnvelope({
        runsRoot: join(tmpdir(), "definitely-missing-lineageguard-root"),
        runId: "../escape",
        serialized: "{}",
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_WRITE_FAILED",
      message: "Unable to persist the run.",
    });
  });

  it("lets exactly one concurrent final publication win", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const first = serializeRunEnvelope(makeCompletedEnvelope());
    const second = serializeRunEnvelope(makeFailedEnvelope());
    const barrier = twoPartyPreLinkBarrier();
    try {
      const outcomes = Promise.allSettled([
        publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: first,
          hooks: { beforePublish: barrier.hook },
        }),
        publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: second,
          hooks: { beforePublish: barrier.hook },
        }),
      ]);
      await barrier.bothReady;
      await expect(access(join(runsRoot, "run-run-1.json"))).rejects.toThrow();
      barrier.release();
      const results = await outcomes;
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
      expect(results.find(({ status }) => status === "rejected")).toMatchObject({
        reason: {
          code: "ARTIFACT_WRITE_FAILED",
          message: "The run already exists.",
        },
      });
      expect((await readRunEnvelope({ runsRoot, runId: "run-1" })).runId).toBe("run-1");
      expect(await listTemporaryFiles(runsRoot)).toEqual([]);
    } finally {
      barrier.release();
      await rm(sandbox, { recursive: true, force: true });
    }
  }, 5_000);

  it("exposes no final run when publication fails before link", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const serialized = serializeRunEnvelope(makeCompletedEnvelope());
    try {
      await expect(
        publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized,
          hooks: { beforePublish: () => Promise.reject(new Error("secret-native-path")) },
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
        details: {},
      });
      await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        message: "The stored run is unavailable.",
        details: {},
      });
      expect(await listTemporaryFiles(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("keeps the complete run authoritative after link", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const controller = new AbortController();
    try {
      await publishRunEnvelope({
        runsRoot,
        runId: "run-1",
        serialized: serializeRunEnvelope(makeCompletedEnvelope()),
        signal: controller.signal,
        hooks: { afterPublish: () => controller.abort(new Error("secret-abort-reason")) },
      });
      await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).resolves.toMatchObject({
        runId: "run-1",
      });
      expect(await listTemporaryFiles(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("cancels before publication without exposing the abort reason", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const controller = new AbortController();
    controller.abort(new Error("secret-abort-reason"));
    try {
      await expect(
        publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: serializeRunEnvelope(makeCompletedEnvelope()),
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({
        code: "CANCELLED",
        message: "The run was cancelled.",
        details: {},
      });
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("cancels at the pre-link barrier without publishing a final entry", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const controller = new AbortController();
    try {
      await expect(
        publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: serializeRunEnvelope(makeCompletedEnvelope()),
          signal: controller.signal,
          hooks: {
            beforePublish: () => controller.abort(new Error("secret-pre-link-reason")),
          },
        }),
      ).rejects.toMatchObject({
        code: "CANCELLED",
        message: "The run was cancelled.",
        details: {},
      });
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it.each(["file", "symlink", "directory"] as const)(
    "rejects a pre-existing final %s without replacing it",
    async (kind) => {
      const { sandbox, runsRoot } = await freshRoot();
      const finalPath = join(runsRoot, "run-run-1.json");
      try {
        if (kind === "file") await writeFile(finalPath, "competitor");
        if (kind === "directory") await mkdir(finalPath);
        if (kind === "symlink") {
          const target = join(sandbox, "target");
          await mkdir(target);
          await symlink(target, finalPath, process.platform === "win32" ? "junction" : "dir");
        }
        await expect(
          publishRunEnvelope({
            runsRoot,
            runId: "run-1",
            serialized: serializeRunEnvelope(makeCompletedEnvelope()),
          }),
        ).rejects.toMatchObject({
          code: "ARTIFACT_WRITE_FAILED",
          message: "The run already exists.",
        });
        expect(await lstat(finalPath)).toBeDefined();
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
  );

  it("retries only three exclusive temporary-name collisions", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const nonces = ["first", "second", "third"];
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      nonce: () => nonces.shift() ?? "unexpected-fourth",
    });
    try {
      await Promise.all(
        ["first", "second", "third"].map((nonce) =>
          writeFile(join(runsRoot, `.tmp-run-${nonce}.json`), "occupied", {
            flag: "wx",
            mode: 0o600,
          }),
        ),
      );
      await expect(
        boundary.publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: serializeRunEnvelope(makeCompletedEnvelope()),
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
      });
      expect(nonces).toEqual([]);
      await expect(access(join(runsRoot, ".tmp-run-unexpected-fourth.json"))).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a short write and removes only its own temporary file", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      nonce: () => "short-write",
      operations: {
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            stat: () => handle.stat(),
            write: async (buffer, offset, encoding) => {
              const result = await handle.write(buffer, offset, encoding);
              return { ...result, bytesWritten: result.bytesWritten - 1 };
            },
            read: (buffer, offset, length, position) =>
              handle.read(buffer, offset, length, position),
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    });
    try {
      await expect(
        boundary.publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: serializeRunEnvelope(makeCompletedEnvelope()),
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
      });
      expect(await readdir(runsRoot)).toEqual([]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("ignores post-link temporary cleanup failure and preserves the final run", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      nonce: () => "cleanup-failure",
      operations: {
        unlink: async (path) => {
          if (path.includes(".tmp-run-")) throw new Error("secret-cleanup-path");
          await unlink(path);
        },
      },
    });
    try {
      await expect(
        boundary.publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: serializeRunEnvelope(makeCompletedEnvelope()),
        }),
      ).resolves.toBeUndefined();
      await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).resolves.toMatchObject({
        runId: "run-1",
      });
      expect(await listTemporaryFiles(runsRoot)).toEqual([".tmp-run-cleanup-failure.json"]);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("never unlinks a temporary name whose recorded identity was replaced", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const temporaryPath = join(runsRoot, ".tmp-run-replaced.json");
    const displacedPath = join(runsRoot, ".displaced-original-run-envelope");
    let linked = false;
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      nonce: () => "replaced",
      operations: {
        link: async (existingPath, newPath) => {
          await link(existingPath, newPath);
          linked = true;
        },
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            stat: () => handle.stat(),
            write: (buffer, offset, encoding) => handle.write(buffer, offset, encoding),
            read: (buffer, offset, length, position) =>
              handle.read(buffer, offset, length, position),
            sync: () => handle.sync(),
            close: async () => {
              await handle.close();
              if (flags === "wx" && linked && path === temporaryPath) {
                await rename(temporaryPath, displacedPath);
                await writeFile(temporaryPath, "competitor-owned", {
                  flag: "wx",
                  mode: 0o600,
                });
              }
            },
          };
        },
      },
    });
    try {
      await boundary.publishRunEnvelope({
        runsRoot,
        runId: "run-1",
        serialized: serializeRunEnvelope(makeCompletedEnvelope()),
      });
      expect(await listTemporaryFiles(runsRoot)).toEqual([".tmp-run-replaced.json"]);
      await expect(readFile(temporaryPath, "utf8")).resolves.toBe("competitor-owned");
      await expect(readFile(displacedPath, "utf8")).resolves.toContain('"runId": "run-1"');
      await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).resolves.toMatchObject({
        runId: "run-1",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("bounds run reads at maximum-plus-one and returns fixed errors", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const finalPath = join(runsRoot, "run-run-1.json");
    let requestedLength = 0;
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      operations: {
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            stat: () => handle.stat(),
            write: (buffer, offset, encoding) => handle.write(buffer, offset, encoding),
            read: (buffer, offset, length, position) => {
              if (requestedLength === 0) requestedLength = length;
              return handle.read(buffer, offset, length, position);
            },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    });
    try {
      await writeFile(finalPath, Buffer.alloc(MAX_RUN_ENVELOPE_BYTES, 0x20));
      await expect(boundary.readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored run is unavailable.",
      });
      expect(requestedLength).toBe(MAX_RUN_ENVELOPE_BYTES + 1);

      requestedLength = 0;
      await writeFile(finalPath, Buffer.alloc(MAX_RUN_ENVELOPE_BYTES + 1, 0x20));
      await expect(boundary.readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored run is unavailable.",
      });
      expect(requestedLength).toBe(0);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects truncated JSON, symlinks, and non-regular final entries without fallback", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const finalPath = join(runsRoot, "run-run-1.json");
    try {
      await writeFile(finalPath, '{"schemaVersion":');
      await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        message: "The stored run is unavailable.",
      });
      await rm(finalPath);

      const outside = join(sandbox, "outside.json");
      await mkdir(outside);
      await symlink(outside, finalPath, process.platform === "win32" ? "junction" : "dir");
      await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        message: "The stored run is unavailable.",
      });
      await rm(finalPath);

      await mkdir(finalPath);
      await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        message: "The stored run is unavailable.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("sanitizes secret-bearing filesystem read errors", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      operations: {
        lstat: async () => {
          throw new Error("secret-native-path");
        },
      },
    });
    try {
      await expect(boundary.readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored run is unavailable.",
        details: {},
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("sanitizes secret-bearing filesystem publication errors", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      operations: {
        open: async () => {
          throw new Error("secret-native-publication-path");
        },
      },
    });
    try {
      await expect(
        boundary.publishRunEnvelope({
          runsRoot,
          runId: "run-1",
          serialized: serializeRunEnvelope(makeCompletedEnvelope()),
        }),
      ).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "Unable to persist the run.",
        details: {},
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("requires the opened final handle to remain a regular file", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const finalPath = join(runsRoot, "run-run-1.json");
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      operations: {
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            stat: async () => ({
              dev: 1,
              ino: 1,
              size: 2,
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            }),
            write: (buffer, offset, encoding) => handle.write(buffer, offset, encoding),
            read: (buffer, offset, length, position) =>
              handle.read(buffer, offset, length, position),
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    });
    try {
      await writeFile(finalPath, "{}");
      await expect(boundary.readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored run is unavailable.",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("publishes and reads one create-only retry reservation", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const barrier = twoPartyPreLinkBarrier();
    try {
      const serialized = reservation();
      const pendingOutcomes = Promise.allSettled([
        publishRetryReservation({
          runsRoot,
          parentRunId: "parent",
          serialized,
          hooks: { beforePublish: barrier.hook },
        }),
        publishRetryReservation({
          runsRoot,
          parentRunId: "parent",
          serialized,
          hooks: { beforePublish: barrier.hook },
        }),
      ]);
      await barrier.bothReady;
      await expect(access(join(runsRoot, "retry-parent.json"))).rejects.toThrow();
      barrier.release();
      const outcomes = await pendingOutcomes;
      expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
        reason: {
          code: "INVALID_REQUEST",
          message: "The parent run cannot be regenerated.",
        },
      });
      await expect(
        readRetryReservation({ runsRoot, parentRunId: "parent" }),
      ).resolves.toMatchObject({
        parentRunId: "parent",
        childRunId: "child",
      });
      expect(await listTemporaryFiles(runsRoot)).toEqual([]);
    } finally {
      barrier.release();
      await rm(sandbox, { recursive: true, force: true });
    }
  }, 5_000);

  it("bounds reservation reads and rejects maximum-plus-one before reading", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    const finalPath = join(runsRoot, "retry-parent.json");
    let requestedLength = 0;
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      operations: {
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode);
          return {
            stat: () => handle.stat(),
            write: (buffer, offset, encoding) => handle.write(buffer, offset, encoding),
            read: (buffer, offset, length, position) => {
              if (requestedLength === 0) requestedLength = length;
              return handle.read(buffer, offset, length, position);
            },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    });
    try {
      await writeFile(finalPath, Buffer.alloc(MAX_RETRY_RESERVATION_BYTES, 0x20));
      await expect(
        boundary.readRetryReservation({ runsRoot, parentRunId: "parent" }),
      ).rejects.toMatchObject({ message: "The stored retry reservation is unavailable." });
      expect(requestedLength).toBe(MAX_RETRY_RESERVATION_BYTES + 1);

      requestedLength = 0;
      await writeFile(finalPath, Buffer.alloc(MAX_RETRY_RESERVATION_BYTES + 1, 0x20));
      await expect(
        boundary.readRetryReservation({ runsRoot, parentRunId: "parent" }),
      ).rejects.toMatchObject({ message: "The stored retry reservation is unavailable." });
      expect(requestedLength).toBe(0);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("checks write access on the canonical root", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    let checkedMode: number | undefined;
    const boundary = __testOnly.createRunEnvelopeFileBoundary({
      operations: {
        access: async (_path, mode) => {
          checkedMode = mode;
        },
      },
    });
    try {
      await expect(boundary.assertTrustedRunsRoot(runsRoot)).resolves.toBe(runsRoot);
      expect(checkedMode).toBe(constants.W_OK);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("uses exact direct-child final names", async () => {
    const { sandbox, runsRoot } = await freshRoot();
    try {
      await publishRunEnvelope({
        runsRoot,
        runId: "run-1",
        serialized: serializeRunEnvelope(makeCompletedEnvelope()),
      });
      await publishRetryReservation({
        runsRoot,
        parentRunId: "parent",
        serialized: reservation(),
      });
      expect((await readdir(runsRoot)).sort()).toEqual(["retry-parent.json", "run-run-1.json"]);
      expect(await readFile(join(runsRoot, "run-run-1.json"), "utf8")).toContain(
        '"runId": "run-1"',
      );
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
