import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ESLINT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const WARNING_RULE_ARGUMENTS = ["--no-config-lookup", "--rule", "no-debugger: warn"] as const;
const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);
const eslintCli = resolve(dirname(require.resolve("eslint")), "..", "bin", "eslint.js");

function lint(arguments_: readonly string[]) {
  return spawnSync(process.execPath, [eslintCli, ...arguments_], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      APPDATA: process.env.APPDATA,
      COMSPEC: process.env.COMSPEC,
      HOME: process.env.HOME,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      NODE_ENV: "test",
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      SYSTEMROOT: process.env.SYSTEMROOT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      WINDIR: process.env.WINDIR,
    },
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    timeout: ESLINT_TIMEOUT_MS,
    windowsHide: true,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("zero-warning lint budget", () => {
  it(
    "accepts a warning-free target",
    () => {
      const result = lint([
        ...WARNING_RULE_ARGUMENTS,
        "prettier.config.mjs",
        "--max-warnings",
        "0",
      ]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    },
    ESLINT_TIMEOUT_MS + 5_000,
  );

  it(
    "rejects a target that emits one warning",
    async () => {
      const temporaryParent = resolve(process.cwd(), "tmp");
      await mkdir(temporaryParent, { recursive: true });
      const root = await mkdtemp(resolve(temporaryParent, "lint-warning-budget-"));
      temporaryRoots.push(root);
      const fixture = resolve(root, "warning-budget.js");
      await writeFile(fixture, "debugger;\n", "utf8");

      const result = lint([
        ...WARNING_RULE_ARGUMENTS,
        fixture,
        "--no-ignore",
        "--format",
        "json",
        "--max-warnings",
        "0",
      ]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      const reports = JSON.parse(result.stdout) as Array<{
        errorCount: number;
        warningCount: number;
      }>;
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ errorCount: 0, warningCount: 1 });
    },
    ESLINT_TIMEOUT_MS + 5_000,
  );
});
