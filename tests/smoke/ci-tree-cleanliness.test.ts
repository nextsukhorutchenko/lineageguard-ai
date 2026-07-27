import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLEANLINESS_STEP = `      - name: Verify repository remains clean
        shell: bash
        run: |
          git diff --exit-code
          git diff --cached --exit-code
          test -z "$(git status --porcelain --untracked-files=all)"
`;

const temporaryRepositories: string[] = [];

function git(cwd: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function requireGitSuccess(result: SpawnSyncReturns<string>): void {
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
}

async function createRepository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "lineageguard-clean-tree-"));
  temporaryRepositories.push(cwd);

  requireGitSuccess(git(cwd, ["init"]));
  await writeFile(join(cwd, ".gitignore"), ".next/\n", "utf8");
  await writeFile(join(cwd, "tracked.txt"), "baseline\n", "utf8");
  requireGitSuccess(git(cwd, ["add", "--", ".gitignore", "tracked.txt"]));
  requireGitSuccess(
    git(cwd, [
      "-c",
      "user.name=LineageGuard CI",
      "-c",
      "user.email=ci@lineageguard.invalid",
      "commit",
      "-m",
      "baseline",
    ]),
  );

  return cwd;
}

function treeIsClean(cwd: string): boolean {
  const tracked = git(cwd, ["diff", "--exit-code"]);
  const staged = git(cwd, ["diff", "--cached", "--exit-code"]);
  const status = git(cwd, ["status", "--porcelain", "--untracked-files=all"]);

  return tracked.status === 0 && staged.status === 0 && status.stdout.trim() === "";
}

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((cwd) => rm(cwd, { force: true, recursive: true })),
  );
});

describe("CI repository cleanliness gate", () => {
  it("runs the full-tree gate after the offline validation gate", async () => {
    const workflow = await readFile(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const offlineGate = workflow.indexOf("      - name: Run offline validation gate");
    const cleanlinessGate = workflow.indexOf("      - name: Verify repository remains clean");

    expect(offlineGate).toBeGreaterThanOrEqual(0);
    expect(cleanlinessGate).toBeGreaterThan(offlineGate);
    expect(workflow).toContain(CLEANLINESS_STEP);
  });

  it("accepts a clean repository containing only ignored build output", async () => {
    const cwd = await createRepository();
    await mkdir(join(cwd, ".next"), { recursive: true });
    await writeFile(join(cwd, ".next", "build-output"), "ignored\n", "utf8");

    expect(treeIsClean(cwd)).toBe(true);
  });

  it.each([
    [
      "tracked mutation",
      async (cwd: string) => {
        await writeFile(join(cwd, "tracked.txt"), "mutated\n", "utf8");
      },
    ],
    [
      "staged mutation",
      async (cwd: string) => {
        await writeFile(join(cwd, "tracked.txt"), "staged\n", "utf8");
        requireGitSuccess(git(cwd, ["add", "--", "tracked.txt"]));
      },
    ],
    [
      "non-ignored untracked residue",
      async (cwd: string) => {
        await writeFile(join(cwd, "unexpected.txt"), "residue\n", "utf8");
      },
    ],
  ])("rejects %s", async (_name, mutate) => {
    const cwd = await createRepository();
    await mutate(cwd);

    expect(treeIsClean(cwd)).toBe(false);
  });
});
