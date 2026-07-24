# Flat Storage Cumulative Gate Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three blockers from the flat-storage cumulative review so the approved Next.js
and OpenAI plan can safely resume at Task 7.

**Architecture:** Make persisted `ChangeContext` values deep-strict, require an explicit absolute
CLI runs root and preflight it before DataHub work, then rewrite every active downstream plan
instruction to use pre-created absolute roots and immutable flat envelopes. Reuse the existing
schemas, typed errors, and `assertTrustedRunsRoot` boundary; do not introduce another storage
abstraction or create production roots.

**Tech Stack:** Node.js 22.23.1, pnpm 10.10.0, TypeScript 6.0.3, Zod 4.4.3, Vitest 4.1.10,
Next.js 16.2.11, PowerShell, local filesystem persistence.

## Global Constraints

- Treat `docs/superpowers/specs/2026-07-24-flat-storage-cumulative-gate-remediation-design.md` as
  the authority for this remediation.
- Preserve strict TypeScript, ESM, existing relative `.js` imports, exact dependency versions, and
  all current repository gates.
- Keep production storage create-only, flat, immutable, path-free, and constrained to a
  pre-created trusted root.
- Select the CLI root as `--runs-dir`, then `LINEAGEGUARD_RUNS_DIR`, then a fixed configuration
  failure.
- Never create the production root in application code.
- Keep mandatory tests deterministic, offline, credential-free, and independent of live DataHub or
  OpenAI.
- Do not resume the main Next.js and OpenAI plan until every task below and the final cumulative
  review pass.

---

### Task 1: Reject Deep Unknown ChangeContext Keys

**Files:**

- Modify: `src/workflow/change-context.ts`
- Modify: `src/workflow/change-context.test.ts`
- Modify: `src/runs/run-envelope.test.ts`

**Interfaces:**

- Consumes: existing `ChangeContextSchema`, `RunEnvelopeSchema`, `parseRunEnvelope`, and test
  factories.
- Produces: a deep-strict persisted `ChangeContext` contract with unchanged valid canonical hashes.

- [ ] **Step 1: Add direct deep-strict schema tests**

In `src/workflow/change-context.test.ts`, extend the existing `change-context.js` import with
`type ChangeContext`, build one valid context, and add a table whose mutators add
`extra: "forbidden"` independently to:

```ts
const deepUnknownCases = [
  [
    "intent",
    (value: ChangeContext) => ({ ...value, intent: { ...value.intent, extra: "forbidden" } }),
  ],
  [
    "target",
    (value: ChangeContext) => ({ ...value, target: { ...value.target, extra: "forbidden" } }),
  ],
  [
    "sourceField",
    (value: ChangeContext) => ({
      ...value,
      sourceField: { ...value.sourceField, extra: "forbidden" },
    }),
  ],
  [
    "assessment",
    (value: ChangeContext) => ({
      ...value,
      assessment: { ...value.assessment, extra: "forbidden" },
    }),
  ],
  [
    "assessment factor",
    (value: ChangeContext) => ({
      ...value,
      assessment: {
        ...value.assessment,
        factors: [
          { ...value.assessment.factors[0]!, extra: "forbidden" },
          ...value.assessment.factors.slice(1),
        ],
      },
    }),
  ],
] as const;

it.each(deepUnknownCases)("rejects an unknown nested %s key", (_name, mutate) => {
  expect(() => ChangeContextSchema.parse(mutate(validContext))).toThrow();
});
```

Retain the existing valid round-trip assertion and add:

```ts
expect(ChangeContextSchema.parse(validContext)).toEqual(validContext);
```

- [ ] **Step 2: Add run-envelope regression tests**

In `src/runs/run-envelope.test.ts`, reuse the completed-envelope factory. Add the same five nested
mutations under `envelope.context`, keep the original stored hashes unchanged, serialize the raw
object with `JSON.stringify`, and assert both entry points fail:

```ts
expect(() => RunEnvelopeSchema.parse(mutatedEnvelope)).toThrow();
expect(() =>
  parseRunEnvelope(`${JSON.stringify(mutatedEnvelope, null, 2)}\n`, mutatedEnvelope.runId),
).toThrowError(
  expect.objectContaining({
    code: "ARTIFACT_WRITE_FAILED",
    message: "The stored run is unavailable.",
    details: {},
  }),
);
```

