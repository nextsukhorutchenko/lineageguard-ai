# Flat Run Envelope Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demonstrated nested-directory filesystem race with one immutable,
create-only terminal envelope per run while preserving virtual artifact downloads, deterministic
reload, regeneration, and the existing CLI impact-report capability.

**Architecture:** Treat the pre-created app-owned `LINEAGEGUARD_RUNS_DIR` as the deployment trust
boundary. Serialize each terminal run or retry reservation completely in memory, write it to a
random direct-child temporary file, synchronize it, and atomically publish it with a create-only
hard link. Reads are bounded, strict, hash-verified, and expose only virtual filenames and typed
application values.

**Tech Stack:** Node.js 22.23.1 `node:fs/promises`, TypeScript 6.0.3, Zod 4.4.3, Vitest 4.1.10,
SHA-256 from `node:crypto`, the existing single-package ESM toolchain.

## Global Constraints

- Keep one TypeScript `pnpm` package; do not add a native addon, helper executable, database, or
  second persistence runtime.
- The configured runs root must already exist as a real app-owned directory and must not be a
  symbolic link or junction.
- The application does not defend against a process that can replace the trusted runs root itself.
- Create no nested run, staging, package, blob, or lock directories.
- Publish only direct-child filenames derived from a validated run ID and fixed prefixes.
- Treat successful hard-link creation as the only terminal publication linearization point.
- Never overwrite or remove a final run or reservation during rollback.
- Keep envelope contents bounded, strictly parsed, sanitized, and hash-verified before use.
- A completed run contains exactly four public virtual artifacts; failed runs contain no public
  completed package.
- Never return native paths, custom abort reasons, raw filesystem errors, secrets, or persisted raw
  fragments across application boundaries.
- Keep required tests offline, deterministic, credential-free, and independent of live DataHub or
  OpenAI services.
- Keep code, tests, documentation, errors, commits, and UI text in English.

---

### Task 1: Define Strict Terminal and Reservation Envelopes

**Files:**

- Create: `src/runs/run-envelope.ts`
- Create: `src/runs/run-envelope.test.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `WorkflowSnapshotSchema`, `ChangeContextSchema`,
  `MigrationPackageDraftSchema`, sanitized `PackageFinding`, and the existing rendered artifact
  filenames.
- Produces: `RunEnvelopeSchema`, `RunEnvelope`, `RetryReservationEnvelopeSchema`,
  `RetryReservationEnvelope`, `SafeRunIdSchema`, `PersistedFindingSchema`,
  `virtualArtifactFilenames`, `MAX_RUN_ENVELOPE_BYTES`, `MAX_RETRY_RESERVATION_BYTES`,
  `MAX_VIRTUAL_ARTIFACT_BYTES`, `assertSafeRunId(runId)`, `serializeRunEnvelope(value)`,
  `assertEnvelopeByteLimit(raw)`, `parseRunEnvelope(raw, expectedRunId)`,
  `serializeRetryReservation(value)`, and `parseRetryReservation(raw, expectedParentRunId)`.

- [ ] **Step 1: Write failing schema and boundary tests**

Create `src/runs/run-envelope.test.ts` with table-driven tests that:

```ts
import { describe, expect, it } from "vitest";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import {
  MAX_RUN_ENVELOPE_BYTES,
  MAX_VIRTUAL_ARTIFACT_BYTES,
  RunEnvelopeSchema,
  RetryReservationEnvelopeSchema,
  assertEnvelopeByteLimit,
  parseRunEnvelope,
  serializeRunEnvelope,
  virtualArtifactFilenames,
} from "./run-envelope.js";

