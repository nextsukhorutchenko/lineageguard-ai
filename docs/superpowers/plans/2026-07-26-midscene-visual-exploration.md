# Midscene Visual Exploration Implementation Plan

> **Lifecycle:** Implemented — historical execution record.
>
> The implementation outcome is present in the repository. Unchecked boxes preserve the original
> execution sequence; they are not an outstanding-work tracker. Earlier snippets may be superseded
> by later approved amendments and the current implementation. Use `docs/README.md` to find current
> authority, operator guidance, and verification evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one bounded, explicit, local-only Midscene visual exploratory test over the
deterministic LineageGuard REPLAY flow.

**Architecture:** Midscene 1.10.7 is isolated behind a separate Playwright configuration and a
guarded runner. Deterministic Playwright performs navigation and workflow actions; one Midscene
visual assertion evaluates layout readability. The workflow uses Chromium, one worker, zero
retries, fixed ignored output roots, explicit model environment, and no mandatory CI integration.

**Tech Stack:** Node.js 22.23.1, pnpm 10.10.0, TypeScript 6.0.3, Playwright Test 1.61.1,
`@midscene/web` 1.10.7, Vitest 4.1.10.

**Prerequisite:** Complete
`docs/superpowers/plans/2026-07-26-playwright-test-agents.md` and
`docs/superpowers/plans/2026-07-26-deterministic-pr-impact-reporting.md` first. This plan imports
the resulting mandatory Playwright configuration but overrides its test directory, retry, worker,
timeout, and reporter settings for the isolated exploratory run.

## Global Constraints

- Treat the approved design in
  `docs/superpowers/specs/2026-07-26-playwright-agents-pr-impact-midscene-design.md` as authority.
- Pin `@midscene/web` exactly to `1.10.7`; npm registry reports peers `playwright: ^1.45.0` and
  `@playwright/test: ^1.45.0` plus Node `>=18.19.0`, satisfied by this repository.
- Update `package.json` and `pnpm-lock.yaml` together through pnpm.
- Keep Midscene outside `verify:offline`, mandatory CI, and every default test script.
- Require explicit operator opt-in and external model configuration.
- Never commit credentials, model output, reports, screenshots, traces, or native paths.
- Reuse the managed REPLAY server; never pass Midscene credentials into the Next.js child.
- Use deterministic Playwright for navigation and actions; use Midscene only for visual
  exploration/assertion.
- Use Chromium, one worker, zero retries, 90-second test timeout, 120-second global timeout,
  60-second model timeout, zero provider retries, and at most three replanning cycles.
- Do not commit, push, create branches, or change GitHub state without separate owner permission.

---

### Task 1: Pin Midscene and Add a Failing Isolation Contract

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/smoke/toolchain.test.ts`
- Create: `tests/smoke/midscene-isolation.test.ts`

**Interfaces:**

- Produces: the exact Midscene dependency, `test:exploratory` script contract, and static proof
  that the exploratory command remains outside mandatory CI.

- [ ] **Step 1: Add the exact dependency through pnpm**

Run:

```powershell
pnpm add --save-dev --save-exact @midscene/web@1.10.7
```

Expected: only `package.json` and `pnpm-lock.yaml` change; the manifest contains
`"@midscene/web": "1.10.7"`.

- [ ] **Step 2: Add the exact package script**

Add under `scripts`:

```json
"test:exploratory": "tsx scripts/run-midscene-exploratory.ts"
```

Do not modify `test`, `test:e2e`, or `verify:offline`.

- [ ] **Step 3: Extend the pinned toolchain test**

In `tests/smoke/toolchain.test.ts`, require:

```ts
expect(packageJson.devDependencies).toMatchObject({
  "@midscene/web": "1.10.7",
  "@playwright/test": "1.61.1",
});
expect(packageJson.scripts["test:exploratory"]).toBe("tsx scripts/run-midscene-exploratory.ts");
expect(packageJson.scripts["verify:offline"]).not.toContain("exploratory");
```

- [ ] **Step 4: Write the failing isolation contract**

Create `tests/smoke/midscene-isolation.test.ts`. It must read repository files and assert:

```ts
expect(await readFile("playwright.midscene.config.ts", "utf8")).toContain(
  'testDir: "./tests/exploratory"',
);
expect(await readFile("playwright.midscene.config.ts", "utf8")).toContain("workers: 1");
expect(await readFile("playwright.midscene.config.ts", "utf8")).toContain("retries: 0");
expect(await readFile(".gitignore", "utf8")).toContain(".tmp/");

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
expect(workflow).not.toContain("test:exploratory");
expect(workflow).not.toContain("MIDSCENE_MODEL_API_KEY");
```

Use a repository-root `resolve` helper so the test is platform-independent.

- [ ] **Step 5: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run tests/smoke/toolchain.test.ts tests/smoke/midscene-isolation.test.ts
```

Expected: toolchain assertions pass after the manifest edit; isolation test fails because the
configuration does not exist.

