import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { ChangeContextSchema, type ChangeContext } from "../workflow/change-context.js";
import {
  DemoModeSchema,
  type DemoMode,
  WorkflowSnapshotSchema,
  type WorkflowSnapshot,
} from "../workflow/contracts.js";
import {
  ExecutionClassificationSchema,
  MigrationPackageDraftSchema,
  type MigrationPackageDraft,
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

type ArtifactFiles = z.infer<typeof ArtifactFilesSchema>;
type PersistedFinding = z.infer<typeof PersistedFindingSchema>;
type StoredHashes = z.infer<typeof StoredHashesSchema>;

type CompletedRunEnvelopeValue = {
  readonly runId: string;
  readonly mode: DemoMode;
  readonly parentRunId?: string | undefined;
  readonly generationAttempt: 1 | 2;
  readonly snapshot: WorkflowSnapshot;
  readonly context: ChangeContext;
  readonly draft: MigrationPackageDraft;
  readonly findings: PersistedFinding[];
  readonly package: {
    readonly classification: z.infer<typeof ExecutionClassificationSchema>;
    readonly files: ArtifactFiles;
  };
  readonly hashes: StoredHashes;
};

type FailedRunEnvelopeValue = {
  readonly runId: string;
  readonly mode: DemoMode;
  readonly parentRunId?: string | undefined;
  readonly generationAttempt: 1 | 2;
  readonly snapshot: WorkflowSnapshot;
  readonly context?: ChangeContext | undefined;
  readonly draft?: MigrationPackageDraft | undefined;
  readonly findings: PersistedFinding[];
  readonly hashes: StoredHashes;
};

const nonTerminalWorkflowStates = new Set([
  "DRAFT",
  "RESOLVING_CONTEXT",
  "ANALYZING_IMPACT",
  "GENERATING_ARTIFACTS",
  "VALIDATING_ARTIFACTS",
]);

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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(schema: z.ZodType, value: unknown): string {
  return `${JSON.stringify(schema.parse(value), null, 2)}\n`;
}

function addInvariantIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: "custom", message });
}

function isCanonicalFindingOrder(findings: readonly PersistedFinding[]): boolean {
  return findings.every((finding, index) => {
    if (index === 0) return true;
    const previous = findings[index - 1]!;
    const tuple = [finding.code, finding.filename ?? "", finding.message];
    const previousTuple = [previous.code, previous.filename ?? "", previous.message];
    return tuple.some((value, tupleIndex) => {
      const comparison = previousTuple[tupleIndex]!.localeCompare(value, "en");
      return (
        comparison < 0 &&
        tuple.slice(0, tupleIndex).every((item, index) => item === previousTuple[index])
      );
    });
  });
}