describe("run envelopes", () => {
  it("uses the exact public artifact allowlist", () => {
    expect(virtualArtifactFilenames).toEqual([
      "migration-up.sql",
      "migration-down.sql",
      "validation.sql",
      "rollout-plan.md",
    ]);
  });

  it("rejects unknown keys and a completed envelope missing any public artifact", () => {
    const valid = makeCompletedEnvelope();
    expect(() => RunEnvelopeSchema.parse({ ...valid, extra: "forbidden" })).toThrow();
    const { ["migration-up.sql"]: omitted, ...incomplete } = valid.package.files;
    expect(omitted).toBeTypeOf("string");
    expect(() =>
      RunEnvelopeSchema.parse({ ...valid, package: { ...valid.package, files: incomplete } }),
    ).toThrow();
  });

  it("rejects a failed envelope with a public package", () => {
    const completed = makeCompletedEnvelope();
    expect(() =>
      RunEnvelopeSchema.parse({
        ...completed,
        snapshot: makeFailedSnapshot(completed.snapshot),
      }),
    ).toThrow();
  });

  it("rejects exact maximum plus one before JSON parsing", () => {
    const oversized = "x".repeat(MAX_RUN_ENVELOPE_BYTES + 1);
    expect(() => parseRunEnvelope(oversized, "run-1")).toThrow("The stored run is unavailable.");
  });

  it("accepts the exact envelope byte boundary and rejects one byte more", () => {
    expect(() => assertEnvelopeByteLimit("x".repeat(MAX_RUN_ENVELOPE_BYTES))).not.toThrow();
    expect(() => assertEnvelopeByteLimit("x".repeat(MAX_RUN_ENVELOPE_BYTES + 1))).toThrow(
      "The stored run is unavailable.",
    );
  });

  it("accepts an artifact at its exact byte limit and rejects one byte more", () => {
    expect(() =>
      RunEnvelopeSchema.parse(makeImpactEnvelope("x".repeat(MAX_VIRTUAL_ARTIFACT_BYTES))),
    ).not.toThrow();
    expect(() =>
      RunEnvelopeSchema.parse(makeImpactEnvelope("x".repeat(MAX_VIRTUAL_ARTIFACT_BYTES + 1))),
    ).toThrow();
  });
});

describe("retry reservations", () => {
  it("accepts only the fixed closed reservation shape", () => {
    const value = {
      schemaVersion: "1",
      kind: "retry-reservation",
      parentRunId: "parent-1",
      childRunId: "child-1",
      childMode: "REPLAY",
      generationAttempt: 2,
    };
    expect(RetryReservationEnvelopeSchema.parse(value)).toEqual(value);
    expect(() => RetryReservationEnvelopeSchema.parse({ ...value, token: "forbidden" })).toThrow();
  });
});
```

The test file must define deterministic local builders for valid completed, failed, and impact
envelopes. It must additionally reject wrong run IDs, modes, parents, attempts, hashes, artifact
hashes, non-terminal snapshots, 201 findings, duplicate or unsorted finding tuples, malformed
legacy impact-report envelopes, and every unknown nested key.

- [ ] **Step 2: Run the focused test and prove RED**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/runs/run-envelope.test.ts
```

Expected: FAIL because `src/runs/run-envelope.ts` does not exist.

- [ ] **Step 3: Implement the strict schemas and canonical serializer**

Create `src/runs/run-envelope.ts` with these exact exported constants and discriminators:

```ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { ChangeContextSchema } from "../workflow/change-context.js";
import {
  DemoModeSchema,
  WorkflowSnapshotSchema,
  type WorkflowSnapshot,
} from "../workflow/contracts.js";
import {
  ExecutionClassificationSchema,
  MigrationPackageDraftSchema,
} from "../workflow/migration-draft.js";

export const MAX_RUN_ENVELOPE_BYTES = 4_194_304;
export const MAX_RETRY_RESERVATION_BYTES = 2_048;
export const MAX_VIRTUAL_ARTIFACT_BYTES = 524_288;
export const SafeRunIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u);
export type SafeRunId = z.infer<typeof SafeRunIdSchema>;
export function assertSafeRunId(runId: string): void {
  try {
    SafeRunIdSchema.parse(runId);
  } catch {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The run ID is invalid.");
  }
}

export const virtualArtifactFilenames = [
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
] as const;
export type VirtualArtifactFilename = (typeof virtualArtifactFilenames)[number];

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ArtifactBodySchema = z.string().superRefine((value, context) => {
  if (Buffer.byteLength(value, "utf8") > MAX_VIRTUAL_ARTIFACT_BYTES) {
    context.addIssue({ code: "custom", message: "Artifact exceeds the byte limit." });
  }
});
const ArtifactFilesSchema = z
  .object({
    "migration-up.sql": ArtifactBodySchema,
    "migration-down.sql": ArtifactBodySchema,
    "validation.sql": ArtifactBodySchema,
    "rollout-plan.md": ArtifactBodySchema,
  })
  .strict();
const ArtifactHashesSchema = z
  .object({
    "migration-up.sql": Sha256Schema,
    "migration-down.sql": Sha256Schema,
    "validation.sql": Sha256Schema,
    "rollout-plan.md": Sha256Schema,
  })
  .strict();
export const PersistedFindingSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u),
    message: z.string().min(1).max(500),
    filename: z.enum(virtualArtifactFilenames).optional(),
  })
  .strict();
const LegacyImpactStatusSchema = z.enum([
  "COMPLETED",
  "COMPLETED_WITH_LIMITATIONS",
  "INSUFFICIENT_METADATA",
  "INCOMPLETE_EVIDENCE",
]);
const TerminalGenerationAttemptSchema = z.union([z.literal(1), z.literal(2)]);
const StoredHashesSchema = z
  .object({
    snapshot: Sha256Schema,
    context: Sha256Schema.optional(),
    draft: Sha256Schema.optional(),
    findings: Sha256Schema,
    artifacts: ArtifactHashesSchema.optional(),
  })
  .strict();

const CompletedRunEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("completed"),
    runId: SafeRunIdSchema,
    mode: DemoModeSchema,
    parentRunId: SafeRunIdSchema.optional(),
    generationAttempt: TerminalGenerationAttemptSchema,
    snapshot: WorkflowSnapshotSchema,
    context: ChangeContextSchema,
    draft: MigrationPackageDraftSchema,
    findings: z.array(PersistedFindingSchema).max(200),
    package: z
      .object({
        classification: ExecutionClassificationSchema,
        files: ArtifactFilesSchema,
      })
      .strict(),
    hashes: StoredHashesSchema,
  })
  .strict()
  .superRefine(assertCompletedEnvelopeInvariants);

const FailedRunEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("failed"),
    runId: SafeRunIdSchema,
    mode: DemoModeSchema,
    parentRunId: SafeRunIdSchema.optional(),
    generationAttempt: TerminalGenerationAttemptSchema,
    snapshot: WorkflowSnapshotSchema,
    context: ChangeContextSchema.optional(),
    draft: MigrationPackageDraftSchema.optional(),
    findings: z.array(PersistedFindingSchema).max(200),
    hashes: StoredHashesSchema,
  })
  .strict()
  .superRefine(assertFailedEnvelopeInvariants);

const ImpactReportEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("impact-report"),
    runId: SafeRunIdSchema,
    status: LegacyImpactStatusSchema,
    report: ArtifactBodySchema,
    hashes: z.object({ report: Sha256Schema }).strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (sha256(value.report) !== value.hashes.report) {
      context.addIssue({ code: "custom", message: "Impact report hash mismatch." });
    }
  });

export const RunEnvelopeSchema = z.discriminatedUnion("kind", [
  CompletedRunEnvelopeSchema,
  FailedRunEnvelopeSchema,
  ImpactReportEnvelopeSchema,
]);
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;

export const RetryReservationEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("retry-reservation"),
    parentRunId: SafeRunIdSchema,
    childRunId: SafeRunIdSchema,
    childMode: DemoModeSchema,
    generationAttempt: z.literal(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.parentRunId === value.childRunId) {
      context.addIssue({ code: "custom", message: "Parent and child run IDs must differ." });
    }
  });
export type RetryReservationEnvelope = z.infer<typeof RetryReservationEnvelopeSchema>;
```

Implement `sha256(value)` with `createHash("sha256").update(value, "utf8").digest("hex")`.
Implement `canonicalJson(schema, value)` as the UTF-8 hash input
`` `${JSON.stringify(schema.parse(value), null, 2)}\n` ``. Implement
`assertCompletedEnvelopeInvariants` and `assertFailedEnvelopeInvariants` as
`z.RefinementCtx` callbacks with these exact checks:

- snapshot run ID, mode, and parent must equal the envelope fields;
- root envelopes have `generationAttempt: 1`; child envelopes have `generationAttempt: 2`;
- `snapshot.status` is `COMPLETED` only for the completed variant and is a terminal non-completed
  status only for the failed variant;
- `snapshot.contextHash` equals the validated `context.contextHash` whenever context is present;
- completed envelopes have exactly four sorted, unique, validated snapshot artifact entries whose
  filenames and SHA-256 values match `package.files`;
- failed envelopes have zero snapshot artifacts and no `package`;
- `hashes.context` and `hashes.draft` are present exactly when their sections are present;
- `hashes.artifacts` is present only for completed envelopes;
- snapshot, context, draft, findings, and artifact hashes match `canonicalJson` or the raw artifact
  body as applicable;
- findings are canonical-sort ordered by code, filename, then message, contain no duplicate tuple,
  and agree with `snapshot.validation.findingCount` and its sorted unique first-20 finding codes;
