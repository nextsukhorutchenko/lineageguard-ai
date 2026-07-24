import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, posix, relative, resolve, sep, win32 } from "node:path";
import { AppError } from "../errors/app-error.js";
import { WorkflowSnapshotSchema } from "../workflow/contracts.js";

export const runFilenames = [
  "impact-report.md",
  "change-context.json",
  "migration-package-draft.json",
  "validation-findings.json",
  "run-metadata.json",
] as const;
export type RunFilename = (typeof runFilenames)[number];

export const completedPackageFilenames = [
  "change-context.json",
  "migration-package-draft.json",
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
  "validation-findings.json",
  "run-metadata.json",
] as const;
export type CompletedPackageFilename = (typeof completedPackageFilenames)[number];

interface PackageManifest {
  readonly schemaVersion: "1";
  readonly runId: string;
  readonly files: Readonly<Record<CompletedPackageFilename, string>>;
}

export interface PackageCommitHooks {
  readonly afterStagedWrite?: (event: {
    readonly filename: CompletedPackageFilename | "manifest.json";
    readonly index: number;
  }) => void | Promise<void>;
  readonly beforeRename?: () => void | Promise<void>;
  readonly afterRename?: () => void | Promise<void>;
}

export function assertSafeRunId(runId: string): void {
  if (
    runId.length === 0 ||
    runId === "." ||
    runId === ".." ||
    runId.includes("/") ||
    runId.includes("\\") ||
    posix.isAbsolute(runId) ||
    win32.isAbsolute(runId) ||
    /^[A-Za-z]:/.test(runId)
  ) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The run ID must be a single path segment.");
  }
}

export function assertWithinRunsRoot(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The artifact path escapes the runs directory.");
  }
}

export function isMissingPathError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

export async function assertNoLinkedExistingPathComponents(target: string): Promise<void> {
  const absoluteTarget = resolve(target);
  const pathRoot = parse(absoluteTarget).root;
  const components = relative(pathRoot, absoluteTarget).split(sep).filter(Boolean);
  let current = pathRoot;

  for (const component of components) {
    current = join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new AppError(
          "ARTIFACT_WRITE_FAILED",
          "The runs directory and its ancestors must not be symbolic links or junctions.",
        );
      }
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }
}

function assertAllowedFilename(filename: string): asserts filename is RunFilename {
  if (!(runFilenames as readonly string[]).includes(filename)) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The artifact filename is not allowed.");
  }
}

function assertCompletedFilename(filename: string): asserts filename is CompletedPackageFilename {
  if (!(completedPackageFilenames as readonly string[]).includes(filename)) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The requested artifact is unavailable.");
  }
}

async function ensureSafeRunDirectory(
  runsRoot: string,
  runId: string,
  signal?: AbortSignal,
): Promise<{ readonly root: string; readonly runDirectory: string }> {
  signal?.throwIfAborted();
  assertSafeRunId(runId);
  const unresolvedRoot = resolve(runsRoot);
  const unresolvedRunDirectory = resolve(unresolvedRoot, runId);

  await assertNoLinkedExistingPathComponents(unresolvedRoot);
  signal?.throwIfAborted();
  await mkdir(unresolvedRoot, { recursive: true });
  await assertNoLinkedExistingPathComponents(unresolvedRoot);
  const root = await realpath(unresolvedRoot);

  await assertNoLinkedExistingPathComponents(unresolvedRunDirectory);
  signal?.throwIfAborted();
  await mkdir(unresolvedRunDirectory, { recursive: true });
  await assertNoLinkedExistingPathComponents(unresolvedRunDirectory);
  const stats = await lstat(unresolvedRunDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The run directory is unavailable.");
  }
  const runDirectory = await realpath(unresolvedRunDirectory);
  assertWithinRunsRoot(root, runDirectory);
  return { root, runDirectory };
}

async function openSafeExistingRunDirectory(
  runsRoot: string,
  runId: string,
): Promise<{ readonly root: string; readonly runDirectory: string }> {
  assertSafeRunId(runId);
  const unresolvedRoot = resolve(runsRoot);
  await assertNoLinkedExistingPathComponents(unresolvedRoot);
  const root = await realpath(unresolvedRoot);
  const unresolvedRunDirectory = resolve(root, runId);
  await assertNoLinkedExistingPathComponents(unresolvedRunDirectory);
  const runStats = await lstat(unresolvedRunDirectory);
  if (runStats.isSymbolicLink() || !runStats.isDirectory())
    throw new Error("Invalid run directory.");
  const runDirectory = await realpath(unresolvedRunDirectory);
  assertWithinRunsRoot(root, runDirectory);
  return { root, runDirectory };
}