function assertCommonEnvelopeInvariants(
  value: Pick<
    CompletedRunEnvelopeValue | FailedRunEnvelopeValue,
    | "runId"
    | "mode"
    | "parentRunId"
    | "generationAttempt"
    | "snapshot"
    | "context"
    | "draft"
    | "findings"
    | "hashes"
  >,
  context: z.RefinementCtx,
): void {
  const snapshotMatchesEnvelope =
    value.snapshot.runId === value.runId &&
    value.snapshot.mode === value.mode &&
    value.snapshot.parentRunId === value.parentRunId;
  if (!snapshotMatchesEnvelope)
    addInvariantIssue(context, "Snapshot lineage does not match the envelope.");
  if ((value.parentRunId === undefined) !== (value.generationAttempt === 1))
    addInvariantIssue(context, "Generation attempt does not match the envelope lineage.");
  if (value.context !== undefined && value.snapshot.contextHash !== value.context.contextHash)
    addInvariantIssue(context, "Snapshot context hash does not match the context.");
  if ((value.hashes.context !== undefined) !== (value.context !== undefined))
    addInvariantIssue(context, "Context hash presence is inconsistent.");
  if ((value.hashes.draft !== undefined) !== (value.draft !== undefined))
    addInvariantIssue(context, "Draft hash presence is inconsistent.");
  if (sha256(canonicalJson(WorkflowSnapshotSchema, value.snapshot)) !== value.hashes.snapshot)
    addInvariantIssue(context, "Snapshot hash mismatch.");
  if (
    value.context !== undefined &&
    sha256(canonicalJson(ChangeContextSchema, value.context)) !== value.hashes.context
  )
    addInvariantIssue(context, "Context hash mismatch.");
  if (
    value.draft !== undefined &&
    sha256(canonicalJson(MigrationPackageDraftSchema, value.draft)) !== value.hashes.draft
  )
    addInvariantIssue(context, "Draft hash mismatch.");
  if (
    sha256(canonicalJson(z.array(PersistedFindingSchema), value.findings)) !== value.hashes.findings
  )
    addInvariantIssue(context, "Findings hash mismatch.");

  const findingTuples = value.findings.map(({ code, filename, message }) =>
    JSON.stringify([code, filename ?? "", message]),
  );
  const sortedFindingCodes = [...new Set(value.findings.map(({ code }) => code))].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  const findingsMatchSnapshot =
    isCanonicalFindingOrder(value.findings) &&
    new Set(findingTuples).size === findingTuples.length &&
    value.snapshot.validation?.findingCount === value.findings.length &&
    value.snapshot.validation.findingCodes.length === Math.min(sortedFindingCodes.length, 20) &&
    value.snapshot.validation.findingCodes.every(
      (code, index) => code === sortedFindingCodes[index],
    );
  if (!findingsMatchSnapshot) addInvariantIssue(context, "Findings do not match the snapshot.");
}

function assertCompletedEnvelopeInvariants(
  value: CompletedRunEnvelopeValue,
  context: z.RefinementCtx,
): void {
  assertCommonEnvelopeInvariants(value, context);
  if (value.snapshot.status !== "COMPLETED")
    addInvariantIssue(context, "Completed envelopes require a completed snapshot.");
  if (value.hashes.artifacts === undefined)
    addInvariantIssue(context, "Completed envelopes require artifact hashes.");

  const artifactEntries = value.snapshot.artifacts;
  const artifactNames = artifactEntries.map(({ filename }) => filename);
  const artifactEntriesAreValid =
    artifactEntries.length === virtualArtifactFilenames.length &&
    new Set(artifactNames).size === virtualArtifactFilenames.length &&
    artifactNames.every((filename, index) =>
      index === 0 ? true : artifactNames[index - 1]!.localeCompare(filename, "en") < 0,
    ) &&
    artifactEntries.every(
      ({ filename, sha256: artifactHash, validated }) =>
        validated && artifactHash === sha256(value.package.files[filename]),
    );
  if (!artifactEntriesAreValid)
    addInvariantIssue(context, "Completed snapshot artifacts are inconsistent.");
  if (
    value.hashes.artifacts !== undefined &&
    virtualArtifactFilenames.some(
      (filename) => value.hashes.artifacts![filename] !== sha256(value.package.files[filename]),
    )
  )
    addInvariantIssue(context, "Artifact hash mismatch.");
  if (
    value.package.classification !== value.draft.executionClassification ||
    value.package.classification !== value.snapshot.executionClassification
  )
    addInvariantIssue(context, "Package classification is inconsistent.");
}

function assertFailedEnvelopeInvariants(
  value: FailedRunEnvelopeValue,
  context: z.RefinementCtx,
): void {
  assertCommonEnvelopeInvariants(value, context);
  if (value.snapshot.status === "COMPLETED" || nonTerminalWorkflowStates.has(value.snapshot.status))
    addInvariantIssue(context, "Failed envelopes require a terminal failed snapshot.");
  if (value.snapshot.artifacts.length !== 0)
    addInvariantIssue(context, "Failed envelopes cannot contain snapshot artifacts.");
  if (value.hashes.artifacts !== undefined)
    addInvariantIssue(context, "Failed envelopes cannot contain artifact hashes.");
}

function storageError(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The stored run is unavailable.");
}

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