- package classification equals both `draft.executionClassification` and
  `snapshot.executionClassification`.

Use a module-local set of non-terminal workflow states matching
`DRAFT`, `RESOLVING_CONTEXT`, `ANALYZING_IMPACT`, `GENERATING_ARTIFACTS`, and
`VALIDATING_ARTIFACTS`. Every nested envelope section is rebuilt through the strict imported or
local schema shown above.

Implement:

```ts
export function serializeRunEnvelope(value: RunEnvelope): string {
  const parsed = RunEnvelopeSchema.parse(value);
  const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
  assertEnvelopeByteLimit(serialized);
  return serialized;
}

export function assertEnvelopeByteLimit(raw: string): void {
  if (Buffer.byteLength(raw, "utf8") > MAX_RUN_ENVELOPE_BYTES) throw storageError();
}

export function parseRunEnvelope(raw: string, expectedRunId: string): RunEnvelope {
  assertEnvelopeByteLimit(raw);
  try {
    SafeRunIdSchema.parse(expectedRunId);
    const parsed = RunEnvelopeSchema.parse(JSON.parse(raw));
    if (parsed.runId !== expectedRunId) throw new Error("Run mismatch.");
    return parsed;
  } catch {
    throw storageError();
  }
}

export function serializeRetryReservation(value: RetryReservationEnvelope): string {
  const serialized = `${JSON.stringify(RetryReservationEnvelopeSchema.parse(value), null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RETRY_RESERVATION_BYTES) throw storageError();
  return serialized;
}

export function parseRetryReservation(
  raw: string,
  expectedParentRunId: string,
): RetryReservationEnvelope {
  if (Buffer.byteLength(raw, "utf8") > MAX_RETRY_RESERVATION_BYTES) throw storageError();
  try {
    SafeRunIdSchema.parse(expectedParentRunId);
    const parsed = RetryReservationEnvelopeSchema.parse(JSON.parse(raw));
    if (parsed.parentRunId !== expectedParentRunId) throw new Error("Reservation mismatch.");
    return parsed;
  } catch {
    throw storageError();
  }
}
```

`storageError()` must return a fresh `AppError("ARTIFACT_WRITE_FAILED", "The stored run is
unavailable.")` without cause, native path, or raw data.

Modify `.gitignore` from `runs/` to `/runs/` so `src/runs/` participates in normal formatting,
linting, staging, and repository discovery.

- [ ] **Step 4: Run Task 1 tests and repository type checks**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/runs/run-envelope.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
```

Expected: the envelope tests pass; typecheck and formatting pass; lint exits zero with only the
existing `prettier.config.mjs` warning.

- [ ] **Step 5: Commit the envelope contract**

```powershell
git add .gitignore src/runs/run-envelope.ts src/runs/run-envelope.test.ts
git commit -m "feat: define immutable run envelopes"
```

---

### Task 2: Publish and Read Flat Envelopes Atomically

**Files:**

- Create: `src/artifacts/run-envelope-files.ts`
- Create: `src/artifacts/run-envelope-files.test.ts`
- Modify: `src/errors/app-error.ts`
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

**Interfaces:**

- Consumes: serialized terminal and reservation envelopes from Task 1.
- Produces: `assertTrustedRunsRoot(runsRoot)`, `publishRunEnvelope(options)`,
  `readRunEnvelope(options)`, `publishRetryReservation(options)`,
  `readRetryReservation(options)`, typed `CANCELLED` application errors, stable CLI cancellation
  mapping, and test-only publication hooks.

- [ ] **Step 1: Write failing atomicity, bounded-read, and cleanup tests**

Create tests that use an already-created temporary runs root and real barriers:

```ts
it("lets exactly one concurrent final publication win", async () => {
  const first = serializeRunEnvelope(makeCompletedEnvelope({ runId: "run-1" }));
  const second = serializeRunEnvelope(makeFailedEnvelope({ runId: "run-1" }));
  const results = await Promise.allSettled([
    publishRunEnvelope({ runsRoot, runId: "run-1", serialized: first }),
    publishRunEnvelope({ runsRoot, runId: "run-1", serialized: second }),
  ]);
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  expect((await readRunEnvelope({ runsRoot, runId: "run-1" })).runId).toBe("run-1");
});

it("exposes no final run when publication fails before link", async () => {
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
  });
  await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).rejects.toMatchObject({
    message: "The stored run is unavailable.",
  });
  expect(await listTemporaryFiles(runsRoot)).toEqual([]);
});

