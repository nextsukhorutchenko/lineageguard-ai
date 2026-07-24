import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertNoLinkedExistingPathComponents,
  assertSafeRunId,
  assertWithinRunsRoot,
  commitPackageAtomically,
  isMissingPathError,
  readCompletedPackageFile,
  readRunArtifact,
  readRunMetadataFile,
  writeRunArtifact,
  type PackageCommitHooks,
} from "../artifacts/write-run-artifacts.js";
import { AppError } from "../errors/app-error.js";
import type { RenderedMigrationPackage } from "../migrations/render-snowflake-package.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import { sanitizeValidationFindings } from "../security/sanitize-validation-findings.js";
import {
  ChangeContextSchema,
  hashChangeContext,
  type ChangeContext,
} from "../workflow/change-context.js";
import { WorkflowSnapshotSchema, type WorkflowSnapshot } from "../workflow/contracts.js";
import {
  MigrationPackageDraftSchema,
  type MigrationPackageDraft,
} from "../workflow/migration-draft.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const reservedChildBrand: unique symbol = Symbol("reserved-child-run");

export interface ReservedChildRun {
  readonly runsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly [reservedChildBrand]: true;
}

function assertReservedChild(
  snapshot: WorkflowSnapshot,
  runsRoot: string,
  runId: string,
  reservedChild: ReservedChildRun | undefined,
): void {
  if (snapshot.parentRunId === undefined) return;
  if (
    reservedChild?.[reservedChildBrand] !== true ||
    reservedChild.runsRoot !== resolve(runsRoot) ||
    reservedChild.parentRunId !== snapshot.parentRunId ||
    reservedChild.childRunId !== runId
  ) {
    throw new AppError("INVALID_REQUEST", "The child run has not been reserved.");
  }
}

function validationSummary(findings: readonly PackageFinding[]) {
  const findingCodes = [...new Set(findings.map(({ code }) => code))]
    .sort((left, right) => left.localeCompare(right, "en"))
    .slice(0, 20);
  return { findingCount: findings.length, findingCodes };
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
  readonly hooks?: PackageCommitHooks;
}): Promise<WorkflowSnapshot> {
  const context = ChangeContextSchema.parse(input.context);
  const { contextHash, ...contextPayload } = context;
  if (hashChangeContext(contextPayload) !== contextHash) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The completed context is inconsistent.");
  }
  const draft = MigrationPackageDraftSchema.parse(input.draft);
  const artifacts = Object.entries(input.rendered.files).map(([filename, content]) => ({
    filename: filename as keyof typeof input.rendered.files,
    sha256: sha256(content),
    validated: true,
  }));
  const snapshot = WorkflowSnapshotSchema.parse({ ...input.snapshot, artifacts });
  if (
    snapshot.status !== "COMPLETED" ||
    snapshot.runId !== input.runId ||
    snapshot.contextHash !== context.contextHash
  ) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "Only a completed snapshot can be committed.");
  }
  assertReservedChild(snapshot, input.runsRoot, input.runId, input.reservedChild);
  await commitPackageAtomically({
    runsRoot: input.runsRoot,
    runId: input.runId,
    files: {
      ...input.rendered.files,
      "change-context.json": json(context),
      "migration-package-draft.json": json(draft),
      "validation-findings.json": json([]),
      "run-metadata.json": json(snapshot),
    },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.hooks === undefined ? {} : { hooks: input.hooks }),
  });
  return snapshot;
}

export async function persistFailedRun(input: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly snapshot: WorkflowSnapshot;
  readonly secrets: readonly string[];
  readonly context?: ChangeContext;
  readonly draft?: MigrationPackageDraft;
  readonly findings?: readonly PackageFinding[];
  readonly reservedChild?: ReservedChildRun;
}): Promise<void> {
  const boundedFindings = sanitizeValidationFindings(input.findings ?? [], input.secrets);
  const parsedSnapshot = WorkflowSnapshotSchema.parse(input.snapshot);
  const summary = validationSummary(boundedFindings);
  if (
    parsedSnapshot.status === "COMPLETED" ||
    parsedSnapshot.runId !== input.runId ||
    parsedSnapshot.validation === undefined ||
    parsedSnapshot.validation.findingCount !== summary.findingCount ||
    JSON.stringify(parsedSnapshot.validation.findingCodes) !== JSON.stringify(summary.findingCodes)
  ) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The diagnostic snapshot is inconsistent.");
  }
  assertReservedChild(parsedSnapshot, input.runsRoot, input.runId, input.reservedChild);

  if (input.context !== undefined) {
    const context = ChangeContextSchema.parse(input.context);
    const { contextHash, ...payload } = context;
    if (
      hashChangeContext(payload) !== contextHash ||
      parsedSnapshot.contextHash !== context.contextHash
    ) {
      throw new AppError("ARTIFACT_WRITE_FAILED", "The diagnostic context is inconsistent.");
    }
    await writeRunArtifact({
      runsRoot: input.runsRoot,
      runId: input.runId,
      filename: "change-context.json",
      content: json(context),
    });
  }
  if (input.draft !== undefined) {
    const draft = MigrationPackageDraftSchema.parse(input.draft);
    await writeRunArtifact({
      runsRoot: input.runsRoot,
      runId: input.runId,
      filename: "migration-package-draft.json",
      content: json(draft),
    });
  }
  if (input.findings !== undefined) {
    await writeRunArtifact({
      runsRoot: input.runsRoot,
      runId: input.runId,
      filename: "validation-findings.json",
      content: json(boundedFindings),
    });
  }
  await writeRunArtifact({
    runsRoot: input.runsRoot,
    runId: input.runId,
    filename: "run-metadata.json",
    content: json(parsedSnapshot),
  });
}

