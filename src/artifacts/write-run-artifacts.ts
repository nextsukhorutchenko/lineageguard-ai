import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, posix, relative, resolve, sep, win32 } from "node:path";
import { AppError } from "../errors/app-error.js";

function assertSafeRunId(runId: string): void {
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

function assertWithinRunsRoot(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The artifact path escapes the runs directory.");
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

async function assertNoLinkedExistingPathComponents(target: string): Promise<void> {
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

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  options.signal?.throwIfAborted();
  assertSafeRunId(options.runId);

  const root = resolve(options.runsRoot);
  const runDirectory = resolve(root, options.runId);
  const intendedOutput = resolve(runDirectory, options.filename);

  try {
    await assertNoLinkedExistingPathComponents(root);
    options.signal?.throwIfAborted();
    await mkdir(root, { recursive: true });
    await assertNoLinkedExistingPathComponents(root);
    const realRoot = await realpath(root);

    await assertNoLinkedExistingPathComponents(runDirectory);
    options.signal?.throwIfAborted();
    await mkdir(runDirectory, { recursive: true });
    await assertNoLinkedExistingPathComponents(runDirectory);
    const runDirectoryStats = await lstat(runDirectory);
    if (runDirectoryStats.isSymbolicLink()) {
      throw new AppError("ARTIFACT_WRITE_FAILED", "The run directory must not be a symbolic link.");
    }

    const realRunDirectory = await realpath(runDirectory);
    assertWithinRunsRoot(realRoot, realRunDirectory);
    const output = resolve(realRunDirectory, options.filename);
    assertWithinRunsRoot(realRoot, output);

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
    throw new AppError("ARTIFACT_WRITE_FAILED", `Unable to write ${intendedOutput}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
