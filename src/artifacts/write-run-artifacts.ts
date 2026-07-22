import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";
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

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
}): Promise<string> {
  assertSafeRunId(options.runId);

  const root = resolve(options.runsRoot);
  const runDirectory = resolve(root, options.runId);
  const intendedOutput = resolve(runDirectory, options.filename);

  try {
    await mkdir(root, { recursive: true });
    const realRoot = await realpath(root);

    await mkdir(runDirectory, { recursive: true });
    const runDirectoryStats = await lstat(runDirectory);
    if (runDirectoryStats.isSymbolicLink()) {
      throw new AppError("ARTIFACT_WRITE_FAILED", "The run directory must not be a symbolic link.");
    }

    const realRunDirectory = await realpath(runDirectory);
    assertWithinRunsRoot(realRoot, realRunDirectory);
    const output = resolve(realRunDirectory, options.filename);
    assertWithinRunsRoot(realRoot, output);

    await writeFile(output, options.content, { encoding: "utf8", flag: "wx" });
    return output;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("ARTIFACT_WRITE_FAILED", `Unable to write ${intendedOutput}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