it("keeps the complete run authoritative after link", async () => {
  const controller = new AbortController();
  await publishRunEnvelope({
    runsRoot,
    runId: "run-1",
    serialized,
    signal: controller.signal,
    hooks: { afterPublish: () => controller.abort(new Error("secret-abort-reason")) },
  });
  await expect(readRunEnvelope({ runsRoot, runId: "run-1" })).resolves.toMatchObject({
    runId: "run-1",
  });
});
```

Also test: missing root, symlink/junction root, pre-existing final regular file/symlink/directory,
temporary-name collision, short writes, maximum and maximum-plus-one bytes, truncated JSON,
non-regular final entry, secret-bearing filesystem errors, cancellation before publication,
post-link temporary cleanup failure, and a competitor replacing a temporary name. Cleanup must
never unlink a final name or a temporary name whose recorded identity no longer matches.

Add a CLI regression test whose analysis dependency throws
`new AppError("CANCELLED", "The run was cancelled.")` while a secret-bearing abort reason exists
only in the test setup. Assert exit code `130`, the fixed cancellation message and recovery
guidance, and absence of the secret-bearing reason.

- [ ] **Step 2: Run focused tests and prove RED**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/artifacts/run-envelope-files.test.ts
```

Expected: FAIL because `run-envelope-files.ts` does not exist.

- [ ] **Step 3: Implement the flat trusted-root boundary**

Implement exact direct-child names:

```ts
const runFilename = (runId: string): string => `run-${runId}.json`;
const reservationFilename = (parentRunId: string): string => `retry-${parentRunId}.json`;
const temporaryFilename = (kind: "run" | "retry", nonce: string): string =>
  `.tmp-${kind}-${nonce}.json`;
```

Use these exact boundary types:

```ts
export interface RunEnvelopePublicationHooks {
  readonly beforePublish?: () => void | Promise<void>;
  readonly afterPublish?: () => void | Promise<void>;
}

export async function assertTrustedRunsRoot(runsRoot: string): Promise<string>;

export async function publishRunEnvelope(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly serialized: string;
  readonly signal?: AbortSignal;
  readonly hooks?: RunEnvelopePublicationHooks;
}): Promise<void>;

export async function readRunEnvelope(options: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<RunEnvelope>;

export async function publishRetryReservation(options: {
  readonly runsRoot: string;
  readonly parentRunId: string;
  readonly serialized: string;
  readonly signal?: AbortSignal;
  readonly hooks?: RunEnvelopePublicationHooks;
}): Promise<void>;

export async function readRetryReservation(options: {
  readonly runsRoot: string;
  readonly parentRunId: string;
}): Promise<RetryReservationEnvelope>;
```

`assertTrustedRunsRoot` must require an absolute pre-existing regular directory, reject
symlink/junction roots with `lstat`, resolve it once, require `relative(configured, canonical) ===
""`, verify write access, and return the canonical root. It must never create the root. Validate
every ID with `SafeRunIdSchema` before constructing a direct-child filename.

`publishRunEnvelope` must call `parseRunEnvelope(serialized, runId)` before filesystem access.
`publishRetryReservation` must call `parseRetryReservation(serialized, parentRunId)` before
filesystem access. Attempt at most three exclusive temporary-file creations with fresh
cryptographic nonces; exhaustion becomes the same fixed write failure without exposing a nonce or
path. Tests may inject a deterministic nonce source and file-operation seams through a
module-private factory exported only under `__testOnly`; production exports always bind the real
`node:fs/promises` operations.

Implement one internal `publishCreateOnly`:

```ts
const handle = await open(temporaryPath, "wx", 0o600);
try {
  throwIfCancelled(signal);
  const result = await handle.write(serialized, 0, "utf8");
  if (result.bytesWritten !== Buffer.byteLength(serialized, "utf8"))
    throw new Error("Short write.");
  await handle.sync();
  throwIfCancelled(signal);
  await hooks?.beforePublish?.();
  throwIfCancelled(signal);
  await link(temporaryPath, finalPath);
  published = true;
  try {
    await hooks?.afterPublish?.();
  } catch {
    // A published immutable envelope remains authoritative.
  }
} finally {
  await handle.close().catch(() => undefined);
  await removeOwnTemporaryFileByIdentity(temporaryPath, temporaryIdentity).catch(() => undefined);
}
```