The test must prove the raw nested key is rejected, not stripped and re-hashed.

- [ ] **Step 3: Run the focused tests and prove RED**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/workflow/change-context.test.ts src/runs/run-envelope.test.ts
```

Expected: five direct and five envelope-level cases fail because the affected nested Zod objects
strip unknown keys.

- [ ] **Step 4: Make every affected nested object strict**

In `src/workflow/change-context.ts`, replace the five non-strict object expressions with:

```ts
intent: z
  .object({
    kind: z.literal("rename_column"),
    datasetHint: z.string().min(1),
    sourceColumn: z.string().min(1),
    targetColumn: z.string().min(1),
  })
  .strict(),
target: z
  .object({
    urn: z.string().startsWith("urn:li:").max(500),
    name: z.string().min(1).max(500),
    platform: z.string().max(100).optional(),
    environment: z.string().max(100).optional(),
  })
  .strict(),
sourceField: z
  .object({
    fieldPath: z.string().min(1).max(500),
    nativeDataType: z.string().max(100).optional(),
  })
  .strict(),
assessment: z
  .object({
    score: z.number().int().min(0).max(100),
    level: z.enum(["low", "medium", "high", "critical"]),
    confidence: z.enum(["low", "medium", "high"]),
    factors: z.array(
      z
        .object({
          name: z.string(),
          points: z.number().int(),
          explanation: z.string(),
        })
        .strict(),
    ),
  })
  .strict(),
```

Do not change field bounds, hash construction, sanitization, or valid output ordering.

- [ ] **Step 5: Run focused and cumulative verification**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/workflow/change-context.test.ts src/runs/run-envelope.test.ts
& .\node_modules\.bin\vitest.cmd run src/runs/run-envelope.test.ts src/artifacts/run-envelope-files.test.ts src/artifacts/write-run-artifacts.test.ts src/runs/run-store.test.ts src/security/sanitize-validation-findings.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
git diff --check
```

Expected: direct strictness, envelope integrity, storage, sanitizer, type, formatting, and lint gates
pass. Lint may retain only the accepted `prettier.config.mjs` warning.

- [ ] **Step 6: Commit deep strictness**

```powershell
git add src/workflow/change-context.ts src/workflow/change-context.test.ts src/runs/run-envelope.test.ts
git commit -m "fix: reject deep change context extensions"
```

---

### Task 2: Require and Preflight the CLI Trusted Runs Root

**Files:**

- Modify: `src/config/runtime-config.ts`
- Modify: `src/config/runtime-config.test.ts`
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `AppError`, `assertTrustedRunsRoot`, CLI `--runs-dir`, and the current runtime
  configuration.
- Produces: exported `RunsRootPathSchema`, `loadRuntimeConfig(environment, runsRootOverride?)`,
  flag-over-env precedence, and pre-DataHub trusted-root validation.

- [ ] **Step 1: Add failing runtime-configuration tests**

In `src/config/runtime-config.test.ts`, define native absolute examples with `resolve`:

```ts
const absoluteEnvironment = {
  ...minimumEnvironment,
  LINEAGEGUARD_RUNS_DIR: resolve("test-runs"),
};
```

Replace the relative-default assertions with:

```ts
it("requires an explicit runs root", () => {
  expect(() => loadRuntimeConfig(minimumEnvironment)).toThrowError(
    expect.objectContaining({ code: "ARTIFACT_WRITE_FAILED" }),
  );
});

it("rejects a relative runs root", () => {
  expect(() =>
    loadRuntimeConfig({ ...minimumEnvironment, LINEAGEGUARD_RUNS_DIR: "relative-runs" }),
  ).toThrowError(expect.objectContaining({ code: "ARTIFACT_WRITE_FAILED" }));
});

it("lets an absolute CLI override win over the environment", () => {
  const override = resolve("override-runs");
  expect(
    loadRuntimeConfig(
      { ...minimumEnvironment, LINEAGEGUARD_RUNS_DIR: resolve("environment-runs") },
      override,
    ).runsRoot,
  ).toBe(override);
});
```

Retain DataHub URL/token, pinned `uvx`, token non-enumerability, and absolute environment-root
coverage.

