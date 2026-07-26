# Deterministic PR Impact Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce bounded deterministic advisory PR impact JSON and Markdown from validated local
Git paths and the completed full Playwright run, with a read-only pull-request job summary.

**Architecture:** Pure TypeScript modules validate changed paths, map them to stable browser tags,
aggregate Playwright results, render bounded reports, and publish them atomically. A thin local-Git
adapter prepares PR context, a thin reporter adapter observes the full suite without changing its
status, and a separate guarded script appends an already validated report to
`GITHUB_STEP_SUMMARY`.

**Tech Stack:** Node.js 22.23.1, pnpm 10.10.0, TypeScript 6.0.3, Zod 4.4.3, Playwright Test 1.61.1,
Vitest 4.1.10, GitHub Actions.

**Prerequisite:** Complete
`docs/superpowers/plans/2026-07-26-playwright-test-agents.md` first. This plan tags the
`tests/e2e/seed.spec.ts` created there and must review the combined Playwright configuration.

## Global Constraints

- Treat the approved design in
  `docs/superpowers/specs/2026-07-26-playwright-agents-pr-impact-midscene-design.md` as authority.
- Run the complete Chromium suite regardless of impact.
- Keep reports advisory and unable to alter Playwright status or exit code.
- Read only Git filenames, never changed-file contents.
- Accept only normalized bounded repository-relative paths and strict 40-hex Git identifiers.
- Use local Git with fixed argument arrays, `shell: false`, timeout, cancellation, and bounded
  output.
- Keep Markdown at or below 32 KiB, JSON at or below 256 KiB, paths at or below 2,000 entries and
  256 KiB aggregate.
- Keep GitHub permissions at `contents: read`; retain immutable action SHAs and
  `persist-credentials: false`.
- Do not call GitHub APIs or create comments, Check Runs, labels, commits, branches, or PRs.
- Keep mandatory CI deterministic, offline during test execution, secret-free, and independent of
  DataHub, OpenAI, and Midscene.
- Do not commit, push, create branches, or change GitHub state without separate owner permission.

---

### Task 1: Define Stable Tags, Contracts, and Pure Path Mapping

**Files:**

- Create: `tests/support/pr-impact/contracts.ts`
- Create: `tests/support/pr-impact/scenario-tags.ts`
- Create: `tests/support/pr-impact/impact-map.ts`
- Create: `tests/support/pr-impact/impact-map.test.ts`

**Interfaces:**

- Produces:
  - `SCENARIO_TAGS`;
  - `ScenarioTag`;
  - `ImpactContext`;
  - `ImpactReport`;
  - `normalizeChangedPaths(values)`;
  - `classifyChangedPaths(paths)`.
- Consumed by every later PR impact task.

- [ ] **Step 1: Write the failing mapping tests**

Create `tests/support/pr-impact/impact-map.test.ts` with tests that assert:

```ts
expect(classifyChangedPaths(["app/page.tsx", "src/ui/demo-client.tsx"])).toMatchObject({
  disposition: "MAPPED",
  impactedAreas: ["browser-ui"],
  expectedTags: ["@golden-flow", "@responsive", "@runtime-proof", "@shell"],
  reasonCodes: [],
});

expect(classifyChangedPaths(["unknown/new-surface.ts"])).toMatchObject({
  disposition: "FULL_SUITE_REQUIRED",
  expectedTags: [...SCENARIO_TAGS],
  reasonCodes: ["UNMAPPED_PATH"],
});

expect(classifyChangedPaths(["package.json"])).toMatchObject({
  disposition: "FULL_SUITE_REQUIRED",
  expectedTags: [...SCENARIO_TAGS],
  reasonCodes: ["CRITICAL_TOOLING_CHANGE"],
});
```

Add boundary cases for:

- `C:\private\file.ts`;
- `/private/file.ts`;
- `../escape.ts`;
- `safe/../escape.ts`;
- a NUL or ANSI escape;
- an empty path;
- a path longer than 512 UTF-8 bytes;
- 2,001 paths;
- aggregate UTF-8 input larger than 256 KiB;
- duplicated and backslash-separated valid paths;
- deterministic ordering for permuted input.

- [ ] **Step 2: Run the mapping test and verify RED**

Run:

```powershell
pnpm vitest run tests/support/pr-impact/impact-map.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define the exact stable tag vocabulary**

Create `tests/support/pr-impact/scenario-tags.ts`:

```ts
export const SCENARIO_TAGS = [
  "@artifact-safety",
  "@golden-flow",
  "@harness",
  "@responsive",
  "@runtime-proof",
  "@shell",
  "@workflow-terminal",
] as const;

export type ScenarioTag = (typeof SCENARIO_TAGS)[number];
```

- [ ] **Step 4: Define strict versioned contracts**

Create `tests/support/pr-impact/contracts.ts` with Zod schemas for:

```ts
export const ImpactDispositionSchema = z.enum(["MAPPED", "FULL_SUITE_REQUIRED"]);
export const ImpactSourceSchema = z.enum(["PULL_REQUEST", "IMPACT_CONTEXT_UNAVAILABLE"]);
export const ImpactReasonCodeSchema = z.enum([
  "CRITICAL_TOOLING_CHANGE",
  "EMPTY_CHANGE_SET",
  "GIT_COMPARISON_UNAVAILABLE",
  "IMPACT_INPUT_INVALID",
  "IMPACT_INPUT_LIMIT_REACHED",
  "NON_PULL_REQUEST",
  "UNMAPPED_PATH",
]);
export const PlaywrightStatusSchema = z.enum(["passed", "failed", "timedout", "interrupted"]);
```

Define `ImpactContextSchema` with exact literal `schemaVersion: "1"`, source, disposition,
`changedPaths`, sorted `impactedAreas`, sorted `expectedTags`, and sorted unique `reasonCodes`.
Define `ImpactReportSchema` with the context fields plus sorted `discoveredTags`,
`completedTags`, `failedTags`, `missingTags`, nonnegative integer counts for passed, failed,
timed-out, interrupted, skipped, and retried tests, and `playwrightStatus`.

Apply schema-level caps matching the global constraints. Export inferred `ImpactContext` and
`ImpactReport` types.

- [ ] **Step 5: Implement normalization and the exhaustive path map**

Create `tests/support/pr-impact/impact-map.ts`. `normalizeChangedPaths` must:

1. reject non-strings, empty values, absolute Windows or POSIX paths, drive prefixes, `..`
   segments, NUL, C0/C1 controls, and values over 512 UTF-8 bytes;
2. replace `\` with `/`;
3. remove only leading `./`;
4. deduplicate;
5. sort with byte-stable code-point comparison;
6. enforce the count and aggregate-byte caps before returning.

`classifyChangedPaths` must use this ordered map:

| Repository path                                                                                                                                                                                        | Area                                 | Expected tags                                             | Disposition           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------- | --------------------- |
| `app/**`, `src/ui/**`                                                                                                                                                                                  | `browser-ui`                         | `@golden-flow`, `@responsive`, `@runtime-proof`, `@shell` | `MAPPED`              |
| `src/agent/**`, `src/app/**`, `src/datahub/**`, `src/demo/**`, `src/domain/**`, `src/runtime/**`, `src/workflow/**`                                                                                    | `workflow-runtime`                   | `@golden-flow`, `@runtime-proof`, `@workflow-terminal`    | `MAPPED`              |
| `src/artifacts/**`, `src/errors/**`, `src/http/**`, `src/migrations/**`, `src/runs/**`, `src/security/**`                                                                                              | `artifact-and-boundary-safety`       | `@artifact-safety`, `@workflow-terminal`                  | `MAPPED`              |
| `tests/e2e/server-lifecycle.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/global-teardown.ts`                                                                                                           | `e2e-harness`                        | `@harness` plus every tag                                 | `FULL_SUITE_REQUIRED` |
| `playwright.config.ts`, `.github/workflows/**`, `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`, `AGENTS.md`, `docs/specs/**`, `docs/superpowers/specs/**` | `repository-authority-and-toolchain` | every tag                                                 | `FULL_SUITE_REQUIRED` |
| all other paths                                                                                                                                                                                        | `unmapped`                           | every tag                                                 | `FULL_SUITE_REQUIRED` |

Combine multiple matches with sorted unique unions. Any full-suite rule dominates `MAPPED`.

- [ ] **Step 6: Run the mapping tests and verify GREEN**

Run:

```powershell
pnpm vitest run tests/support/pr-impact/impact-map.test.ts
```

Expected: PASS with positive, negative, boundary, and deterministic-order cases.

---

### Task 2: Add Bounded Local-Git Collection and Atomic Context Publication

**Files:**

- Create: `tests/support/pr-impact/change-context.ts`
- Create: `tests/support/pr-impact/change-context.test.ts`
- Create: `tests/support/pr-impact/publication.ts`
- Create: `tests/support/pr-impact/publication.test.ts`
- Create: `scripts/prepare-pr-impact.ts`

**Interfaces:**

- Consumes: `normalizeChangedPaths`, `classifyChangedPaths`, environment values, and local Git.
- Produces:
  - `prepareImpactContext(options): Promise<ImpactContext>`;
  - `publishImpactContext(context, cwd): Promise<void>`;
  - `publishImpactReport(json, markdown, cwd): Promise<void>`;
  - `.tmp/pr-impact/context.json`.

- [ ] **Step 1: Write failing adapter and publication tests**

Use dependency injection for the Git executor. Tests must prove:

- a pull-request base/head pair invokes exactly:

  ```text
  git diff --name-only -z --diff-filter=ACMR <base>...<head> --
  ```

- both refs must match `/^[0-9a-f]{40}$/u`;
- the executor uses `shell: false`, a 10-second timeout, and a 262,144-byte output cap;
- non-PR events return `IMPACT_CONTEXT_UNAVAILABLE` plus `NON_PULL_REQUEST`;
- invalid refs, Git failure, timeout, overflow, and invalid output return
  `FULL_SUITE_REQUIRED` with a fixed allowlisted reason and no raw error;
- atomic publication writes only `.tmp/pr-impact/context.json`;
- publication rejects a symlinked or escaped output root and never emits an absolute path.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run tests/support/pr-impact/change-context.test.ts tests/support/pr-impact/publication.test.ts
```

Expected: FAIL because the adapters do not exist.

- [ ] **Step 3: Implement the bounded adapter**

Create `tests/support/pr-impact/change-context.ts` with:

```ts
export interface GitDiffExecutor {
  (cwd: string, baseSha: string, headSha: string): Promise<Buffer>;
}

export interface PrepareImpactContextOptions {
  readonly cwd: string;
  readonly eventName: string | undefined;
  readonly baseSha: string | undefined;
  readonly headSha: string | undefined;
  readonly executeGit?: GitDiffExecutor;
}

export async function prepareImpactContext(
  options: PrepareImpactContextOptions,
): Promise<ImpactContext>;
```

The default executor uses `execFile("git", args, { cwd, encoding: "buffer", maxBuffer: 262_144,
timeout: 10_000, windowsHide: true })` and never enables a shell. Split the output on NUL, require a
terminal empty segment, decode with fatal UTF-8, normalize, and classify. Catch every dependency
error and return only fixed reason codes.

- [ ] **Step 4: Implement guarded atomic publication**

Create `tests/support/pr-impact/publication.ts` with fixed constants:

```ts
export const IMPACT_CONTEXT_PATH = ".tmp/pr-impact/context.json";
export const IMPACT_REPORT_JSON_PATH = "test-results/pr-impact/report.json";
export const IMPACT_REPORT_MARKDOWN_PATH = "test-results/pr-impact/report.md";
```

Resolve the parent against `cwd`, reject symlinks and any canonical parent outside the exact
approved root, create the directory, write a same-directory uniquely named temporary file with
`flag: "wx"`, verify the byte cap, rename atomically, and remove only that owned temporary file on
failure. `publishImpactContext` applies the 256 KiB context cap.
`publishImpactReport(json, markdown, cwd)` applies the 256 KiB JSON and 32 KiB Markdown caps,
creates one sibling staging directory beneath `test-results`, writes both fixed files with
create-only flags, validates both, and atomically renames that directory to
`test-results/pr-impact`. It must fail closed if the final directory already exists and remove
only its own staging directory on failure, so a partial report can never appear final.

- [ ] **Step 5: Add the guarded CLI**

Create `scripts/prepare-pr-impact.ts` that reads only:

- `GITHUB_EVENT_NAME`;
- `LINEAGEGUARD_PR_BASE_SHA`;
- `LINEAGEGUARD_PR_HEAD_SHA`;

It calls `prepareImpactContext`, validates the result with `ImpactContextSchema`, publishes it, and
prints only:

```text
PR impact context prepared.
```

On unexpected failure it prints `PR impact context is unavailable.` and exits 1 without a raw
cause.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
pnpm vitest run tests/support/pr-impact/change-context.test.ts tests/support/pr-impact/publication.test.ts
```

Expected: PASS.

---

### Task 3: Aggregate Playwright Results and Render Bounded Reports

**Files:**

- Create: `tests/support/pr-impact/report.ts`
- Create: `tests/support/pr-impact/report.test.ts`
- Create: `tests/e2e/reporters/pr-impact-reporter.ts`
- Create: `tests/support/pr-impact/reporter-adapter.test.ts`

**Interfaces:**

- Consumes: optional `.tmp/pr-impact/context.json`, Playwright discovered tests and terminal
  results.
- Produces: validated `ImpactReport`, bounded Markdown, and final report files.

- [ ] **Step 1: Write failing aggregation and reporter tests**

Test byte-identical output under permuted discovery/result order and cover:

- passed, failed, timed-out, interrupted, skipped, expected-failure, and retried tests;
- expected, discovered, completed, failed, and missing tags;
- invalid or missing context falling closed to full-suite-required;
- Markdown escaping for `*`, `_`, brackets, backticks, `<`, `>`, and pipe;
- 32 KiB Markdown and 256 KiB JSON caps;
- publication failure returning `undefined` from reporter `onEnd`;
- reporter `onEnd` returning `Promise<void>` and never a status override.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run tests/support/pr-impact/report.test.ts tests/support/pr-impact/reporter-adapter.test.ts
```

Expected: FAIL because report and reporter modules do not exist.

- [ ] **Step 3: Implement pure aggregation and rendering**

Create `tests/support/pr-impact/report.ts` with:

```ts
export interface ObservedTestResult {
  readonly id: string;
  readonly tags: readonly string[];
  readonly expectedStatus: string;
  readonly attempts: readonly {
    readonly retry: number;
    readonly status: string;
  }[];
}

export function buildImpactReport(
  context: ImpactContext,
  playwrightStatus: "passed" | "failed" | "timedout" | "interrupted",
  tests: readonly ObservedTestResult[],
): ImpactReport;

export function renderImpactMarkdown(report: ImpactReport): string;
```

Reduce tags through the `SCENARIO_TAGS` allowlist. Use only the last attempt for terminal
classification; an actual status equal to `expectedStatus` counts as passed, including an expected
failure, while an unexpected terminal status counts in its matching failed, timed-out,
interrupted, or skipped bucket. Count `retried` once when a test has more than one attempt.
`missingTags` is the sorted set difference `expectedTags - discoveredTags`; `completedTags`
contains allowlisted tags attached to tests with a terminal last attempt; `failedTags` contains
tags attached to unexpected failed, timed-out, or interrupted tests. Sort tests by ID and all sets
lexically before rendering. Render fixed headings, disposition, impacted areas, tag
reconciliation, and aggregate counts. Never render titles, errors, stacks, attachments, stdout,
stderr, or native paths.

- [ ] **Step 4: Implement the thin Playwright reporter**

`tests/e2e/reporters/pr-impact-reporter.ts` implements `Reporter`:

- `onBegin` records allowlisted tags for all discovered tests;
- `onTestEnd` appends only test ID, allowlisted tags, expected status, retry number, and result
  status;
- `onEnd` removes only the fixed stale generated report directory, loads and validates context,
  builds the report, validates it, renders JSON and Markdown, atomically publishes both, catches
  all errors, and returns no value without changing or obscuring Playwright's result;
- `printsToStdio()` returns `false`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
pnpm vitest run tests/support/pr-impact/report.test.ts tests/support/pr-impact/reporter-adapter.test.ts
```

Expected: PASS.

---

### Task 4: Tag Every Browser Scenario and Register the Advisory Reporter

**Files:**

- Modify: `tests/e2e/lineageguard-demo.spec.ts`
- Modify: `tests/e2e/seed.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `tests/smoke/toolchain.test.ts`

**Interfaces:**

- Consumes: stable `ScenarioTag` values and the reporter.
- Produces: complete scenario-tag discovery without changing which tests run.

- [ ] **Step 1: Add a failing smoke assertion for scripts and reporter registration**

Extend `tests/smoke/toolchain.test.ts` to require:

```ts
expect(packageJson.scripts).toMatchObject({
  "prepare:pr-impact": "tsx scripts/prepare-pr-impact.ts",
  "summary:pr-impact": "tsx scripts/append-pr-impact-summary.ts",
});
expect(packageJson.scripts["verify:offline"]).toBe(
  "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:runtime-mode && pnpm test:e2e --project=chromium",
);
```

Run the focused smoke test and expect RED until scripts are added.

- [ ] **Step 2: Add stable tags without changing test bodies**

Use Playwright's details argument `{ tag: [...] }`. Apply this exact classification:

- icon and seed: `@shell`; seed also `@harness`;
- golden grounded replay: `@golden-flow`, `@runtime-proof`;
- ambiguity, typed failures, workflow redaction, incomplete evidence, cancellation, regeneration,
  retry, request-network failure, and invalid NDJSON: `@workflow-terminal`;
- tab relationships, artifact response rejection/cancellation, stale loads, byte/UTF-8 bounds,
  clipboard, copy, and downloads: `@artifact-safety`;
- phone viewport and long unbroken artifact: `@responsive`.

Tests with overlapping behavior may carry multiple tags; every test must carry at least one
allowlisted tag. Do not rename tests or change their assertions.

- [ ] **Step 3: Register the reporter in both local and CI configurations**

Refactor `playwright.config.ts` reporter selection to retain existing reporters and append:

```ts
["./tests/e2e/reporters/pr-impact-reporter.ts"];
```

Keep the existing `testDir`, retries, global setup, base URL, screenshot, trace, and Chromium
project unchanged. Keep `fullyParallel: false` and make `workers: 1` explicit because the new seed
file shares one stateful REPLAY harness with the main browser spec.

- [ ] **Step 4: Add the package scripts**

Add:

```json
"prepare:pr-impact": "tsx scripts/prepare-pr-impact.ts",
"summary:pr-impact": "tsx scripts/append-pr-impact-summary.ts"
```

Do not alter `verify:offline`.

- [ ] **Step 5: Prove Playwright still selects the full suite**

Run:

```powershell
pnpm exec playwright test --project=chromium --list
pnpm test:e2e --project=chromium
```

Record the exact listed and executed test counts and require them to match. Confirm
`test-results/pr-impact/report.json` and `report.md` exist after the run.

---

### Task 5: Append a Guarded PR Summary and Integrate Read-Only CI

**Files:**

- Create: `scripts/append-pr-impact-summary.ts`
- Create: `tests/support/pr-impact/summary.ts`
- Create: `tests/support/pr-impact/summary.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: validated `test-results/pr-impact/report.md` and GitHub-provided
  `GITHUB_STEP_SUMMARY`.
- Produces:
  - `appendImpactSummary(options): Promise<"APPENDED" | "SKIPPED">`;
  - a bounded pull-request job summary and bounded CI artifact, with no API call.

- [ ] **Step 1: Write failing summary tests**

Cover:

- non-PR event: no write;
- missing report: no write;
- relative or missing summary target: fixed failure;
- report over 32 KiB: rejected;
- valid PR report: appended byte-for-byte plus one newline;
- no raw path or error in thrown or printed messages.

- [ ] **Step 2: Implement the guarded summary script**

Create `tests/support/pr-impact/summary.ts` with:

```ts
export interface AppendImpactSummaryOptions {
  readonly cwd: string;
  readonly eventName: string | undefined;
  readonly summaryPath: string | undefined;
}

export async function appendImpactSummary(
  options: AppendImpactSummaryOptions,
): Promise<"APPENDED" | "SKIPPED">;
```

The function must:

1. require `GITHUB_EVENT_NAME === "pull_request"`;
2. validate and read the fixed report path beneath the repository;
3. validate UTF-8 and the 32 KiB cap;
4. require an absolute `GITHUB_STEP_SUMMARY`;
5. append with `flag: "a"` and no shell;
6. print only `PR impact summary appended.` on success;
7. write nothing when the report is absent;
8. replace all other failures with `PR impact summary is unavailable.`.

Create `scripts/append-pr-impact-summary.ts` as a thin guarded entrypoint. It calls
`appendImpactSummary` with `process.cwd()`, `GITHUB_EVENT_NAME`, and `GITHUB_STEP_SUMMARY`; prints
`PR impact summary appended.` only for `APPENDED`; prints nothing for `SKIPPED`; and prints only the
fixed unavailable message with exit code 1 for a rejected write.

- [ ] **Step 3: Update checkout depth without weakening checkout security**

In `.github/workflows/ci.yml`, retain the pinned checkout SHA and
`persist-credentials: false`, and add:

```yaml
fetch-depth: 0
```

This provides local Git comparison data; it does not authorize an API call.

- [ ] **Step 4: Prepare PR context before the unchanged offline gate**

Add a step gated by `github.event_name == 'pull_request'`:

```yaml
- name: Prepare advisory PR impact context
  if: github.event_name == 'pull_request'
  env:
    GITHUB_EVENT_NAME: ${{ github.event_name }}
    LINEAGEGUARD_PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}
    LINEAGEGUARD_PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  run: pnpm prepare:pr-impact
```

Do not add secrets or permissions.

- [ ] **Step 5: Publish bounded report artifacts and summary after the gate**

After `Run offline validation gate`, add:

```yaml
- name: Upload advisory PR impact report
  if: always() && github.event_name == 'pull_request'
  uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7.0.0
  with:
    name: pr-impact-report
    path: test-results/pr-impact
    if-no-files-found: ignore
    retention-days: 7

- name: Append advisory PR impact summary
  if: always() && github.event_name == 'pull_request'
  env:
    GITHUB_EVENT_NAME: ${{ github.event_name }}
  run: pnpm summary:pr-impact
```

Keep the existing failure-artifact step and `permissions: contents: read`.

- [ ] **Step 6: Add positive and negative CI contract assertions**

Extend the relevant smoke test to read `.github/workflows/ci.yml` and assert:

- `contents: read`;
- `persist-credentials: false`;
- `fetch-depth: 0`;
- both new steps are PR-gated;
- the exact pinned upload-artifact SHA;
- no `pull-requests: write`, `checks: write`, `issues: write`, `gh `, GitHub API URL,
  `actions/github-script`, or PR-comment action.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
$prImpactTests = Get-ChildItem tests/support/pr-impact -Filter *.test.ts |
  Sort-Object FullName |
  ForEach-Object { $_.FullName }
$prImpactTests
pnpm vitest run $prImpactTests tests/smoke/toolchain.test.ts
```

Record the resolved file count before the run. Expected: every listed PR impact unit test and the
toolchain smoke test passes.

---

### Task 6: Document and Complete the Offline Verification

**Files:**

- Create: `docs/testing/pr-impact-reporting.md`
- Test: all files created or modified above.

**Interfaces:**

- Produces: operator documentation and final acceptance evidence.

- [ ] **Step 1: Document the advisory contract**

Write `docs/testing/pr-impact-reporting.md` with:

- purpose and explicit statement that the full suite always runs;
- local context preparation and report paths;
- reason-code meanings;
- 2,000-path, 256 KiB aggregate, 256 KiB JSON, and 32 KiB Markdown limits;
- pull-request-only summary behavior;
- fixed unavailable/full-suite fallbacks;
- prohibition on PR comments, Check Runs, GitHub APIs, write permissions, raw errors, and native
  paths.

- [ ] **Step 2: Run focused formatting, lint, type, and unit checks**

Run:

```powershell
pnpm exec prettier --check tests/support/pr-impact tests/e2e/reporters/pr-impact-reporter.ts scripts/prepare-pr-impact.ts scripts/append-pr-impact-summary.ts docs/testing/pr-impact-reporting.md playwright.config.ts .github/workflows/ci.yml
pnpm lint
pnpm typecheck
pnpm test
```

Expected: every command exits 0.

- [ ] **Step 3: Run the complete browser and repository gates**

Run:

```powershell
pnpm exec playwright test --project=chromium --list
pnpm test:e2e --project=chromium
pnpm build
pnpm test:runtime-mode
pnpm security:scan
pnpm verify:offline
git diff --check
git status --short
```

Expected:

- list and executed counts match;
- every browser test runs;
- Playwright determines the exit code;
- reports satisfy schema and byte caps;
- non-PR local output is fixed unavailable/full-suite guidance;
- every repository gate exits 0;
- secret scan passes;
- no runtime file, permission expansion, GitHub mutation, or unrelated file is present.

Inspect the focused diff. Do not commit or change GitHub state.
