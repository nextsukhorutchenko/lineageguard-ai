import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertTrustedRunsRoot,
  publishRetryReservation,
  publishRunEnvelope,
  readRunEnvelope,
  type RunEnvelopePublicationHooks,
} from "../artifacts/run-envelope-files.js";
import { AppError } from "../errors/app-error.js";
import type { RenderedMigrationPackage } from "../migrations/render-snowflake-package.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import { sanitizeValidationFindings } from "../security/sanitize-validation-findings.js";
import { sanitizeBoundaryText } from "../security/sanitize-output.js";
import {
  ChangeContextSchema,
  hashChangeContext,
  type ChangeContext,
} from "../workflow/change-context.js";
import {
  DemoModeSchema,
  WorkflowSnapshotSchema,
  type DemoMode,
  type WorkflowSnapshot,
} from "../workflow/contracts.js";
import {
  ExecutionClassificationSchema,
  MigrationPackageDraftSchema,
  type MigrationPackageDraft,
} from "../workflow/migration-draft.js";
import {
  PersistedFindingSchema,
  RunEnvelopeSchema,
  SafeRunIdSchema,
  serializeRetryReservation,
  serializeRunEnvelope,
  virtualArtifactFilenames,
  type RunEnvelope,
  type VirtualArtifactFilename,
} from "./run-envelope.js";

const reservedChildBrand: unique symbol = Symbol("reserved-child-run");
const reservedChildHandles = new WeakSet<object>();
const eligibleRegenerationStatuses = new Set([
  "COMPLETED",
  "GENERATION_FAILED",
  "VALIDATION_FAILED",
]);

const ArtifactFilesSchema = z
  .object({
    "migration-up.sql": z.string(),
    "migration-down.sql": z.string(),
    "validation.sql": z.string(),
    "rollout-plan.md": z.string(),
  })
  .strict();
const RenderedMigrationPackageSchema = z
  .object({
    classification: ExecutionClassificationSchema,
    files: ArtifactFilesSchema,
  })
  .strict();
const PersistedFindingsSchema = z.array(PersistedFindingSchema).max(200);

export interface ReservedChildRun {
  readonly canonicalRunsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly childMode: DemoMode;
  readonly generationAttempt: 2;
  readonly [reservedChildBrand]: true;
}

interface ReservationFieldCandidate {
  readonly canonicalRunsRoot: unknown;
  readonly parentRunId: unknown;
  readonly childRunId: unknown;
  readonly childMode: unknown;
  readonly generationAttempt: unknown;
}

interface ExpectedReservationFields {
  readonly canonicalRunsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly childMode: DemoMode;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(schema: z.ZodType, value: unknown): string {
  return `${JSON.stringify(schema.parse(value), null, 2)}\n`;
}

function storageUnavailable(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The stored run is unavailable.");
}

function completedRunInconsistent(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The completed run is inconsistent.");
}

function failedRunInconsistent(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The failed run is inconsistent.");
}

function invalidReservation(): AppError {
  return new AppError("INVALID_REQUEST", "The child run has not been reserved.");
}

function invalidRegenerationParent(): AppError {
  return new AppError("INVALID_REQUEST", "The parent run cannot be regenerated.");
}

function validationSummary(findings: readonly PackageFinding[]): {
  readonly findingCount: number;
  readonly findingCodes: readonly string[];
} {
  const findingCodes = [...new Set(findings.map(({ code }) => code))]
    .sort((left, right) => left.localeCompare(right, "en"))
    .slice(0, 20);
  return { findingCount: findings.length, findingCodes };
}

function assertContextIntegrity(context: ChangeContext): void {
  const { contextHash, ...payload } = context;
  if (hashChangeContext(payload) !== contextHash) throw new Error("Context hash mismatch.");
}

function assertSnapshotStringsAreBoundarySafe(
  snapshot: WorkflowSnapshot,
  secrets: readonly string[],
): void {
  const pending: unknown[] = [snapshot];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (sanitizeBoundaryText(value, secrets, Number.MAX_SAFE_INTEGER) !== value) {
        throw new Error("Snapshot string is not boundary-safe.");
      }
      continue;
    }
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (value !== null && typeof value === "object") {
      pending.push(...Object.values(value));
    }
  }
}