Capture the temporary file's `dev` and `ino` immediately after opening. Cleanup must `lstat` and
unlink only when both values still match and the entry is a regular file. Any final-name collision
must become `AppError("ARTIFACT_WRITE_FAILED", "The run already exists.")` for terminal runs and
`AppError("INVALID_REQUEST", "The parent run cannot be regenerated.")` for reservations.
`throwIfCancelled` must throw `AppError("CANCELLED", "The run was cancelled.")` and must not
rethrow `signal.reason`. All other publication failures become
`AppError("ARTIFACT_WRITE_FAILED", "Unable to persist the run.")` without details or cause.

Advance the already-approved `CANCELLED` portion of the main plan's Task 9 contract so this boundary
remains strictly typed:

```ts
// src/errors/app-error.ts
export type AppErrorCode =
  | "INVALID_REQUEST"
  | "TARGET_NOT_FOUND"
  | "NEEDS_USER_CLARIFICATION"
  | "COLUMN_NOT_FOUND"
  | "DATAHUB_UNAVAILABLE"
  | "MCP_UNAVAILABLE"
  | "ARTIFACT_WRITE_FAILED"
  | "CANCELLED";

// src/cli.ts
const guidance = {
  // Preserve every existing entry.
  CANCELLED: "The operation was cancelled. Retry when ready.",
} as const;

const exitCodes = {
  // Preserve every existing entry.
  CANCELLED: 130,
} as const satisfies Readonly<Record<AppErrorCode, number>>;
```

Keep the CLI maps exhaustive; do not use `Partial`, a cast, or a catch-all code. Task 9 later adds
only its still-missing `GENERATION_FAILED` entry and retains this cancellation mapping.

Bound reads by checking the final entry with `lstat` before opening, then requiring a regular-file
`FileHandle.stat()`, checking the applicable run or reservation byte limit, reading at most
maximum-plus-one bytes through that handle, and calling the matching strict parser. Do not follow a
symlink or fall back to any other file. Every read failure returns only the matching fixed
unavailable error.

- [ ] **Step 4: Run focused and affected tests**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/artifacts/run-envelope-files.test.ts src/cli.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
```

Expected: atomicity, byte limits, cleanup identity, fixed errors, and compatibility tests pass.

- [ ] **Step 5: Commit the filesystem boundary**

```powershell
git add src/artifacts/run-envelope-files.ts src/artifacts/run-envelope-files.test.ts src/errors/app-error.ts src/cli.ts src/cli.test.ts
git commit -m "feat: publish flat run envelopes atomically"
```

---

### Task 3: Refactor Run Persistence, Reload, Downloads, and Retry Reservation

**Files:**

- Modify: `src/runs/run-store.ts`
- Modify: `src/runs/run-store.test.ts`
- Modify: `src/security/sanitize-validation-findings.ts`
- Modify: `src/security/sanitize-validation-findings.test.ts`

**Interfaces:**

- Consumes: strict envelopes and flat publication from Tasks 1–2.
- Produces: `persistCompletedRun`, `persistFailedRun`, `loadRunSnapshot`,
  `loadRegenerationContext`, `readCompletedPackageFile`, `reserveGenerationRetry`, and mandatory
  `ReservedChildRun`.

- [ ] **Step 1: Replace directory-layout tests with envelope behavior tests**

The focused suite must prove:

```ts
await persistCompletedRun(completedInput);
await expect(loadRunSnapshot({ runsRoot, runId })).resolves.toEqual(completedInput.snapshot);
for (const filename of virtualArtifactFilenames) {
  await expect(readCompletedPackageFile({ runsRoot, runId, filename })).resolves.toBe(
    completedInput.rendered.files[filename],
  );
}
expect(await readdir(runsRoot)).toEqual([`run-${runId}.json`]);
```

Add negative tests for completed/failed cross-field contradictions, missing and extra artifacts,
tampered context/draft/finding/snapshot/artifact hashes, mode mismatch, parent mismatch, ineligible
regeneration status, generation-attempt mismatch, malformed or oversized final envelope, public
request for a private section, and no fallback after integrity failure.

Race two `reserveGenerationRetry` calls for the same parent and prove one immutable reservation
wins. Require the returned `ReservedChildRun` for every child completed or failed persistence call.
Reject a forged object, wrong root, parent, child, mode, or attempt. A failed downstream child run
must not release the parent reservation.

- [ ] **Step 2: Run focused tests and prove RED against the directory store**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/runs/run-store.test.ts src/security/sanitize-validation-findings.test.ts
```

