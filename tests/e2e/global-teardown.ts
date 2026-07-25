import { access, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute } from "node:path";

export async function removeOwnedRunsRoot(configuredRoot: string): Promise<void> {
  if (!isAbsolute(configuredRoot)) {
    throw new Error("The Playwright runs root is invalid.");
  }
  try {
    const [canonicalRoot, canonicalTemp] = await Promise.all([
      realpath(configuredRoot),
      realpath(tmpdir()),
    ]);
    if (
      dirname(canonicalRoot) !== canonicalTemp ||
      !basename(canonicalRoot).startsWith("lineageguard-playwright-runs-")
    ) {
      throw new Error("The Playwright runs root is outside the owned temporary boundary.");
    }
    await rm(canonicalRoot, { recursive: true, force: true });
    try {
      await access(canonicalRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Error("The Playwright runs root could not be removed.");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "The Playwright runs root is outside the owned temporary boundary." ||
        error.message === "The Playwright runs root could not be removed.")
    ) {
      throw error;
    }
    throw new Error("The Playwright runs root could not be removed.");
  }
}

export default async function globalTeardown(): Promise<void> {
  const configuredRoot = process.env.LINEAGEGUARD_E2E_RUNS_DIR;
  if (configuredRoot === undefined) throw new Error("The Playwright runs root is invalid.");
  await removeOwnedRunsRoot(configuredRoot);
}