- [ ] **Step 2: Add failing CLI preflight tests**

In `src/cli.test.ts`, import `mkdtemp`, `mkdir`, `rm`, `symlink`, and `writeFile` from
`node:fs/promises`, plus `tmpdir` and `join`.

Create one suite-owned sandbox and real root:

```ts
let cliSandbox: string;
let defaultRunsRoot: string;

beforeAll(async () => {
  cliSandbox = await mkdtemp(join(tmpdir(), "lineageguard-cli-root-"));
  defaultRunsRoot = await mkdtemp(join(cliSandbox, "runs-"));
});

afterAll(async () => {
  await rm(cliSandbox, { recursive: true, force: true });
});
```

Make the harness environment include `LINEAGEGUARD_RUNS_DIR: defaultRunsRoot`. Track
`createCatalogCalls` and `analysisCalls` explicitly.

Remove the old nonexistent `RECOGNIZABLE_RUNS_ROOT` from CLI arguments. If a recognizable fake path
is still needed to prove error-detail redaction, keep it only inside the synthetic thrown error; it
must never be selected as the configured root.

Add tests for:

- absent env and absent flag;
- relative env;
- relative flag overriding a valid env;
- absolute missing path;
- an absolute regular file;
- an absolute symlink or Windows junction; and
- a valid absolute flag overriding the valid env root.

Every invalid case must assert:

```ts
expect(exitCode).toBe(4);
expect(test.createCatalogCalls).toBe(0);
expect(test.analysisCalls).toBe(0);
expect(test.stderr.join("")).toContain("Status: ARTIFACT_WRITE_FAILED");
expect(test.stderr.join("")).not.toContain(candidate);
```

The positive override test must assert the canonical override is supplied to
`runImpactAnalysis`. Existing success, configuration, interrupt, and error tests must use the real
suite root and remain path-free.

- [ ] **Step 3: Run the focused tests and prove RED**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/config/runtime-config.test.ts src/cli.test.ts
```

Expected: configuration tests expose the relative default, and CLI tests show catalog creation
occurs before root validation.

- [ ] **Step 4: Implement the absolute configuration contract**

In `src/config/runtime-config.ts`, import `isAbsolute` and `AppError`, then define:

```ts
export const RunsRootPathSchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value), "The runs root must be absolute.");

function invalidRunsRoot(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The configured runs root is invalid.");
}
```

Remove `.default("runs")`. Change the public loader to:

```ts
const environmentSchema = z.object({
  DATAHUB_GMS_URL: z.url(),
  DATAHUB_GMS_TOKEN: z.string().min(1),
  DATAHUB_MCP_UVX_PATH: z.string().min(1).default("uvx"),
  LINEAGEGUARD_RUNS_DIR: RunsRootPathSchema,
});

export function loadRuntimeConfig(
  environment: EnvironmentMap,
  runsRootOverride?: string,
): RuntimeConfig {
  const selectedRunsRoot = runsRootOverride ?? environment.LINEAGEGUARD_RUNS_DIR;
  const runsRoot = RunsRootPathSchema.safeParse(selectedRunsRoot);
  if (!runsRoot.success) throw invalidRunsRoot();

  const parsed = environmentSchema.parse({
    ...environment,
    LINEAGEGUARD_RUNS_DIR: runsRoot.data,
  });

  const config = {
    datahubGmsUrl: parsed.DATAHUB_GMS_URL,
    uvxPath: parsed.DATAHUB_MCP_UVX_PATH,
    runsRoot: parsed.LINEAGEGUARD_RUNS_DIR,
    maxHops: 2 as const,
  } as RuntimeConfig;

  Object.defineProperty(config, "datahubGmsToken", {
    enumerable: false,
    value: parsed.DATAHUB_GMS_TOKEN,
    writable: false,
  });

  return Object.freeze(config);
}
```

The environment schema must use `LINEAGEGUARD_RUNS_DIR: RunsRootPathSchema` with no default.

- [ ] **Step 5: Preflight before catalog creation**

In `src/cli.ts`:

1. import `assertTrustedRunsRoot`;
2. call `loadRuntimeConfig(dependencies.environment, arguments_.runsRoot)`;
3. if configuration throws `AppError`, render it through `writeAppError`;
4. call `assertTrustedRunsRoot(config.runsRoot)` before creating the abort controller or catalog;
5. render a fixed `ARTIFACT_WRITE_FAILED` on preflight failure; and
6. pass the returned canonical root to `runImpactAnalysis`.

The control flow must be:

```ts
let config: RuntimeConfig;
try {
  config = loadRuntimeConfig(dependencies.environment, arguments_.runsRoot);
} catch (error) {
  if (error instanceof AppError) return writeAppError(error, dependencies.stderr);
  dependencies.stderr.write(
    "Status: MCP_UNAVAILABLE\nConfiguration is invalid. Verify DATAHUB_GMS_URL and DATAHUB_GMS_TOKEN.\n",
  );
  return 3;
}