Expected: FAIL because the current store creates nested directories and manifest files.

- [ ] **Step 3: Rebuild terminal envelopes before publication**

`persistCompletedRun` and `persistFailedRun` must validate and sanitize all inputs first, build one
strict envelope, serialize it within limits, and call `publishRunEnvelope` exactly once. They must
not create diagnostic files incrementally.

Use these public signatures and keep `reservedChildBrand` module-local:

```ts
export async function persistCompletedRun(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly context: ChangeContext;
  readonly draft: MigrationPackageDraft;
  readonly rendered: RenderedMigrationPackage;
  readonly snapshot: WorkflowSnapshot;
  readonly signal?: AbortSignal;
  readonly reservedChild?: ReservedChildRun;
  readonly hooks?: RunEnvelopePublicationHooks;
}): Promise<WorkflowSnapshot>;

export async function persistFailedRun(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly snapshot: WorkflowSnapshot;
  readonly secrets: readonly string[];
  readonly context?: ChangeContext;
  readonly draft?: MigrationPackageDraft;
  readonly findings?: readonly PackageFinding[];
  readonly signal?: AbortSignal;
  readonly reservedChild?: ReservedChildRun;
  readonly hooks?: RunEnvelopePublicationHooks;
}): Promise<void>;

export async function loadRunSnapshot(input: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<WorkflowSnapshot>;

export async function loadRegenerationContext(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly expectedMode: DemoMode;
}): Promise<{ readonly snapshot: WorkflowSnapshot; readonly context: ChangeContext }>;

export async function readCompletedPackageFile(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: VirtualArtifactFilename;
}): Promise<string>;

export async function reserveGenerationRetry(input: {
  readonly runsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly signal?: AbortSignal;
  readonly hooks?: RunEnvelopePublicationHooks;
}): Promise<ReservedChildRun>;

const reservedChildBrand: unique symbol = Symbol("reserved-child-run");

export interface ReservedChildRun {
  readonly canonicalRunsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly childMode: DemoMode;
  readonly generationAttempt: 2;
  readonly [reservedChildBrand]: true;
}
```

The reservation function must read and validate the eligible parent first, build the strict
reservation envelope with `childMode: parent.snapshot.mode` and `generationAttempt: 2`, and publish
it with `publishRetryReservation`. The branded handle is created only after publication. Child
persistence requires it whenever `snapshot.parentRunId` exists, verifies all five public fields plus
the private brand, and rejects it for root runs. A root envelope records lineage generation attempt
`1`; the reserved child records `2`. Neither value is compared with
`snapshot.agent.generationAttempts`, which is the independent per-run model-call count.

`loadRunSnapshot`, regeneration loading, and artifact downloads must read one envelope once per
operation, validate all hashes and invariants, and return only the requested value. Collapse JSON,
Zod, hash, filesystem, status, and mode errors to fixed public messages.

Update `sanitizeValidationFindings` so its final output is non-empty-message only, canonical-sort
ordered by code, filename, then message, deduplicated by that complete tuple, and capped at 200
after validation and deduplication. Add positive, duplicate, empty-after-sanitization, 200, and 201
input tests; the output must always satisfy `PersistedFindingSchema`.

- [ ] **Step 4: Run Task 3 and regression tests**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/runs/run-envelope.test.ts src/artifacts/run-envelope-files.test.ts src/runs/run-store.test.ts src/security/sanitize-validation-findings.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
```

Expected: all flat-storage, integrity, regeneration, reservation, and finding tests pass.

- [ ] **Step 5: Commit the run store**

```powershell
git add src/runs/run-store.ts src/runs/run-store.test.ts src/security/sanitize-validation-findings.ts src/security/sanitize-validation-findings.test.ts
git commit -m "feat: persist terminal runs as flat envelopes"
```

---

### Task 4: Update CLI Compatibility and Operator Contract

**Files:**

- Modify: `src/artifacts/write-run-artifacts.ts`
- Modify: `src/artifacts/write-run-artifacts.test.ts`
- Modify: `src/app/run-impact-analysis.ts`
- Modify: `src/app/run-impact-analysis.test.ts`
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/architecture/agent-demo.md` if it exists; otherwise create it.

**Interfaces:**

- Consumes: the virtual impact-report compatibility envelope and run-store APIs.
- Produces: `writeRunArtifact(options)`, `readImpactReport(options)`, path-free CLI output, and
  documented trusted-root deployment requirements.

