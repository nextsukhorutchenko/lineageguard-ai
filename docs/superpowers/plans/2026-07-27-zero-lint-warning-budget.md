# Zero Lint Warning Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the repository's existing ESLint warning and make every shared local and CI lint
run fail when ESLint reports any warning.

**Architecture:** Use ESLint's native `--max-warnings 0` budget in the existing shared `lint`
package script, which is already part of `verify:offline` and GitHub Actions. Protect the command
with a focused toolchain contract and prove its accepting and rejecting semantics by invoking the
pinned ESLint binary against one clean committed target and one temporary warning-producing
fixture. Fix the existing warning at its source without changing rule severity or lint coverage.

**Tech Stack:** Node.js `22.23.1`, pnpm `10.10.0`, ESLint `9.39.5`, Vitest `4.1.10`, TypeScript
`6.0.3`, GitHub Actions.

## Global Constraints

- Corrective authority is
  `docs/superpowers/specs/2026-07-27-zero-lint-warning-budget-design.md`.
- Preserve every product, runtime, deployment, DataHub, OpenAI, artifact, and safety contract.
- Keep GitHub Actions on the existing `pnpm verify:offline` path; do not add a duplicate lint step.
- Use exactly `eslint . --max-warnings 0` as the shared `lint` package script.
- Do not disable, downgrade, or exclude any ESLint rule or repository path.
- Do not add dependencies or modify `pnpm-lock.yaml`.
- Keep executable test subprocesses offline, credential-free, shell-free, time-bounded, and
  output-bounded.
- Keep temporary negative fixtures under ignored `tmp/` storage, force linting with `--no-ignore`,
  and remove the fixture root after every test path.
- Keep code, tests, documentation, commits, and repository artifacts in English.
- Follow strict RED-GREEN TDD for every behavior change.

## File Map

- Modify `tests/smoke/toolchain.test.ts` — require the exact shared zero-warning lint command.
- Create `tests/smoke/lint-warning-budget.test.ts` — execute positive and negative warning-budget
  boundaries against the pinned ESLint binary.
- Modify `package.json` — add the native zero-warning budget to the shared lint entry point.
- Modify `prettier.config.mjs` — replace the anonymous default export with a named configuration.
- Do not modify `.github/workflows/ci.yml`; it already consumes `pnpm lint` through
  `pnpm verify:offline`.
- Do not modify `pnpm-lock.yaml`, application code, runtime configuration, or product
  documentation.

---

### Task 1: Enforce and Prove the Zero-Warning Lint Contract

**Files:**

- Modify: `tests/smoke/toolchain.test.ts`
- Create: `tests/smoke/lint-warning-budget.test.ts`
- Modify: `package.json`
- Modify: `prettier.config.mjs`

**Interfaces:**

- Consumes: the pinned `eslint` package, the repository flat ESLint configuration, the shared
  `lint` package script, and the existing `verify:offline` chain.
- Produces: `packageJson.scripts.lint === "eslint . --max-warnings 0"`, a warning-free Prettier
  configuration, and executable proof that zero warnings pass while one warning fails.

- [ ] **Step 1: Add the failing shared-command contract**

Add this focused test inside `describe("toolchain", ...)` in
`tests/smoke/toolchain.test.ts`:

```ts
it("enforces a zero-warning budget in the shared lint command", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(process.cwd(), "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
  };

  expect(packageJson.scripts.lint).toBe("eslint . --max-warnings 0");
});
```

The production change that makes this test pass is changing only the `lint` script in
`package.json`.

- [ ] **Step 2: Add executable positive and negative gate coverage**

Create `tests/smoke/lint-warning-budget.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ESLINT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
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
  it("accepts a warning-free target", () => {
    const result = lint(["prettier.config.mjs", "--max-warnings", "0"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it("rejects a target that emits one warning", async () => {
    const temporaryParent = resolve(process.cwd(), "tmp");
    await mkdir(temporaryParent, { recursive: true });
    const root = await mkdtemp(resolve(temporaryParent, "lint-warning-budget-"));
    temporaryRoots.push(root);
    const fixture = resolve(root, "anonymous-default-export.mjs");
    await writeFile(fixture, "export default {};\n", "utf8");

    const result = lint([fixture, "--no-ignore", "--format", "json", "--max-warnings", "0"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const reports = JSON.parse(result.stdout) as Array<{
      errorCount: number;
      warningCount: number;
    }>;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ errorCount: 0, warningCount: 1 });
  });
});
```

The positive test fails until the existing anonymous export warning is fixed. The negative test
uses the same native warning budget required by the shared command and must already reject its
deliberate warning.

- [ ] **Step 3: Run focused RED**

Run:

```powershell
pnpm exec vitest run tests/smoke/toolchain.test.ts tests/smoke/lint-warning-budget.test.ts
```

Expected:

- the toolchain contract fails because `packageJson.scripts.lint` is still `eslint .`;
- the positive executable case fails because `prettier.config.mjs` emits one warning;
- the negative executable case passes because `--max-warnings 0` rejects its one-warning fixture;
- every unrelated toolchain test continues to pass.