const outputSecrets = [config.datahubGmsToken];
let trustedRunsRoot: string;
try {
  trustedRunsRoot = await assertTrustedRunsRoot(config.runsRoot);
} catch (error) {
  const storageError =
    error instanceof AppError
      ? error
      : new AppError("ARTIFACT_WRITE_FAILED", "Unable to persist the run.");
  return writeAppError(storageError, dependencies.stderr, outputSecrets);
}
```

Use `trustedRunsRoot` for analysis persistence. Do not create the root and do not start the catalog
before this block succeeds.

- [ ] **Step 6: Align operator documentation**

In `README.md`, state next to the existing root preparation example:

```text
The CLI has no runs-directory default. Supply an absolute pre-created root through --runs-dir or
LINEAGEGUARD_RUNS_DIR; the command-line flag takes precedence.
```

Keep the existing ownership, ACL, symlink/junction, no-root-creation, and threat-model text.

- [ ] **Step 7: Run focused and full verification**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run src/config/runtime-config.test.ts src/cli.test.ts src/artifacts/run-envelope-files.test.ts
pnpm test
pnpm typecheck
pnpm format:check
pnpm lint
pnpm build:cli
pnpm build
git diff --check
```

Expected: configuration and real-root preflight tests pass; the full offline suite and both builds
pass; no external call occurs after a failed preflight. Restore only a build-generated
`next-env.d.ts` change through an explicit patch if Next.js rewrites it.

Run a targeted disclosure scan:

```powershell
rg -n "(?:sk-(?:proj-)?|github_pat_|gh[pousr]_)[A-Za-z0-9_-]{20,}|secret-bearing-custom-abort-reason|recognizable-private-runs-root" src/config/runtime-config.ts src/config/runtime-config.test.ts src/cli.ts src/cli.test.ts README.md
```

Expected: no real credential, custom abort reason, or actual workspace root is introduced.
Synthetic negative-test sentinels must be documented in the task report and absent from production
and documentation.

- [ ] **Step 8: Commit CLI root preflight**

```powershell
git add src/config/runtime-config.ts src/config/runtime-config.test.ts src/cli.ts src/cli.test.ts README.md
git commit -m "fix: preflight the trusted runs root"
```

---

### Task 3: Correct the Active Downstream Implementation Plan

**Files:**

- Modify: `docs/specs/002-nextjs-openai-agent-demo/plan.md`

**Interfaces:**

- Consumes: the completed flat-storage APIs, `RunsRootPathSchema`, and the approved remediation
  design.
- Produces: one coherent active plan for Tasks 7–14A with no relative-root, nested-manifest,
  private-file, or obsolete-import instructions.

- [ ] **Step 1: Update the plan header and global constraints**

Change `Last amended` to 2026-07-24 and include the flat-storage and cumulative-gate remediation.

Replace the artifact-path and nested-layout global constraints with:

```markdown
- Preserve the existing deterministic intent, DataHub, evidence, impact, redaction, and virtual-artifact behavior.
- Persist each terminal run as one immutable `run-<run-id>.json` envelope directly beneath an explicit absolute, pre-created trusted `LINEAGEGUARD_RUNS_DIR`; expose only allowlisted virtual artifacts after strict envelope and hash validation.
```

- [ ] **Step 2: Collapse the superseded Task 6 body**

Retain the Task 6 heading, then replace its obsolete file lists, interfaces, code snippets, tests,
and commit steps with:

```markdown
### Task 6: Generalize Safe Run Storage and Artifact Downloads

> **Completed through approved authority amendments (2026-07-24).** The original nested
> run-directory, package-directory, manifest-file, and directory-rename design is superseded by
> `docs/superpowers/specs/2026-07-24-flat-run-envelope-storage-design.md`,
> `docs/superpowers/plans/2026-07-24-flat-run-envelope-storage.md`, and
> `docs/superpowers/specs/2026-07-24-flat-storage-cumulative-gate-remediation-design.md`.

**Authoritative outputs:**

- strict completed, failed, impact-report, and retry-reservation envelopes;
- one create-only `run-<run-id>.json` final entry per terminal run;
- bounded, hash-verified, one-read reload and virtual-download services;
- immutable branded retry reservations;
- the virtual-only legacy `impact-report.md` facade; and
- an explicit absolute pre-created trusted runs root.

Do not implement or restore nested run directories, package manifests, generic path-based artifact
APIs, private-file downloads, relative runs-root defaults, or application-owned root creation.

---
```

The next line after this retained block must be the Task 7 heading.

- [ ] **Step 3: Rewrite Task 9 persistence assertions**

Replace active file-path assertions with envelope services:

- failed/provider cases call `loadRunSnapshot` and assert terminal status plus the expected impact
  and context hash;
- failed-envelope diagnostic tests call internal `readRunEnvelope` and assert strict
  `kind: "failed"`, sanitized `draft` and `findings`, zero artifacts, and no `package`;
- regeneration tests call `loadRegenerationContext` and `reserveGenerationRetry`, never read
  `change-context.json`;
- artifact-commit failure asserts one authoritative failed envelope and no public virtual download;
  and
- no test checks `package/manifest.json`, run-root diagnostic filenames, or nested paths.

Use this replacement shape:

```ts
const envelope = await readRunEnvelope({
  runsRoot: dependencies.runsRoot,
  runId: result.runId,
});
expect(envelope).toMatchObject({
  kind: "failed",
  snapshot: { status: "VALIDATION_FAILED" },
  findings: expect.any(Array),
});
expect(envelope).not.toHaveProperty("package");
```

- [ ] **Step 4: Rewrite Task 10 web configuration and routes**

The Task 10 `loadWebConfig` plan must import `RunsRootPathSchema`, require
`LINEAGEGUARD_RUNS_DIR` with no default, and keep replay free of DataHub/OpenAI secrets:

```ts
const baseSchema = z.object({
  LINEAGEGUARD_DEMO_MODE: z.enum(["LIVE", "REPLAY"]).default("REPLAY"),
  LINEAGEGUARD_RUNS_DIR: RunsRootPathSchema,
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-sol"),
});
```

Route construction must preflight `assertTrustedRunsRoot(config.runsRoot)` before provider or
DataHub work. Replace manifest tests with a tampered-envelope hash/invariant test. The routes use:

```ts
loadRunSnapshot;
loadRegenerationContext;
reserveGenerationRetry;
readCompletedPackageFile;
```

from `src/runs/run-store.ts`. The download route accepts only the four
`virtualArtifactFilenames`; integrity failure returns 404 without fallback.

Route tests must cover missing, relative, nonexistent, and symlink/junction web roots and assert
zero provider, catalog, DataHub, and workflow calls after the storage preflight fails.

- [ ] **Step 5: Rewrite Playwright and CI root setup**

The Task 11 Playwright plan must have the harness create an absolute temporary root before starting
Next.js. Add `tests/e2e/global-teardown.ts` to its file list and replace the configuration snippet
with:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const runsRoot = mkdtempSync(join(tmpdir(), "lineageguard-playwright-runs-"));
process.env.LINEAGEGUARD_E2E_RUNS_DIR = runsRoot;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3107",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3107",
    env: {
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3107",
  },
});
```

The planned teardown must contain:

```ts
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
```

The Task 13 CI plan must prepare and pass an absolute job-temporary root:

```yaml
- name: Prepare trusted runs root
  shell: bash
  run: mkdir -p "$RUNNER_TEMP/lineageguard-runs"

- name: Run offline validation gate
  env:
    LINEAGEGUARD_DEMO_MODE: REPLAY
    LINEAGEGUARD_RUNS_DIR: ${{ runner.temp }}/lineageguard-runs
  run: pnpm verify:offline
