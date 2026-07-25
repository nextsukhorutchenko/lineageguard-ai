import { realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute } from "node:path";

export default async function globalTeardown(): Promise<void> {
  const configuredRoot = process.env.LINEAGEGUARD_E2E_RUNS_DIR;
  if (configuredRoot === undefined || !isAbsolute(configuredRoot)) {
    throw new Error("The Playwright runs root is invalid.");
  }
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
}