async function readRegularFile(root: string, filename: string): Promise<string> {
  assertWithinRunsRoot(root, filename);
  const stats = await lstat(filename);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Not a regular file.");
  return readFile(filename, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseManifest(raw: string, runId: string): PackageManifest {
  const value: unknown = JSON.parse(raw);
  const allowedKeys = new Set(["schemaVersion", "runId", "files"]);
  if (
    value === null ||
    typeof value !== "object" ||
    Object.keys(value).length !== allowedKeys.size ||
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== "1" ||
    (value as { runId?: unknown }).runId !== runId ||
    (value as { files?: unknown }).files === null ||
    typeof (value as { files?: unknown }).files !== "object"
  ) {
    throw new Error("Invalid manifest.");
  }
  const files = (value as { files: Record<string, unknown> }).files;
  const keys = Object.keys(files);
  if (
    keys.length !== completedPackageFilenames.length ||
    completedPackageFilenames.some((filename) => !/^[a-f0-9]{64}$/.test(String(files[filename]))) ||
    keys.some((filename) => !(completedPackageFilenames as readonly string[]).includes(filename))
  ) {
    throw new Error("Invalid manifest.");
  }
  return value as PackageManifest;
}

async function loadCompletedPackage(
  options: {
    readonly runsRoot: string;
    readonly runId: string;
  },
  requestedFilename: CompletedPackageFilename,
): Promise<{ readonly requested: string; readonly metadata: string }> {
  const { root, runDirectory } = await openSafeExistingRunDirectory(
    options.runsRoot,
    options.runId,
  );
  const packageDirectory = resolve(runDirectory, "package");
  assertWithinRunsRoot(root, packageDirectory);
  await assertNoLinkedExistingPathComponents(packageDirectory);
  const packageStats = await lstat(packageDirectory);
  if (packageStats.isSymbolicLink() || !packageStats.isDirectory())
    throw new Error("Invalid package.");
  const realPackageDirectory = await realpath(packageDirectory);
  assertWithinRunsRoot(root, realPackageDirectory);

  const manifestRaw = await readRegularFile(root, resolve(realPackageDirectory, "manifest.json"));
  const manifest = parseManifest(manifestRaw, options.runId);
  const requested = await readRegularFile(root, resolve(realPackageDirectory, requestedFilename));
  const metadata =
    requestedFilename === "run-metadata.json"
      ? requested
      : await readRegularFile(root, resolve(realPackageDirectory, "run-metadata.json"));
  if (
    sha256(requested) !== manifest.files[requestedFilename] ||
    sha256(metadata) !== manifest.files["run-metadata.json"]
  ) {
    throw new Error("Package integrity check failed.");
  }
  const snapshot = WorkflowSnapshotSchema.parse(JSON.parse(metadata));
  if (snapshot.status !== "COMPLETED" || snapshot.runId !== options.runId) {
    throw new Error("Completed metadata is invalid.");
  }
  return { requested, metadata };
}

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: RunFilename;
  readonly content: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  options.signal?.throwIfAborted();
  assertSafeRunId(options.runId);
  assertAllowedFilename(options.filename);

  try {
    const { root, runDirectory } = await ensureSafeRunDirectory(
      options.runsRoot,
      options.runId,
      options.signal,
    );
    const output = resolve(runDirectory, options.filename);
    assertWithinRunsRoot(root, output);
    options.signal?.throwIfAborted();
    await writeFile(output, options.content, {
      encoding: "utf8",
      flag: "wx",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return output;
  } catch (error) {
    if (options.signal?.aborted) options.signal.throwIfAborted();
    if (error instanceof AppError) throw error;
    throw new AppError("ARTIFACT_WRITE_FAILED", "Unable to write the requested artifact.");
  }
}

export async function readRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: RunFilename;
}): Promise<string> {
  try {
    assertSafeRunId(options.runId);
    assertAllowedFilename(options.filename);
    const { root, runDirectory } = await openSafeExistingRunDirectory(
      options.runsRoot,
      options.runId,
    );
    const candidate = resolve(runDirectory, options.filename);
    return await readRegularFile(root, candidate);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("ARTIFACT_WRITE_FAILED", "The requested artifact is unavailable.");
  }
}

export async function commitPackageAtomically(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly files: Readonly<Record<CompletedPackageFilename, string>>;
  readonly signal?: AbortSignal;
  readonly hooks?: PackageCommitHooks;
}): Promise<string> {
  options.signal?.throwIfAborted();
  const fileKeys = Object.keys(options.files);
  if (
    fileKeys.length !== completedPackageFilenames.length ||
    completedPackageFilenames.some((filename) => typeof options.files[filename] !== "string") ||
    fileKeys.some(
      (filename) => !(completedPackageFilenames as readonly string[]).includes(filename),
    )
  ) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The completed package file set is invalid.");
  }
  try {
    const metadata = WorkflowSnapshotSchema.parse(JSON.parse(options.files["run-metadata.json"]));
    if (metadata.status !== "COMPLETED" || metadata.runId !== options.runId) {
      throw new Error("Invalid completed metadata.");
    }
  } catch {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The completed package metadata is invalid.");
  }

  let stagingDirectory: string | undefined;
  let committed = false;
  try {
    const { root, runDirectory } = await ensureSafeRunDirectory(
      options.runsRoot,
      options.runId,
      options.signal,
    );
    stagingDirectory = resolve(runDirectory, `.package-${randomBytes(16).toString("hex")}`);
    assertWithinRunsRoot(root, stagingDirectory);
    await mkdir(stagingDirectory);

    const hashes = {} as Record<CompletedPackageFilename, string>;
    let index = 0;
    for (const filename of completedPackageFilenames) {
      options.signal?.throwIfAborted();
      const content = options.files[filename];
      await writeFile(resolve(stagingDirectory, filename), content, {
        encoding: "utf8",
        flag: "wx",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      hashes[filename] = sha256(content);
      index += 1;
      await options.hooks?.afterStagedWrite?.({ filename, index });
      options.signal?.throwIfAborted();
    }
    const manifest = `${JSON.stringify(
      { schemaVersion: "1", runId: options.runId, files: hashes },
      null,
      2,
    )}\n`;
    options.signal?.throwIfAborted();
    await writeFile(resolve(stagingDirectory, "manifest.json"), manifest, {
      encoding: "utf8",
      flag: "wx",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    index += 1;
    await options.hooks?.afterStagedWrite?.({ filename: "manifest.json", index });
    options.signal?.throwIfAborted();
    await options.hooks?.beforeRename?.();
    options.signal?.throwIfAborted();
    const packageDirectory = resolve(runDirectory, "package");
    assertWithinRunsRoot(root, packageDirectory);
    try {
      await lstat(packageDirectory);
      throw new AppError("ARTIFACT_WRITE_FAILED", "The completed package already exists.");
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    await rename(stagingDirectory, packageDirectory);
    committed = true;
    try {
      await options.hooks?.afterRename?.();
    } catch {
      // The committed package is authoritative after the rename linearization point.
    }
    return packageDirectory;
  } catch (error) {
    if (!committed && stagingDirectory !== undefined) {
      try {
        const { root, runDirectory } = await openSafeExistingRunDirectory(
          options.runsRoot,
          options.runId,
        );
        assertWithinRunsRoot(root, stagingDirectory);
        if (resolve(stagingDirectory).startsWith(`${resolve(runDirectory)}${sep}.package-`)) {
          await assertNoLinkedExistingPathComponents(stagingDirectory);
          await rm(stagingDirectory, { recursive: true, force: true });
        }
      } catch {
        // Preserve the original sanitized failure.
      }
    }
    if (options.signal?.aborted) options.signal.throwIfAborted();
    if (error instanceof AppError) throw error;
    throw new AppError("ARTIFACT_WRITE_FAILED", "Unable to commit the completed package.");
  }
}

export async function readCompletedPackageFile(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: CompletedPackageFilename;
}): Promise<string> {
  try {
    assertCompletedFilename(options.filename);
    return (await loadCompletedPackage(options, options.filename)).requested;
  } catch {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The requested artifact is unavailable.");
  }
}

export async function readRunMetadataFile(options: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<
  | { readonly source: "completed"; readonly content: string }
  | { readonly source: "diagnostic"; readonly content: string }
> {
  try {
    const { root, runDirectory } = await openSafeExistingRunDirectory(
      options.runsRoot,
      options.runId,
    );
    const packageDirectory = resolve(runDirectory, "package");
    try {
      await lstat(packageDirectory);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const content = await readRegularFile(root, resolve(runDirectory, "run-metadata.json"));
      const snapshot = WorkflowSnapshotSchema.parse(JSON.parse(content));
      if (snapshot.status === "COMPLETED") throw new Error("Invalid diagnostic metadata.");
      return { source: "diagnostic", content };
    }
    const completed = await loadCompletedPackage(options, "run-metadata.json");
    return { source: "completed", content: completed.metadata };
  } catch {
    throw new AppError("ARTIFACT_WRITE_FAILED", "Run metadata is unavailable.");
  }
}