```

- [ ] **Step 6: Correct live, example, and submission instructions**

In Tasks 14 and 14A:

- import `readCompletedPackageFile` and `loadRunSnapshot` from `src/runs/run-store.ts`;
- live smoke tests inspect the validated snapshot through `loadRunSnapshot`, not a virtual
  `run-metadata.json`;
- generated examples copy only the four `virtualArtifactFilenames`;
- remove `examples/002-nextjs-openai-agent-demo/run-metadata.json` from file lists and prose; and
- keep private context, draft, findings, hashes, and snapshot metadata out of public downloads.

Use:

```ts
const snapshot = await loadRunSnapshot({ runsRoot, runId: result.runId });
expect(JSON.stringify(snapshot)).not.toContain(apiKey);
expect(JSON.stringify(snapshot)).not.toContain(config.datahubGmsToken);
```

- [ ] **Step 7: Replace the architecture run-layout section**

Replace `## Run Directory Layout` with:

```markdown
## Flat Run Envelope Storage

Each terminal run is published once as an immutable `run-<run-id>.json` envelope directly beneath
an explicit absolute, pre-created trusted `LINEAGEGUARD_RUNS_DIR`. The envelope is bounded,
strictly parsed, hash-verified, and cross-field validated before use. Completed runs expose only
the four allowlisted virtual migration artifacts; context, draft, findings, hashes, temporary
names, and native paths remain private.
```

- [ ] **Step 8: Prove the active plan has no superseded instructions**

Run:

```powershell
rg -n -e 'package/manifest' -e 'manifest\.json' -e 'runsRoot: "runs"' -e 'LINEAGEGUARD_RUNS_DIR: "\.tmp' -e 'LINEAGEGUARD_RUNS_DIR: \.tmp' -e 'readRunArtifact' -e 'commitPackageAtomically' -e 'readRunMetadataFile' -e 'run-metadata\.json' -e 'change-context\.json' -e 'validation-findings\.json' -e 'migration-package-draft\.json' -e '<run-id>/package' docs/specs/002-nextjs-openai-agent-demo/plan.md
```

Expected: exit `1`, no matches.

Run:

```powershell
rg -n 'readCompletedPackageFile.*write-run-artifacts|from ".*artifacts/write-run-artifacts\.js"' docs/specs/002-nextjs-openai-agent-demo/plan.md
```

Expected: exit `1`, no active obsolete imports.

Then run:

```powershell
pnpm format:check
git diff --check
git diff -- docs/specs/002-nextjs-openai-agent-demo/plan.md
git status --short
```

Expected: formatting and diff checks pass; only the approved plan file is changed. This is a
documentation-only task, so do not add artificial behavior tests.

- [ ] **Step 9: Commit downstream plan coherence**

```powershell
git add docs/specs/002-nextjs-openai-agent-demo/plan.md
git commit -m "docs: align downstream plan with flat storage"
```

---

## Final Cumulative Gate

After all three task-level reviews are approved, generate a cumulative review package from
`f589de99be61f69efbc9d0ccc86cced9a57a4034` through the remediation HEAD. A fresh senior reviewer
must read both flat-storage designs, this plan, the active Next.js plan, and the cumulative diff.

Controller verification:

```powershell
& .\node_modules\.bin\vitest.cmd run src/workflow/change-context.test.ts src/runs/run-envelope.test.ts src/artifacts/run-envelope-files.test.ts src/artifacts/write-run-artifacts.test.ts src/runs/run-store.test.ts src/security/sanitize-validation-findings.test.ts src/config/runtime-config.test.ts src/cli.test.ts
pnpm test
pnpm typecheck
pnpm format:check
pnpm lint
pnpm build:cli
pnpm build
git diff --check
git status --short
```

Expected: all focused and offline tests pass; typecheck, formatting, lint, both builds, and diff
checks exit zero; worktree is clean after restoring any build-generated `next-env.d.ts` change.
Lint may retain only the accepted `prettier.config.mjs` warning, and Next.js may retain only the
known multiple-lockfile workspace-root warning.

The main Next.js and OpenAI plan may resume at Task 7 only after the fresh cumulative reviewer
reports no Critical or Important findings and approves plan coherence.