function reservationFieldsMatch(
  candidate: ReservationFieldCandidate,
  expected: ExpectedReservationFields,
): boolean {
  return (
    candidate.canonicalRunsRoot === expected.canonicalRunsRoot &&
    candidate.parentRunId === expected.parentRunId &&
    candidate.childRunId === expected.childRunId &&
    candidate.childMode === expected.childMode &&
    candidate.generationAttempt === 2
  );
}

async function generationAttemptForSnapshot(
  runsRoot: string,
  runId: string,
  snapshot: WorkflowSnapshot,
  reservedChild: ReservedChildRun | undefined,
): Promise<1 | 2> {
  if (snapshot.parentRunId === undefined) {
    if (reservedChild !== undefined) throw invalidReservation();
    return 1;
  }
  if (reservedChild === undefined || !reservedChildHandles.has(reservedChild)) {
    throw invalidReservation();
  }

  let canonicalRunsRoot: string;
  try {
    canonicalRunsRoot = await assertTrustedRunsRoot(runsRoot);
  } catch {
    throw invalidReservation();
  }
  if (
    reservedChild[reservedChildBrand] !== true ||
    !reservationFieldsMatch(reservedChild, {
      canonicalRunsRoot,
      parentRunId: snapshot.parentRunId,
      childRunId: runId,
      childMode: snapshot.mode,
    })
  ) {
    throw invalidReservation();
  }
  return 2;
}

function buildArtifactHashes(files: z.infer<typeof ArtifactFilesSchema>) {
  return {
    "migration-up.sql": sha256(files["migration-up.sql"]),
    "migration-down.sql": sha256(files["migration-down.sql"]),
    "validation.sql": sha256(files["validation.sql"]),
    "rollout-plan.md": sha256(files["rollout-plan.md"]),
  };
}

function buildSnapshotArtifacts(files: z.infer<typeof ArtifactFilesSchema>) {
  return [...virtualArtifactFilenames]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((filename) => ({
      filename,
      sha256: sha256(files[filename]),
      validated: true as const,
    }));
}

async function buildCompletedEnvelope(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly context: ChangeContext;
  readonly draft: MigrationPackageDraft;
  readonly rendered: RenderedMigrationPackage;
  readonly snapshot: WorkflowSnapshot;
  readonly reservedChild?: ReservedChildRun;
}): Promise<{ readonly envelope: RunEnvelope; readonly snapshot: WorkflowSnapshot }> {
  const context = ChangeContextSchema.parse(input.context);
  assertContextIntegrity(context);
  const draft = MigrationPackageDraftSchema.parse(input.draft);
  const rendered = RenderedMigrationPackageSchema.parse(input.rendered);
  const uncommittedSnapshot = WorkflowSnapshotSchema.parse(input.snapshot);
  assertSnapshotStringsAreBoundarySafe(uncommittedSnapshot, []);
  if (
    uncommittedSnapshot.status !== "COMPLETED" ||
    uncommittedSnapshot.runId !== input.runId ||
    uncommittedSnapshot.contextHash !== context.contextHash ||
    uncommittedSnapshot.executionClassification !== rendered.classification ||
    draft.executionClassification !== rendered.classification
  ) {
    throw new Error("Completed snapshot mismatch.");
  }
  const generationAttempt = await generationAttemptForSnapshot(
    input.runsRoot,
    input.runId,
    uncommittedSnapshot,
    input.reservedChild,
  );
  const snapshot = WorkflowSnapshotSchema.parse({
    ...uncommittedSnapshot,
    artifacts: buildSnapshotArtifacts(rendered.files),
  });
  const findings: z.infer<typeof PersistedFindingsSchema> = [];
  const envelope = RunEnvelopeSchema.parse({
    schemaVersion: "1",
    kind: "completed",
    runId: input.runId,
    mode: snapshot.mode,
    ...(snapshot.parentRunId === undefined ? {} : { parentRunId: snapshot.parentRunId }),
    generationAttempt,
    snapshot,
    context,
    draft,
    findings,
    package: {
      classification: rendered.classification,
      files: rendered.files,
    },
    hashes: {
      snapshot: sha256(canonicalJson(WorkflowSnapshotSchema, snapshot)),
      context: sha256(canonicalJson(ChangeContextSchema, context)),
      draft: sha256(canonicalJson(MigrationPackageDraftSchema, draft)),
      findings: sha256(canonicalJson(PersistedFindingsSchema, findings)),
      artifacts: buildArtifactHashes(rendered.files),
    },
  });
  return { envelope, snapshot };
}