---

### Task 2: Implement the Guarded Bounded Runner

**Files:**

- Create: `tests/support/midscene-runner.ts`
- Create: `tests/support/midscene-runner.test.ts`
- Create: `scripts/run-midscene-exploratory.ts`

**Interfaces:**

- Produces:
  - `validateMidsceneEnvironment(env): MidsceneSettings`;
  - `buildMidsceneChildEnvironment(env, cwd): NodeJS.ProcessEnv`;
  - a bounded Playwright child runner.

- [ ] **Step 1: Write failing environment and runner tests**

Cover:

- opt-in must equal `"1"`;
- `MIDSCENE_MODEL_BASE_URL`, `MIDSCENE_MODEL_NAME`, and `MIDSCENE_MODEL_FAMILY` are required;
- `MIDSCENE_MODEL_API_KEY` is required unless base URL is exactly `codex://app-server`;
- empty, control-character, over-2,048-byte, and newline-bearing settings are rejected;
- the child receives only the explicit OS allowlist, approved Midscene variables, fixed
  `MIDSCENE_RUN_DIR`, timeout `60000`, retry count `0`, and opt-in flag;
- unrelated `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`, and DataHub tokens are absent;
- child success returns 0 and prints one fixed success message;
- child failure, spawn error, and 180-second outer timeout return 1 and print one fixed failure
  message without child stdout/stderr.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm vitest run tests/support/midscene-runner.test.ts
```

Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement strict environment validation**

Create `tests/support/midscene-runner.ts` with:

```ts
export interface MidsceneSettings {
  readonly baseUrl: string;
  readonly modelName: string;
  readonly modelFamily: string;
  readonly apiKey?: string;
}

export function validateMidsceneEnvironment(env: NodeJS.ProcessEnv): MidsceneSettings;

export function buildMidsceneChildEnvironment(
  env: NodeJS.ProcessEnv,
  cwd: string,
): NodeJS.ProcessEnv;
```

Validate every value before use. Keep API-key contents out of thrown messages. The child
environment must use the server lifecycle's non-secret OS allowlist plus only:

```text
LINEAGEGUARD_MIDSCENE_EXPLORATORY=1
MIDSCENE_MODEL_BASE_URL
MIDSCENE_MODEL_API_KEY (when required)
MIDSCENE_MODEL_NAME
MIDSCENE_MODEL_FAMILY
MIDSCENE_MODEL_TIMEOUT=60000
MIDSCENE_MODEL_RETRY_COUNT=0
MIDSCENE_RUN_DIR=<absolute cwd>/.tmp/midscene/run
```

Reject a symlinked `.tmp/midscene` root before launching.

- [ ] **Step 4: Implement the bounded script**

Create `scripts/run-midscene-exploratory.ts`:

1. validate settings;
2. resolve the installed `@playwright/test` CLI through `createRequire`;
3. spawn `process.execPath` with:

   ```text
   <resolved CLI> test --config=playwright.midscene.config.ts
   ```

4. use `shell: false`, `windowsHide: true`, ignored stdin, and piped stdout/stderr;
5. drain but never forward child output;
6. impose an outer 180-second deadline;
7. on timeout, terminate only the recorded process tree using the existing managed-process helper;
8. print `Midscene exploratory run completed.` only for exit 0;
9. print `Midscene exploratory run failed.` and set exit code 1 for every other outcome.

No error cause, environment value, model response, or native path may be printed.

- [ ] **Step 5: Run the runner tests and verify GREEN**

Run:

```powershell
pnpm vitest run tests/support/midscene-runner.test.ts
```

Expected: PASS without starting a browser or calling a model.

---

### Task 3: Add the Isolated Playwright Configuration and Visual Scenario

**Files:**

- Create: `playwright.midscene.config.ts`
- Create: `tests/exploratory/fixtures.ts`
- Create: `tests/exploratory/visual-workspace.spec.ts`
- Modify: `tsconfig.json`
- Test: `tests/smoke/midscene-isolation.test.ts`

**Interfaces:**

- Consumes: the current `playwright.config.ts`, managed global setup, REPLAY server, Chromium
  project, and Midscene Playwright fixture.
- Produces: one explicitly invoked visual assertion and local Midscene report.

- [ ] **Step 1: Create the isolated configuration**

Create `playwright.midscene.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.js";

if (process.env.LINEAGEGUARD_MIDSCENE_EXPLORATORY !== "1") {
  throw new Error("Midscene exploratory mode is disabled.");
}

export default defineConfig({
  ...baseConfig,
  testDir: "./tests/exploratory",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  globalTimeout: 120_000,
  reporter: [
    ["list"],
    [
      "@midscene/web/playwright-reporter",
      { type: "separate", outputFormat: "html-and-external-assets" },
    ],
  ],
});
```

Do not modify the mandatory `playwright.config.ts`.

- [ ] **Step 2: Add the Midscene fixture**

Create `tests/exploratory/fixtures.ts`:

```ts
import { test as base } from "@playwright/test";
import { PlaywrightAiFixture, type PlayWrightAiFixtureType } from "@midscene/web/playwright";

