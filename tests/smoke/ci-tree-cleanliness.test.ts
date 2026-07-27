import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const CLEANLINESS_STEP = `      - name: Verify repository remains clean
        shell: bash
        run: |
          if ! git diff --quiet --no-ext-diff 2>/dev/null; then
            echo "::error::Tracked working-tree mutation or Git diff failure detected after offline verification."
            exit 1
          fi
          if ! git diff --cached --quiet --no-ext-diff 2>/dev/null; then
            echo "::error::Staged mutation or Git index check failure detected after offline verification."
            exit 1
          fi
          if ! residue="$(git status --porcelain=v1 --untracked-files=all 2>/dev/null)"; then
            echo "::error::Git status check failed after offline verification."
            exit 1
          fi
          if [ -n "$residue" ]; then
            echo "::error::Non-ignored repository residue detected after offline verification."
            exit 1
          fi
`;

const temporaryPaths: string[] = [];

const PORTABLE_GIT_ENVIRONMENT_KEYS = [
  "COMSPEC",
  "HOME",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
] as const;

function isolatedGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    NODE_ENV: "test",
  };

  for (const key of PORTABLE_GIT_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

function git(cwd: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: isolatedGitEnvironment(),
    shell: false,
    windowsHide: true,
  });
}

function requireGitSuccess(result: SpawnSyncReturns<string>): void {
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
}

function requireGitObservation(
  result: SpawnSyncReturns<string>,
  allowedStatuses: readonly number[],
  operation: string,
): void {
  expect(result.error, `${operation} could not start.`).toBeUndefined();
  expect(allowedStatuses, `${operation} exited unexpectedly.`).toContain(result.status);
}

async function createRepository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "lineageguard-clean-tree-"));
  temporaryPaths.push(cwd);

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
  const tracked = git(cwd, ["diff", "--quiet", "--no-ext-diff"]);
  const staged = git(cwd, ["diff", "--cached", "--quiet", "--no-ext-diff"]);
  const status = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);

  requireGitObservation(tracked, [0, 1], "Git working-tree diff");
  requireGitObservation(staged, [0, 1], "Git staged diff");
  requireGitObservation(status, [0], "Git status");

  return tracked.status === 0 && staged.status === 0 && status.stdout === "";
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((cwd) => rm(cwd, { force: true, recursive: true })),
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

  it("does not let inherited global excludes hide repository residue", async () => {
    const configurationRoot = await mkdtemp(join(tmpdir(), "lineageguard-git-config-"));
    temporaryPaths.push(configurationRoot);
    const excludesFile = join(configurationRoot, "global-excludes");
    const globalConfig = join(configurationRoot, "global.gitconfig");
    await writeFile(excludesFile, "unexpected.txt\n", "utf8");
    await writeFile(
      globalConfig,
      `[core]\n\texcludesFile = "${excludesFile.replaceAll("\\", "/")}"\n`,
      "utf8",
    );

    const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      const cwd = await createRepository();
      await writeFile(join(cwd, "unexpected.txt"), "residue\n", "utf8");

      expect(treeIsClean(cwd)).toBe(false);
    } finally {
      if (previousGlobalConfig === undefined) {
        delete process.env.GIT_CONFIG_GLOBAL;
      } else {
        process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
      }
    }
  });

  it("rejects an unexpected Git observation failure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-not-a-repository-"));
    temporaryPaths.push(cwd);

    expect(() => treeIsClean(cwd)).toThrow("Git working-tree diff exited unexpectedly.");
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