async function buildFailedEnvelope(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly snapshot: WorkflowSnapshot;
  readonly secrets: readonly string[];
  readonly context?: ChangeContext;
  readonly draft?: MigrationPackageDraft;
  readonly findings?: readonly PackageFinding[];
  readonly reservedChild?: ReservedChildRun;
}): Promise<RunEnvelope> {
  const findings = [...sanitizeValidationFindings(input.findings ?? [], input.secrets)];
  PersistedFindingsSchema.parse(findings);
  const snapshot = WorkflowSnapshotSchema.parse(input.snapshot);
  assertSnapshotStringsAreBoundarySafe(snapshot, input.secrets);
  const summary = validationSummary(findings);
  if (
    snapshot.status === "COMPLETED" ||
    snapshot.runId !== input.runId ||
    snapshot.validation === undefined ||
    snapshot.validation.findingCount !== summary.findingCount ||
    snapshot.validation.findingCodes.length !== summary.findingCodes.length ||
    snapshot.validation.findingCodes.some((code, index) => code !== summary.findingCodes[index])
  ) {
    throw new Error("Failed snapshot mismatch.");
  }
  const context =
    input.context === undefined ? undefined : ChangeContextSchema.parse(input.context);
  if (context !== undefined) {
    assertContextIntegrity(context);
    if (snapshot.contextHash !== context.contextHash) throw new Error("Context mismatch.");
  }
  const draft =
    input.draft === undefined ? undefined : MigrationPackageDraftSchema.parse(input.draft);
  const generationAttempt = await generationAttemptForSnapshot(
    input.runsRoot,
    input.runId,
    snapshot,
    input.reservedChild,
  );
  return RunEnvelopeSchema.parse({
    schemaVersion: "1",
    kind: "failed",
    runId: input.runId,
    mode: snapshot.mode,
    ...(snapshot.parentRunId === undefined ? {} : { parentRunId: snapshot.parentRunId }),
    generationAttempt,
    snapshot,
    ...(context === undefined ? {} : { context }),
    ...(draft === undefined ? {} : { draft }),
    findings,
    hashes: {
      snapshot: sha256(canonicalJson(WorkflowSnapshotSchema, snapshot)),
      ...(context === undefined
        ? {}
        : { context: sha256(canonicalJson(ChangeContextSchema, context)) }),
      ...(draft === undefined
        ? {}
        : { draft: sha256(canonicalJson(MigrationPackageDraftSchema, draft)) }),
      findings: sha256(canonicalJson(PersistedFindingsSchema, findings)),
    },
  });
}

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
}): Promise<WorkflowSnapshot> {
  let prepared: Awaited<ReturnType<typeof buildCompletedEnvelope>>;
  try {
    prepared = await buildCompletedEnvelope(input);
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_REQUEST") throw error;
    throw completedRunInconsistent();
  }

  await publishRunEnvelope({
    runsRoot: input.runsRoot,
    runId: input.runId,
    serialized: serializeRunEnvelope(prepared.envelope),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
  });
  return prepared.snapshot;
}

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
}): Promise<void> {
  let envelope: RunEnvelope;
  try {
    envelope = await buildFailedEnvelope(input);
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_REQUEST") throw error;
    throw failedRunInconsistent();
  }

  await publishRunEnvelope({
    runsRoot: input.runsRoot,
    runId: input.runId,
    serialized: serializeRunEnvelope(envelope),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
  });
}