- [ ] **Step 4: Harden the shared lint command**

Change only the `lint` entry in `package.json`:

```json
"lint": "eslint . --max-warnings 0",
```

Do not change dependency versions, script ordering, or `verify:offline`.

- [ ] **Step 5: Remove the existing warning at its source**

Replace `prettier.config.mjs` with:

```js
const config = {
  printWidth: 100,
  trailingComma: "all",
};

export default config;
```

Do not disable `import/no-anonymous-default-export` or add an ESLint suppression.

- [ ] **Step 6: Run focused GREEN**

Run:

```powershell
pnpm exec vitest run tests/smoke/toolchain.test.ts tests/smoke/lint-warning-budget.test.ts
pnpm lint
```

Expected:

- both smoke files pass;
- `pnpm lint` exits `0`;
- ESLint reports zero errors and zero warnings.

- [ ] **Step 7: Verify formatting and immutable dependency state**

Run:

```powershell
pnpm exec prettier --check package.json prettier.config.mjs tests/smoke/toolchain.test.ts tests/smoke/lint-warning-budget.test.ts
git diff --check
git diff --exit-code -- pnpm-lock.yaml .github/workflows/ci.yml
```

Expected: formatting and diff checks exit `0`; the lockfile and workflow are unchanged.

- [ ] **Step 8: Inspect and commit the implementation**

Run:

```powershell
git diff -- package.json prettier.config.mjs tests/smoke/toolchain.test.ts tests/smoke/lint-warning-budget.test.ts
git status --short
git add -- package.json prettier.config.mjs tests/smoke/toolchain.test.ts tests/smoke/lint-warning-budget.test.ts
git diff --cached --check
git commit -m "ci: enforce zero lint warnings"
```

Expected: one implementation commit contains only the shared warning budget, the warning cleanup,
and focused positive and negative coverage.

---

### Task 2: Whole-Branch Review and Verification

**Files:**

- Inspect: `package.json`
- Inspect: `prettier.config.mjs`
- Inspect: `tests/smoke/toolchain.test.ts`
- Inspect: `tests/smoke/lint-warning-budget.test.ts`
- Inspect: `docs/superpowers/specs/2026-07-27-zero-lint-warning-budget-design.md`
- Inspect: `docs/superpowers/plans/2026-07-27-zero-lint-warning-budget.md`

**Interfaces:**

- Consumes: the Task 1 implementation commit and the approved specification.
- Produces: independent whole-branch review evidence and fresh repository-required verification
  for the final branch HEAD.

- [ ] **Step 1: Review the branch against authority**

Inspect:

```powershell
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- package.json prettier.config.mjs tests/smoke/toolchain.test.ts tests/smoke/lint-warning-budget.test.ts docs/superpowers/specs/2026-07-27-zero-lint-warning-budget-design.md docs/superpowers/plans/2026-07-27-zero-lint-warning-budget.md
```

Expected: the branch contains only the approved specification, plan, zero-warning enforcement,
warning cleanup, and focused tests. Review must report no Critical or Important findings before
completion.

- [ ] **Step 2: Run the complete offline gate**

Run:

```powershell
pnpm verify:offline
```

Expected: formatting, zero-warning lint, strict type checking, all offline tests, render validation,
production builds, runtime-mode integration, public replay acceptance, and Chromium acceptance
exit `0`.

- [ ] **Step 3: Prove post-verification tree cleanliness**

Run:

```powershell
git diff --quiet --no-ext-diff
if ($LASTEXITCODE -ne 0) {
  throw "Tracked working-tree mutation detected after offline verification."
}
git diff --cached --quiet --no-ext-diff
if ($LASTEXITCODE -ne 0) {
  throw "Staged mutation detected after offline verification."
}
$residue = git status --porcelain=v1 --untracked-files=all
if ($LASTEXITCODE -ne 0) {
  throw "Git status check failed after offline verification."
}
if (-not [string]::IsNullOrEmpty(($residue -join "`n"))) {
  throw "Non-ignored repository residue detected after offline verification."
}
```

Expected: every Git observation exits `0` and the branch worktree is clean.

- [ ] **Step 4: Run secret and final diff gates**

Run:

```powershell
pnpm security:scan
pnpm security:scan:history
git diff origin/main...HEAD --check
git diff --exit-code origin/main...HEAD -- pnpm-lock.yaml .github/workflows/ci.yml
git status --short --branch
```

Expected: both secret scans pass; branch diff checks exit `0`; dependency and workflow files remain
unchanged; repository status is clean.

- [ ] **Step 5: Prepare the final handoff**

Report:

- the exact lint command and zero-warning result;
- focused positive and negative test counts;
- complete offline-gate result;
- secret-scan result;
- whole-branch review verdict;
- unchanged `pnpm-lock.yaml` and `.github/workflows/ci.yml`;
- the final commit range and any skipped or unavailable checks.

Do not push, create a pull request, or merge without explicit owner authorization.