export async function loadRunSnapshot(input: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<WorkflowSnapshot> {
  const stored = await readRunMetadataFile(input);
  const snapshot = WorkflowSnapshotSchema.parse(JSON.parse(stored.content));
  if (stored.source === "diagnostic" && snapshot.status === "COMPLETED") {
    throw new AppError("ARTIFACT_WRITE_FAILED", "Completed package metadata is unavailable.");
  }
  return snapshot;
}

export async function loadRegenerationContext(input: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<{ readonly snapshot: WorkflowSnapshot; readonly context: ChangeContext }> {
  try {
    const snapshot = await loadRunSnapshot(input);
    const raw =
      snapshot.status === "COMPLETED"
        ? await readCompletedPackageFile({ ...input, filename: "change-context.json" })
        : snapshot.status === "GENERATION_FAILED" || snapshot.status === "VALIDATION_FAILED"
          ? await readRunArtifact({ ...input, filename: "change-context.json" })
          : undefined;
    if (raw === undefined) throw new Error("Ineligible parent.");
    const context = ChangeContextSchema.parse(JSON.parse(raw));
    const { contextHash, ...payload } = context;
    if (hashChangeContext(payload) !== contextHash || snapshot.contextHash !== contextHash) {
      throw new Error("Context integrity failure.");
    }
    return { snapshot, context };
  } catch {
    throw new AppError("INVALID_REQUEST", "The parent run cannot be regenerated.");
  }
}

export async function reserveGenerationRetry(input: {
  readonly runsRoot: string;
  readonly parentRunId: string;
  readonly childRunId: string;
  readonly hooks?: {
    readonly afterChildCreated?: () => void | Promise<void>;
  };
}): Promise<ReservedChildRun> {
  try {
    assertSafeRunId(input.parentRunId);
    assertSafeRunId(input.childRunId);
    if (input.parentRunId === input.childRunId) throw new Error("Run IDs must differ.");
    const unresolvedRoot = resolve(input.runsRoot);
    await assertNoLinkedExistingPathComponents(unresolvedRoot);
    const root = await realpath(unresolvedRoot);
    const parentDirectory = resolve(root, input.parentRunId);
    await assertNoLinkedExistingPathComponents(parentDirectory);
    const parentStats = await lstat(parentDirectory);
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
      throw new Error("Invalid parent.");
    }
    const realParentDirectory = await realpath(parentDirectory);
    assertWithinRunsRoot(root, realParentDirectory);
    const childDirectory = resolve(root, input.childRunId);
    assertWithinRunsRoot(root, childDirectory);

    try {
      try {
        await lstat(childDirectory);
        throw new Error("Child exists.");
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
      await assertNoLinkedExistingPathComponents(childDirectory);
      await mkdir(childDirectory);
    } catch {
      throw new AppError("INVALID_REQUEST", "The child run ID is unavailable.");
    }
    let lockCreated = false;
    const lockPath = resolve(realParentDirectory, "generation-retry.lock");
    try {
      await input.hooks?.afterChildCreated?.();
      const handle = await open(lockPath, "wx");
      lockCreated = true;
      try {
        await handle.writeFile(json({ schemaVersion: "1", childRunId: input.childRunId }), "utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (lockCreated) await unlink(lockPath).catch(() => undefined);
      await assertNoLinkedExistingPathComponents(childDirectory);
      await rmdir(childDirectory).catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new AppError("INVALID_REQUEST", "The parent run cannot be regenerated.");
    }

    return Object.freeze({
      runsRoot: root,
      parentRunId: input.parentRunId,
      childRunId: input.childRunId,
      [reservedChildBrand]: true as const,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_REQUEST") throw error;
    throw new AppError("INVALID_REQUEST", "The parent run cannot be regenerated.");
  }
}