export async function loadRunSnapshot(input: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<WorkflowSnapshot> {
  try {
    const envelope = await readRunEnvelope(input);
    if (envelope.kind === "impact-report") throw new Error("Not a workflow envelope.");
    return envelope.snapshot;
  } catch {
    throw storageUnavailable();
  }
}

function regenerationContextFromEnvelope(
  envelope: RunEnvelope,
  expectedMode: DemoMode,
): { readonly snapshot: WorkflowSnapshot; readonly context: ChangeContext } {
  if (
    envelope.kind === "impact-report" ||
    envelope.mode !== expectedMode ||
    envelope.parentRunId !== undefined ||
    envelope.generationAttempt !== 1 ||
    !eligibleRegenerationStatuses.has(envelope.snapshot.status) ||
    envelope.context === undefined
  ) {
    throw new Error("Ineligible parent.");
  }
  assertContextIntegrity(envelope.context);
  if (envelope.snapshot.contextHash !== envelope.context.contextHash) {
    throw new Error("Context mismatch.");
  }
  return { snapshot: envelope.snapshot, context: envelope.context };
}

export async function loadRegenerationContext(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly expectedMode: DemoMode;
}): Promise<{ readonly snapshot: WorkflowSnapshot; readonly context: ChangeContext }> {
  try {
    const expectedMode = DemoModeSchema.parse(input.expectedMode);
    const envelope = await readRunEnvelope(input);
    return regenerationContextFromEnvelope(envelope, expectedMode);
  } catch {
    throw invalidRegenerationParent();
  }
}

export async function readCompletedPackageFile(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: VirtualArtifactFilename;
}): Promise<string> {
  try {
    if (!virtualArtifactFilenames.includes(input.filename)) {
      throw new Error("Unknown virtual artifact.");
    }
    const envelope = await readRunEnvelope(input);
    if (envelope.kind !== "completed") throw new Error("Completed package unavailable.");
    return envelope.package.files[input.filename];
  } catch {
    throw storageUnavailable();
  }
}

function createReservedChildRun(input: {
  readonly canonicalRunsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly childMode: DemoMode;
}): ReservedChildRun {
  const handle = Object.freeze({
    canonicalRunsRoot: input.canonicalRunsRoot,
    parentRunId: input.parentRunId,
    childRunId: input.childRunId,
    childMode: input.childMode,
    generationAttempt: 2 as const,
    [reservedChildBrand]: true as const,
  });
  reservedChildHandles.add(handle);
  return handle;
}

export async function reserveGenerationRetry(input: {
  readonly runsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly signal?: AbortSignal;
  readonly hooks?: RunEnvelopePublicationHooks;
}): Promise<ReservedChildRun> {
  try {
    SafeRunIdSchema.parse(input.parentRunId);
    SafeRunIdSchema.parse(input.childRunId);
    if (input.parentRunId === input.childRunId) throw new Error("Run IDs must differ.");
    const envelope = await readRunEnvelope({
      runsRoot: input.runsRoot,
      runId: input.parentRunId,
    });
    if (envelope.kind === "impact-report") throw new Error("Ineligible parent.");
    const { snapshot } = regenerationContextFromEnvelope(envelope, envelope.mode);
    const canonicalRunsRoot = await assertTrustedRunsRoot(input.runsRoot);
    const reservation = {
      schemaVersion: "1" as const,
      kind: "retry-reservation" as const,
      parentRunId: input.parentRunId,
      childRunId: input.childRunId,
      childMode: snapshot.mode,
      generationAttempt: 2 as const,
    };
    await publishRetryReservation({
      runsRoot: canonicalRunsRoot,
      parentRunId: input.parentRunId,
      serialized: serializeRetryReservation(reservation),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
    });
    return createReservedChildRun({
      canonicalRunsRoot,
      parentRunId: input.parentRunId,
      childRunId: input.childRunId,
      childMode: snapshot.mode,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "CANCELLED") throw error;
    throw invalidRegenerationParent();
  }
}

export const __testOnly = Object.freeze({
  reservationFieldsMatch,
});