- [ ] **Step 1: Write failing compatibility and disclosure tests**

Update CLI and application tests to prove:

```ts
expect(result).toMatchObject({
  status: "COMPLETED",
  runId: expect.any(String),
  artifactFilename: "impact-report.md",
});
expect(stdout).toContain("Report: impact-report.md");
expect(stdout).not.toContain(runsRoot);
expect(stderr).not.toContain(runsRoot);
```

Capture stdout, stderr, thrown public errors, stored envelope JSON, and any NDJSON test sink using a
recognizable absolute root and secret-bearing custom abort reason. Assert neither value appears.
Prove the compatibility reader returns the same sanitized impact report bytes from the virtual
filename.

- [ ] **Step 2: Run focused tests and prove RED**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/artifacts/write-run-artifacts.test.ts src/app/run-impact-analysis.test.ts src/cli.test.ts
```

Expected: FAIL because the application result still exposes `artifactPath` and existing tests expect
a native path.

- [ ] **Step 3: Replace the public path with a virtual filename**

Replace `write-run-artifacts.ts` with a compatibility facade whose exported safe run-ID validation
delegates to Task 1. Remove `readRunArtifact`, directory package commit/read functions, and every
native-path return value. Use these exact exports:

```ts
export { assertSafeRunId } from "../runs/run-envelope.js";

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
  readonly status:
    "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "INSUFFICIENT_METADATA" | "INCOMPLETE_EVIDENCE";
  readonly signal?: AbortSignal;
}): Promise<"impact-report.md">;

export async function readImpactReport(options: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<string>;
```

`writeRunArtifact` builds, serializes, and publishes the strict `impact-report` envelope from Task

1. `readImpactReport` accepts only a verified `impact-report` envelope and returns its bounded
   sanitized `report`; every other variant returns the fixed unavailable error. Tests must assert the
   virtual filename result `"impact-report.md"` and one flat `run-<runId>.json` final entry.

Rename `artifactPath` to `artifactFilename` in the application and CLI result contracts. The only
successful value for the existing impact-analysis CLI is `"impact-report.md"`. CLI output must be:

```text
Status: <sanitized-status>
Run ID: <sanitized-run-id>
Report: impact-report.md
```

No application response may return a storage-root or final-envelope path.

Remove `attemptedPath` from `AnalysisOutcome` and from `ImpactReportPersistenceError`. Replace it
with the fixed virtual `artifactFilename: "impact-report.md"` and do not attach a native path in
`AppError` details. Pass `outcome.report.status` to `writeRunArtifact`. Use `readImpactReport` in the
compatibility test; no generic filename or path-based reader is reintroduced.

Document:

- `LINEAGEGUARD_RUNS_DIR` must be a pre-created real directory;
- it must be app-owned and protected from untrusted writers by OS permissions;
- the application rejects symlink/junction roots and never creates the root;
- artifacts are virtual values inside immutable envelopes;
- no migration is required because the format has not shipped.

Keep `.env.example` free of secrets and use only a documented non-secret example path.

- [ ] **Step 4: Run complete offline verification**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/runs/run-envelope.test.ts src/artifacts/run-envelope-files.test.ts src/artifacts/write-run-artifacts.test.ts src/runs/run-store.test.ts src/security/sanitize-validation-findings.test.ts src/app/run-impact-analysis.test.ts src/cli.test.ts
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build:cli
pnpm test
git diff --check
```

Expected: focused storage and compatibility files are listed and pass; the full offline suite passes;
format, lint, typecheck, CLI build, and diff checks exit zero. Lint may retain only the accepted
`prettier.config.mjs` warning.

Run a targeted credential/path scan over the changed files and verify no secret material, raw
native root, or custom abort reason is persisted in fixtures or repository content.

- [ ] **Step 5: Commit the compatibility and documentation update**

```powershell
git add src/artifacts/write-run-artifacts.ts src/artifacts/write-run-artifacts.test.ts src/app/run-impact-analysis.ts src/app/run-impact-analysis.test.ts src/cli.ts src/cli.test.ts .env.example README.md docs/architecture/agent-demo.md
git commit -m "feat: expose virtual impact report artifacts"
```

After this commit, generate one cumulative review package from the commit before Task 1 through Task
4 HEAD. A fresh senior reviewer must approve the complete amended Task 6 boundary before the main
Next.js/OpenAI plan resumes at Task 7.
