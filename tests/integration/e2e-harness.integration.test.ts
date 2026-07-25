import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { removeOwnedRunsRoot } from "../e2e/global-teardown.js";

it("removes only its canonical harness-owned runs root", async () => {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-playwright-runs-"));
  await writeFile(join(root, "sentinel.txt"), "owned", "utf8");

  await removeOwnedRunsRoot(root);

  await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects an unowned temporary root without deleting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-unowned-runs-"));
  try {
    await expect(removeOwnedRunsRoot(root)).rejects.toThrow(
      "The Playwright runs root is outside the owned temporary boundary.",
    );
    await expect(access(root)).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