export const test = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({
    waitForNetworkIdleTimeout: 1_000,
    replanningCycleLimit: 3,
  }),
);
```

- [ ] **Step 3: Add one deterministic-action visual assertion**

Create `tests/exploratory/visual-workspace.spec.ts`:

```ts
import { expect } from "@playwright/test";
import { test } from "./fixtures.js";

test("visually explores the completed replay workspace", async ({ aiAssert, page }) => {
  await page.goto("/");
  await expect(page.locator(".mode-badge")).toHaveText("Fixture replay");

  await page.getByRole("button", { name: "Analyze change" }).click();

  await expect(page.getByText("BLOCK DIRECT RENAME", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence completeness" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Context coverage" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();

  await aiAssert(
    "The risk decision, evidence completeness, context coverage, runtime proof, and artifact workspace are visually readable, clearly separated, and free of overlapping or clipped text.",
  );
});
```

Do not add `aiAct`, `aiTap`, model-selected navigation, or a second exploratory test.

- [ ] **Step 4: Add the alternate configuration to strict type checking**

Add `"playwright.midscene.config.ts"` to `tsconfig.json` `include`. Do not exclude
`tests/exploratory`.

- [ ] **Step 5: Run offline static verification**

Run:

```powershell
pnpm vitest run tests/smoke/midscene-isolation.test.ts tests/support/midscene-runner.test.ts
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0 without a model call.

- [ ] **Step 6: Verify the disabled gate**

Run without Midscene variables:

```powershell
pnpm test:exploratory
```

Expected: exit 1 with only the fixed public message `Midscene exploratory run failed.` and no
native path, stack, or environment value.

- [ ] **Step 7: Run the live exploratory check only when explicitly configured**

Set the following in the current shell, not in a tracked file:

```text
LINEAGEGUARD_MIDSCENE_EXPLORATORY=1
MIDSCENE_MODEL_BASE_URL=<operator-selected compatible endpoint or codex://app-server>
MIDSCENE_MODEL_NAME=<operator-selected multimodal model>
MIDSCENE_MODEL_FAMILY=<matching Midscene family>
MIDSCENE_MODEL_API_KEY=<required only for a keyed endpoint>
```

Then run:

```powershell
pnpm test:exploratory
```

Expected: one Chromium test runs against REPLAY, produces a report only beneath
`.tmp/midscene/run`, and exits 0. If no model configuration is supplied, mark this live check
`NOT RUN`; never describe it as passing.

---

### Task 4: Document Isolation and Run Final Offline Gates

**Files:**

- Create: `docs/testing/midscene-exploratory.md`
- Test: all files created or modified above.

**Interfaces:**

- Produces: operator guidance and final offline acceptance evidence.

- [ ] **Step 1: Write the operator guide**

Document:

- Midscene's visual exploratory purpose and non-authoritative status;
- exact version `1.10.7`;
- required opt-in and preferred `MIDSCENE_MODEL_*` variables;
- API-key versus `codex://app-server` configuration;
- the fixed timeout/retry/cycle bounds;
- deterministic Playwright actions and the single AI visual assertion;
- ignored report root `.tmp/midscene/run`;
- prohibition on tracked credentials, report upload, mandatory CI use, GitHub operations, and
  treating exploratory success as deterministic acceptance.

- [ ] **Step 2: Run focused formatting and tests**

Run:

```powershell
pnpm exec prettier --check playwright.midscene.config.ts tests/exploratory tests/support/midscene-runner.ts tests/support/midscene-runner.test.ts scripts/run-midscene-exploratory.ts docs/testing/midscene-exploratory.md package.json tsconfig.json
pnpm vitest run tests/smoke/toolchain.test.ts tests/smoke/midscene-isolation.test.ts tests/support/midscene-runner.test.ts
pnpm lint
pnpm typecheck
```

Expected: every command exits 0 without Midscene network access.

- [ ] **Step 3: Prove mandatory browser selection excludes exploratory tests**

Run:

```powershell
pnpm exec playwright test --project=chromium --list
```

Expected: every `tests/e2e` test is listed and no `tests/exploratory` test is listed.

- [ ] **Step 4: Run final repository gates**

Run:

```powershell
pnpm test
pnpm build
pnpm test:runtime-mode
pnpm test:e2e --project=chromium
pnpm security:scan
pnpm verify:offline
git diff --check
git status --short
```

Expected:

- every mandatory gate exits 0;
- no model or Midscene call occurs;
- the full E2E list executes;
- manifest and lockfile contain exact `1.10.7`;
- CI contains no exploratory command or Midscene credential;
- no generated Midscene report is tracked;
- the live exploratory check is reported separately as `PASSED`, `FAILED`, or `NOT RUN`.

Inspect the focused diff. Do not commit or change GitHub state.
