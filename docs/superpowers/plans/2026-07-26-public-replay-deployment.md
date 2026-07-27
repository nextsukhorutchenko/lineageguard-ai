# Public Replay Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the real LineageGuard AI Next.js application as a free, credential-free,
resource-bounded Render `PUBLIC_REPLAY` service that gives judges a verified HTTPS Project URL.

**Architecture:** Preserve `REPLAY` as the evidence mode and add a restrictive
`PUBLIC_REPLAY` deployment profile around it. A small operator bootstrap creates the one ephemeral
trusted runs root, a process-local admission boundary limits public work, and the existing
deterministic fixture workflow remains authoritative. Render configuration, local production
acceptance, and opt-in remote acceptance stay explicit and testable without making mandatory CI
depend on Render.

**Tech Stack:** TypeScript 6.0.3, Node.js 22.23.1, pnpm 10.10.0, Next.js 16.2.11, React 19.2.8,
Zod 4.4.3, Vitest 4.1.10, Playwright 1.61.1, Render Native Node Web Service.

**Authority:** Approved design
`docs/superpowers/specs/2026-07-26-public-replay-deployment-design.md` and approved specification
`docs/specs/002-nextjs-openai-agent-demo/spec.md`. The deployment design supersedes only the
existing hosted-deployment exclusion.

## Global Constraints

- Keep local `LIVE` and ordinary `REPLAY` behavior unchanged.
- `PUBLIC_REPLAY` must require `LINEAGEGUARD_DEMO_MODE=REPLAY`.
- Reject non-empty `OPENAI_API_KEY` and `DATAHUB_GMS_TOKEN` in `PUBLIC_REPLAY`.
- Accept only the exact certified golden rename request in the public profile.
- Use one free Render Native Node Web Service, one instance, no disk, no database, and no secrets.
- Keep hosted runs ephemeral, immutable, create-only, and bounded to 64 publication reservations
  per process lifetime.
- Permit at most two concurrent root or regeneration workflows.
- Keep DataHub, OpenAI, SQL execution, mutation, GitHub automation, and arbitrary public API use
  unavailable.
- Keep mandatory CI offline, deterministic, credential-free, and independent of Render.
- Add no dependency or lockfile change. A dependency need requires a separately approved amendment.
- Keep code, tests, UI copy, documentation, commits, Render configuration, and public artifacts in
  English.
- Preserve strict TypeScript, ESM, current relative-import conventions, exact dependency versions,
  and immutable GitHub Action SHAs.
- Treat the browser, requests, proxy headers, filesystem contents, deployment environment, and
  remote responses as untrusted.
- Never publish credentials, environment values, native paths, raw traces, stack traces, provider
  envelopes, hidden instructions, or unrestricted diagnostics.
- Use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY` as specified.
- Do not mark manual submission checklist boxes until the project owner verifies the matching
  evidence.
- Do not publish a video, submit Devpost, modify GitHub About, post to Slack, or open an upstream
  DataHub pull request in this plan.

## File and Responsibility Map

### New runtime modules

- `src/hosting/public-replay-contracts.ts` — public profile, exact golden request, fixed public error
  schemas, constants, and safe response copy shared by server and browser.
- `src/hosting/public-replay-admission.ts` — reentrancy-safe process-local concurrency and
  publication-reservation accounting.
- `src/hosting/public-replay-bootstrap.ts` — injected, testable root preparation, child environment
  construction, and Next server lifecycle.
- `src/hosting/start-public-replay.ts` — thin executable entrypoint for Render.
- `src/http/response-headers.ts` — immutable no-store and browser-security header helpers.
- `src/hosting/public-replay-health.ts` — fixed health response logic.

### New deployment and validation files

- `app/api/health/route.ts` — Node.js health route.
- `render.yaml` — one canonical free Native Node Web Service.
- `scripts/validate-render-blueprint.ts` — dependency-free exact Blueprint validator.
- `scripts/validate-render-blueprint.test.ts` — positive and negative Blueprint gate tests.

### New production and remote acceptance files

- `playwright.public-replay.config.ts` — local built-server public-profile acceptance.
- `playwright.public-remote.config.ts` — opt-in HTTPS Render acceptance with no local server.
- `tests/e2e/public-replay-global-setup.ts` — local production-server lifecycle hook.
- `tests/e2e/public-replay-server-lifecycle.ts` — owned root/server preparation and cleanup.
- `tests/e2e/public-replay-deployment.spec.ts` — local `PUBLIC_REPLAY` browser acceptance.
- `tests/e2e/public-replay-remote.spec.ts` — opt-in real Render browser acceptance.
- `docs/public-deployment-verification.md` — sanitized URL, reviewed runtime commit, date, and public
  acceptance result written only after a real deployment exists.

### Existing files modified by responsibility

- `src/config/web-config.ts` and test — deployment-profile configuration contract.
- `app/page.tsx`, `src/ui/demo-client.tsx`, and `src/ui/change-request-form.tsx` — truthful public
  label, fixed public evidence, and bounded public error recovery.
- `src/app/web-dependencies.ts` and `tests/api/run-routes.test.ts` — exact-request gate, admission
  integration, capacity enforcement, and shared headers.
- `next.config.ts` and `tests/smoke/toolchain.test.ts` — global browser-security headers and exact
  deployment scripts/gates.
- `package.json` — exact start, validation, local acceptance, remote acceptance, and offline-gate
  scripts without dependency changes.
- `playwright.config.ts` — exclude the two dedicated public-deployment specs from the ordinary
  shared REPLAY harness.
- `README.md`, `docs/resources-and-attribution.md`, `docs/submission-checklist.md`, and
  `scripts/validate-submission-assets.ts` with its test — truthful hosted replay documentation and
  submission evidence.

---

### Task 1: Add the Public Replay Configuration and UI Contract

**Files:**

- Create: `src/hosting/public-replay-contracts.ts`
- Create: `src/hosting/public-replay-contracts.test.ts`
- Modify: `src/config/web-config.ts`
- Modify: `src/config/web-config.test.ts`
- Modify: `app/page.tsx`
- Modify: `src/ui/demo-client.tsx`
- Modify: `src/ui/change-request-form.tsx`
- Create: `src/ui/public-replay-shell.test.tsx`

**Interfaces:**

- Produces:

```ts
export const DeploymentProfileSchema = z.enum(["LOCAL", "PUBLIC_REPLAY"]);
export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export const PUBLIC_REPLAY_REQUEST =
  "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details";

export const PublicReplayErrorCodeSchema = z.enum([
  "DEMO_BUSY",
  "DEMO_CAPACITY_REACHED",
  "RUN_EXPIRED",
]);

export const PublicReplayErrorSchema = z
  .object({
    error: z
      .object({
        code: PublicReplayErrorCodeSchema,
        message: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict();
```

- Changes `WebConfig` so every branch contains:

```ts
readonly deploymentProfile: "LOCAL" | "PUBLIC_REPLAY";
```

- Changes `DemoClient` to:

```ts
export function DemoClient(props: {
  readonly initialMode: DemoMode;
  readonly deploymentProfile: DeploymentProfile;
}): React.JSX.Element;
```

- Changes `ChangeRequestForm` to accept:

```ts
readonly locked: boolean;
```

- [ ] **Step 1: Add failing public-profile contract tests**

Add these cases to `src/config/web-config.test.ts`:

```ts
it("defaults the deployment profile to LOCAL", () => {
  expect(
    loadWebConfig({
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    }),
  ).toEqual({
    mode: "REPLAY",
    runsRoot,
    deploymentProfile: "LOCAL",
  });
});

it("accepts a credential-free PUBLIC_REPLAY profile", () => {
  expect(
    loadWebConfig({
      LINEAGEGUARD_DEMO_MODE: "REPLAY",
      LINEAGEGUARD_DEPLOYMENT_PROFILE: "PUBLIC_REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
    }),
  ).toEqual({
    mode: "REPLAY",
    runsRoot,
    deploymentProfile: "PUBLIC_REPLAY",
  });
});

it.each([
  { LINEAGEGUARD_DEMO_MODE: "LIVE" },
  { LINEAGEGUARD_DEMO_MODE: "REPLAY", OPENAI_API_KEY: "forbidden" },
  { LINEAGEGUARD_DEMO_MODE: "REPLAY", DATAHUB_GMS_TOKEN: "forbidden" },
])("rejects unsafe PUBLIC_REPLAY configuration %#", (unsafe) => {
  expect(() =>
    loadWebConfig({
      LINEAGEGUARD_DEPLOYMENT_PROFILE: "PUBLIC_REPLAY",
      LINEAGEGUARD_RUNS_DIR: runsRoot,
      ...unsafe,
    }),
  ).toThrow("Demo service configuration is invalid.");
});
```

Create `src/hosting/public-replay-contracts.test.ts` and assert the exact request, three allowlisted
error codes, strict object parsing, and 160-character message bound.

- [ ] **Step 2: Run the focused configuration tests and capture RED**

Run:

```powershell
pnpm vitest run src/config/web-config.test.ts src/hosting/public-replay-contracts.test.ts
```

Expected: FAIL because the deployment profile and contracts module do not exist.

- [ ] **Step 3: Implement the minimal configuration and contracts**

In `src/config/web-config.ts`, extend the base schema:

```ts
LINEAGEGUARD_DEPLOYMENT_PROFILE: DeploymentProfileSchema.default("LOCAL"),
```

Before selecting the `REPLAY` or `LIVE` branch, enforce:

```ts
if (base.data.LINEAGEGUARD_DEPLOYMENT_PROFILE === "PUBLIC_REPLAY") {
  const hasForbiddenCredential =
    (environment.OPENAI_API_KEY?.length ?? 0) > 0 ||
    (environment.DATAHUB_GMS_TOKEN?.length ?? 0) > 0;
  if (base.data.LINEAGEGUARD_DEMO_MODE !== "REPLAY" || hasForbiddenCredential) {
    throw new Error("Demo service configuration is invalid.");
  }
}
```

Return `deploymentProfile` in both discriminated-union branches. Do not accept aliases, lowercase
values, or provider credentials.

- [ ] **Step 4: Run the focused configuration tests to GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Add failing public-shell rendering tests**

Create `src/ui/public-replay-shell.test.tsx` with server-rendered assertions:

```tsx
const publicMarkup = renderToStaticMarkup(
  <DemoClient initialMode="REPLAY" deploymentProfile="PUBLIC_REPLAY" />,
);
expect(publicMarkup).toContain("Public fixture replay");
expect(publicMarkup).toContain('readonly=""');

const localMarkup = renderToStaticMarkup(
  <DemoClient initialMode="REPLAY" deploymentProfile="LOCAL" />,
);
expect(localMarkup).toContain("Fixture replay");
expect(localMarkup).not.toContain("Public fixture replay");
```

Update existing direct `DemoClient` callers at compile time only after the test is present.

- [ ] **Step 6: Run the public-shell test and capture RED**

Run:

```powershell
pnpm vitest run src/ui/public-replay-shell.test.tsx src/config/web-config.test.ts
```

Expected: FAIL because `DemoClient` has no deployment-profile prop and the fields are not locked.

- [ ] **Step 7: Implement the truthful public shell**

In `app/page.tsx`, load the config once and pass both `mode` and `deploymentProfile`.

In `DemoClient`, use `PUBLIC_REPLAY_REQUEST` for the public request body, render
`Public fixture replay`, and pass `locked={deploymentProfile === "PUBLIC_REPLAY"}`.

In `ChangeRequestForm`, use:

```tsx
readOnly={props.locked}
aria-readonly={props.locked}
```

Keep the controls editable in `LOCAL`. Do not disable Analyze, Cancel, Regenerate, copy, preview, or
download in the public profile.

- [ ] **Step 8: Run focused UI, configuration, and type checks**

Run:

```powershell
pnpm vitest run src/config/web-config.test.ts src/hosting/public-replay-contracts.test.ts src/ui/public-replay-shell.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add src/hosting/public-replay-contracts.ts src/hosting/public-replay-contracts.test.ts src/config/web-config.ts src/config/web-config.test.ts app/page.tsx src/ui/demo-client.tsx src/ui/change-request-form.tsx src/ui/public-replay-shell.test.tsx
git commit -m "feat: add the public replay profile"
```

---

### Task 2: Enforce Exact Requests, Concurrency, and Capacity

**Files:**

- Create: `src/hosting/public-replay-admission.ts`
- Create: `src/hosting/public-replay-admission.test.ts`
- Create: `src/hosting/public-replay-http.ts`
- Create: `src/hosting/public-replay-http.test.ts`
- Modify: `src/app/web-dependencies.ts`
- Modify: `tests/api/run-routes.test.ts`
- Modify: `src/ui/demo-client.tsx`
- Create: `src/ui/public-replay-error.test.ts`

**Interfaces:**

- Consumes: `DeploymentProfile`, `PUBLIC_REPLAY_REQUEST`, and `PublicReplayErrorSchema` from Task 1.
- Produces:

```ts
export const PUBLIC_REPLAY_CONCURRENCY_LIMIT = 2;
export const PUBLIC_REPLAY_ENVELOPE_LIMIT = 64;

export interface PublicReplayLease {
  release(): void;
}

export type PublicReplayAdmissionDecision =
  | { readonly kind: "accepted"; readonly lease: PublicReplayLease }
  | {
      readonly kind: "rejected";
      readonly code: "DEMO_BUSY" | "DEMO_CAPACITY_REACHED";
    };

export interface PublicReplayAdmission {
  acquire(runsRoot: string): Promise<PublicReplayAdmissionDecision>;
}

export function createPublicReplayAdmission(options?: {
  readonly concurrencyLimit?: number;
  readonly envelopeLimit?: number;
  readonly countPublished?: (runsRoot: string) => Promise<number>;
}): PublicReplayAdmission;
```

- `createPostRunsHandler` and `createRegenerateRunHandler` gain:

```ts
readonly publicAdmission?: PublicReplayAdmission;
```

- [ ] **Step 1: Write failing admission-controller tests**

Cover:

```ts
it("admits two workflows and rejects the third as busy", async () => {
  const admission = createPublicReplayAdmission({ countPublished: async () => 0 });
  const first = await admission.acquire(runsRoot);
  const second = await admission.acquire(runsRoot);
  expect(await admission.acquire(runsRoot)).toEqual({
    kind: "rejected",
    code: "DEMO_BUSY",
  });
  expect(first.kind).toBe("accepted");
  expect(second.kind).toBe("accepted");
});

it("releases a lease exactly once under reentrancy", async () => {
  const admission = createPublicReplayAdmission({
    concurrencyLimit: 1,
    countPublished: async () => 0,
  });
  const accepted = await admission.acquire(runsRoot);
  if (accepted.kind !== "accepted") throw new Error("Expected admission.");
  accepted.lease.release();
  accepted.lease.release();
  expect((await admission.acquire(runsRoot)).kind).toBe("accepted");
});

it("rejects the sixty-fifth publication reservation", async () => {
  const admission = createPublicReplayAdmission({
    envelopeLimit: 64,
    countPublished: async () => 63,
  });
  const last = await admission.acquire(runsRoot);
  expect(last.kind).toBe("accepted");
  if (last.kind === "accepted") last.lease.release();
  expect(await admission.acquire(runsRoot)).toEqual({
    kind: "rejected",
    code: "DEMO_CAPACITY_REACHED",
  });
});
```

Also prove that concurrent first calls share one cached count promise, count failure rejects closed
as `DEMO_CAPACITY_REACHED`, different roots are rejected after initialization, and an accepted
capacity reservation is never refunded by concurrency release.

- [ ] **Step 2: Run the admission tests and capture RED**

Run:

```powershell
pnpm vitest run src/hosting/public-replay-admission.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement reentrancy-safe admission**

Use one cached initialization promise assigned before invoking `countPublished`, synchronous
post-await reservation increments, and an idempotent lease closure. Count only validated
`run-<SafeRunId>.json` final envelopes on first acquisition; reject unexpected filesystem state
rather than guessing.

Every accepted request consumes one publication reservation permanently, even when a later failure
does not publish. This conservative rule guarantees that at most 64 envelopes can be published
under persistence uncertainty.

- [ ] **Step 4: Run admission tests to GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing HTTP and handler tests**

Create fixed response helpers in the test contract:

```ts
expect(await publicReplayErrorResponse("DEMO_BUSY").json()).toEqual({
  error: {
    code: "DEMO_BUSY",
    message: "Public replay is busy. Try again shortly.",
  },
});
```

Extend `tests/api/run-routes.test.ts` to prove:

- a non-golden `PUBLIC_REPLAY` request returns HTTP 400 before workflow construction;
- the third concurrent root request returns HTTP 429 and `DEMO_BUSY`;
- regeneration shares the same two-slot controller;
- the sixty-fifth reservation returns HTTP 503 and `DEMO_CAPACITY_REACHED`;
- cancellation, success, and failure release only the concurrency slot;
- local `REPLAY` bypasses the public admission boundary; and
- no public rejection creates a run ID or persistence entry.

- [ ] **Step 6: Run focused route tests and capture RED**

Run:

```powershell
pnpm vitest run src/hosting/public-replay-http.test.ts tests/api/run-routes.test.ts
```

Expected: FAIL because handlers do not enforce the public request or admission contract.

- [ ] **Step 7: Integrate admission into root and regeneration handlers**

The handler order must be:

```text
bounded parse
-> load config
-> exact PUBLIC_REPLAY request gate
-> trusted runs-root check
-> PUBLIC_REPLAY admission
-> mode check
-> run ID creation
-> stream construction
-> workflow
-> release concurrency lease in stream finally
```

For regeneration, validate the empty body, config, root, and admission before creating the child
run ID. Local modes receive an internal no-op accepted lease.

Return fixed JSON errors before an NDJSON stream exists. Keep capacity reservations consumed and
make `release()` safe from both stream cancellation and `finally`.

- [ ] **Step 8: Add bounded browser parsing for public rejection copy**

Add a test-owned response with a body larger than 1,024 bytes and prove the browser rejects it
without committing its text. In `DemoClient`, read at most 1,024 UTF-8 bytes for non-OK JSON,
strictly parse `PublicReplayErrorSchema`, and show only:

```text
Public replay is busy. Try again shortly.
Public replay capacity was reached. Try again after the service restarts.
```

All malformed, oversized, wrong-content-type, or unknown errors retain the existing fixed
`The workflow stream ended unexpectedly.` fallback.

- [ ] **Step 9: Run Task 2 tests and type checking**

Run:

```powershell
pnpm vitest run src/hosting/public-replay-admission.test.ts src/hosting/public-replay-http.test.ts src/ui/public-replay-error.test.ts tests/api/run-routes.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```powershell
git add src/hosting/public-replay-admission.ts src/hosting/public-replay-admission.test.ts src/hosting/public-replay-http.ts src/hosting/public-replay-http.test.ts src/app/web-dependencies.ts tests/api/run-routes.test.ts src/ui/demo-client.tsx src/ui/public-replay-error.test.ts
git commit -m "feat: bound public replay admission"
```

---

### Task 3: Add Health, Cache, Security, and Expiration Contracts

**Files:**

- Create: `src/http/response-headers.ts`
- Create: `src/http/response-headers.test.ts`
- Create: `src/hosting/public-replay-health.ts`
- Create: `src/hosting/public-replay-health.test.ts`
- Create: `app/api/health/route.ts`
- Modify: `src/app/web-dependencies.ts`
- Modify: `src/ui/demo-client.tsx`
- Modify: `tests/api/run-routes.test.ts`
- Modify: `next.config.ts`
- Modify: `tests/smoke/toolchain.test.ts`

**Interfaces:**

- Produces:

```ts
export const NO_STORE_HEADERS: Readonly<Record<string, string>>;
export const PUBLIC_BROWSER_HEADERS: readonly {
  readonly key: string;
  readonly value: string;
}[];

export function noStoreHeaders(additions?: Readonly<Record<string, string>>): Headers;

export function createPublicReplayHealthHandler(overrides?: {
  readonly loadConfig?: typeof loadWebConfig;
  readonly assertRunsRoot?: typeof assertTrustedRunsRoot;
}): () => Promise<Response>;
```

- [ ] **Step 1: Write failing header and health tests**

Assert exact headers:

```ts
expect(Object.fromEntries(noStoreHeaders())).toMatchObject({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});
```

Assert healthy output is exactly:

```json
{ "status": "ok", "mode": "PUBLIC_REPLAY" }
```

Assert local profile, invalid configuration, or unsafe root returns HTTP 503 with:

```json
{ "status": "unavailable" }
```

Verify no exception text, path, environment key, or injected sentinel reaches either response.

- [ ] **Step 2: Run the focused tests and capture RED**

Run:

```powershell
pnpm vitest run src/http/response-headers.test.ts src/hosting/public-replay-health.test.ts
```

Expected: FAIL because the modules and route do not exist.

- [ ] **Step 3: Implement shared headers and health**

Use `Headers` construction so additions cannot silently replace the four required values. The
health handler must load the config, require `PUBLIC_REPLAY`, and call the existing trusted-root
assertion. Catch all errors and return the fixed 503 body.

Create `app/api/health/route.ts`:

```ts
import { createPublicReplayHealthHandler } from "../../../src/hosting/public-replay-health.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPublicReplayHealthHandler();
```

- [ ] **Step 4: Apply headers to every required route and the page**

Replace route-local header objects with `noStoreHeaders(...)` for root runs, regeneration, reload,
artifacts, and health.

In `next.config.ts`, add:

```ts
async headers() {
  return [{ source: "/:path*", headers: [...PUBLIC_BROWSER_HEADERS] }];
}
```

Keep `poweredByHeader: false`, `extensionAlias`, and non-standalone output unchanged.

- [ ] **Step 5: Add expiration recovery tests**

In `tests/api/run-routes.test.ts`, assert a missing run and artifact remain 404, no-store,
nosniff, and sanitized.

In `src/ui/public-replay-error.test.ts`, prove a 404 artifact response in `PUBLIC_REPLAY` produces
only:

```text
Run expired; analyze again.
```

Ordinary local replay retains `Artifact preview is unavailable.`.

- [ ] **Step 6: Run focused tests to GREEN**

Run:

```powershell
pnpm vitest run src/http/response-headers.test.ts src/hosting/public-replay-health.test.ts src/ui/public-replay-error.test.ts tests/api/run-routes.test.ts tests/smoke/toolchain.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/http/response-headers.ts src/http/response-headers.test.ts src/hosting/public-replay-health.ts src/hosting/public-replay-health.test.ts app/api/health/route.ts src/app/web-dependencies.ts src/ui/demo-client.tsx tests/api/run-routes.test.ts next.config.ts tests/smoke/toolchain.test.ts
git commit -m "feat: harden public replay responses"
```

---

### Task 4: Build the Deployment Bootstrap

**Files:**

- Create: `src/hosting/public-replay-bootstrap.ts`
- Create: `src/hosting/public-replay-bootstrap.test.ts`
- Create: `src/hosting/start-public-replay.ts`
- Modify: `package.json`
- Modify: `tests/smoke/toolchain.test.ts`

**Interfaces:**

- Produces:

```ts
export interface PublicReplayPreparedEnvironment {
  readonly port: number;
  readonly runsRoot: string;
  readonly childEnvironment: NodeJS.ProcessEnv;
}

export async function preparePublicReplayEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
  dependencies?: Partial<PublicReplayBootstrapDependencies>,
): Promise<PublicReplayPreparedEnvironment>;

export async function runPublicReplayServer(
  environment: Readonly<NodeJS.ProcessEnv>,
  dependencies?: Partial<PublicReplayServerDependencies>,
): Promise<number>;
```

- Package script:

```json
"start:public-replay": "node dist/hosting/start-public-replay.js"
```

- [ ] **Step 1: Write failing environment and root tests**

Cover:

- missing root is created with mode `0o700` and no recursive parent creation;
- an existing real writable root is accepted and normalized;
- relative root, file, symlink, canonical mismatch, unwritable directory, and invalid port reject;
- `PUBLIC_REPLAY + REPLAY` is required;
- non-empty forbidden credentials reject without printing their values;
- child environment contains only the explicit operating-system/Node allowlist plus
  `NODE_ENV`, `PORT`, `LINEAGEGUARD_DEMO_MODE`, `LINEAGEGUARD_DEPLOYMENT_PROFILE`,
  `LINEAGEGUARD_RUNS_DIR`, and `NEXT_TELEMETRY_DISABLED`;
- unrelated sentinel environment keys are absent.

Use injected `mkdir`, `lstat`, `realpath`, `chmod`, `access`, and platform operations. Tests must use
owned temporary directories and remove only their own roots.

- [ ] **Step 2: Run the bootstrap tests and capture RED**

Run:

```powershell
pnpm vitest run src/hosting/public-replay-bootstrap.test.ts
```

Expected: FAIL because the bootstrap does not exist.

- [ ] **Step 3: Implement environment preparation**

Parse `PORT` as a base-10 integer from 1 through 65,535. Call `loadWebConfig` for the public profile.
Use non-recursive `mkdir(config.runsRoot, { mode: 0o700 })`; accept only `EEXIST`, then apply private
permissions and the existing `assertTrustedRunsRoot` boundary. Never include the root or raw
environment values in thrown public-facing messages.

Build the child environment from a constant allowlist rather than spreading `process.env`.

- [ ] **Step 4: Run environment preparation tests to GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing child lifecycle tests**

Using an injected fake `ChildProcess`, prove:

- the bootstrap resolves `next/dist/bin/next` and spawns
  `node <next-cli> start -H 0.0.0.0 -p <port>` with `shell: false`;
- child spawn errors produce one fixed startup error;
- `SIGTERM` and `SIGINT` forward once;
- child close determines the bootstrap exit code;
- repeated shutdown signals are reentrancy-safe; and
- no detached or unmanaged child remains after a startup failure.

- [ ] **Step 6: Implement the lifecycle and thin entrypoint**

Keep all testable behavior in `public-replay-bootstrap.ts`. `start-public-replay.ts` may contain only:

```ts
import { runPublicReplayServer } from "./public-replay-bootstrap.js";

process.exitCode = await runPublicReplayServer(process.env).catch(() => {
  process.stderr.write("Public replay failed to start.\n");
  return 1;
});
```

Do not print paths, configuration values, child stderr, or stack traces from the wrapper.

- [ ] **Step 7: Run bootstrap, toolchain, build, and executable smoke**

Run:

```powershell
pnpm vitest run src/hosting/public-replay-bootstrap.test.ts tests/smoke/toolchain.test.ts
pnpm typecheck
pnpm build:cli
Test-Path -LiteralPath "dist/hosting/start-public-replay.js"
```

Expected: tests and type checking PASS, build exits 0, and `Test-Path` returns `True`.

- [ ] **Step 8: Commit Task 4**

```powershell
git add src/hosting/public-replay-bootstrap.ts src/hosting/public-replay-bootstrap.test.ts src/hosting/start-public-replay.ts package.json tests/smoke/toolchain.test.ts
git commit -m "feat: start the hosted replay safely"
```

---

### Task 5: Add and Enforce the Canonical Render Blueprint

**Files:**

- Create: `render.yaml`
- Create: `scripts/validate-render-blueprint.ts`
- Create: `scripts/validate-render-blueprint.test.ts`
- Modify: `package.json`
- Modify: `tests/smoke/toolchain.test.ts`

**Interfaces:**

- Produces:

```ts
export const EXPECTED_RENDER_BLUEPRINT: string;
export function validateRenderBlueprintText(value: string): readonly string[];
export async function validateRenderBlueprint(root?: string): Promise<void>;
```

- Package script:

```json
"render:check": "tsx scripts/validate-render-blueprint.ts"
```

- [ ] **Step 1: Write the failing Blueprint validator tests**

The positive case must accept exactly one canonical Blueprint. Negative cases independently change:

- `plan: free`;
- `runtime: node`;
- `numInstances: 1`;
- `healthCheckPath: /api/health`;
- `autoDeployTrigger: off`;
- the frozen lockfile build;
- `startCommand: pnpm start:public-replay`;
- `NODE_VERSION=22.23.1`;
- `REPLAY`;
- `PUBLIC_REPLAY`;
- `/tmp/lineageguard-runs`;
- no disk/database/worker/cron/private service;
- no `sync: false`, `generateValue`, secret-shaped key, or provider credential.

Each mutation must yield one fixed finding and never echo the mutated secret-like value.

- [ ] **Step 2: Run the validator tests and capture RED**

Run:

```powershell
pnpm vitest run scripts/validate-render-blueprint.test.ts
```

Expected: FAIL because the Blueprint and validator do not exist.

- [ ] **Step 3: Create the canonical Blueprint**

Create exactly:

```yaml
services:
  - type: web
    name: lineageguard-ai-replay
    runtime: node
    plan: free
    numInstances: 1
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm build
    startCommand: pnpm start:public-replay
    healthCheckPath: /api/health
    autoDeployTrigger: off
    renderSubdomainPolicy: enabled
    envVars:
      - key: NODE_VERSION
        value: 22.23.1
      - key: NODE_ENV
        value: production
      - key: LINEAGEGUARD_DEMO_MODE
        value: REPLAY
      - key: LINEAGEGUARD_DEPLOYMENT_PROFILE
        value: PUBLIC_REPLAY
      - key: LINEAGEGUARD_RUNS_DIR
        value: /tmp/lineageguard-runs
      - key: NEXT_TELEMETRY_DISABLED
        value: "1"
```

Correction C: The free service intentionally omits the provider-incompatible
`maxShutdownDelaySeconds` field.

Do not add `repo`, account IDs, generated values, secret placeholders, or a custom domain.

- [ ] **Step 4: Implement dependency-free exact validation**

Keep `EXPECTED_RENDER_BLUEPRINT` as the canonical newline-terminated text. Reject any byte-level
difference and classify safe fixed findings by comparing the required markers before returning the
final generic `Render Blueprint differs from the approved contract.` finding.

The executable `main` reads only `<root>/render.yaml`, size-bounds it to 16 KiB, and exits non-zero
with fixed English findings. It must not fetch the Render schema or require network access.

- [ ] **Step 5: Add the gate to package scripts**

Update `verify:offline` exactly to include `pnpm render:check` before build:

```json
"verify:offline": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm render:check && pnpm build && pnpm test:runtime-mode && pnpm test:e2e --project=chromium"
```

Task 6 adds `test:public-replay` to this gate after the dedicated harness exists. Keep the Task 5
toolchain contract green with the exact Task 5 command above.

- [ ] **Step 6: Run validator and expected toolchain transition**

Run:

```powershell
pnpm vitest run scripts/validate-render-blueprint.test.ts tests/smoke/toolchain.test.ts
pnpm render:check
git diff --check
```

Expected: Blueprint tests, `render:check`, the toolchain test, and `git diff --check` PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add render.yaml scripts/validate-render-blueprint.ts scripts/validate-render-blueprint.test.ts package.json tests/smoke/toolchain.test.ts
git commit -m "build: define the free Render service"
```

---

### Task 6: Prove Local Production and Opt-In Remote Acceptance

**Files:**

- Create: `playwright.public-replay.config.ts`
- Create: `playwright.public-remote.config.ts`
- Create: `tests/e2e/public-replay-global-setup.ts`
- Create: `tests/e2e/public-replay-server-lifecycle.ts`
- Create: `tests/e2e/public-replay-deployment.spec.ts`
- Create: `tests/e2e/public-replay-remote.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `tests/smoke/toolchain.test.ts`
- Modify: `tests/integration/e2e-harness.integration.test.ts`

**Interfaces:**

- Package scripts:

```json
"test:public-replay": "vitest run tests/api/run-routes.test.ts && playwright test --config playwright.public-replay.config.ts",
"test:public-deployment": "playwright test --config playwright.public-remote.config.ts"
```

- Remote acceptance requires:

```text
RUN_PUBLIC_REPLAY_ACCEPTANCE=1
LINEAGEGUARD_PUBLIC_URL set process-locally to the exact HTTPS URL returned by Task 7
```

The URL is runtime input from the real Render deployment, never a committed placeholder.

- [ ] **Step 1: Write failing lifecycle integration tests**

Extend `tests/integration/e2e-harness.integration.test.ts` for the new public lifecycle:

- creates an owned temporary parent but passes a missing child root to the bootstrap;
- waits for fixed health readiness on an isolated port;
- rejects an occupied port before creating a root;
- reports one fixed startup error without stdout/stderr/path leakage;
- terminates the full child tree;
- verifies endpoint release;
- removes only the owned parent after canonical-prefix and reparse-point checks; and
- retains the root when shutdown certainty is lost.

- [ ] **Step 2: Run the lifecycle integration test and capture RED**

Run:

```powershell
pnpm vitest run tests/integration/e2e-harness.integration.test.ts
```

Expected: FAIL because the public production lifecycle does not exist.

- [ ] **Step 3: Implement the public production lifecycle and configs**

Use port `3110`, one worker, Chromium, retained failure traces, and a global setup that starts
`dist/hosting/start-public-replay.js`.

Update ordinary `playwright.config.ts` with:

```ts
testIgnore: ["public-replay-deployment.spec.ts", "public-replay-remote.spec.ts"],
```

The local public config matches only `public-replay-deployment.spec.ts`. The remote config matches
only `public-replay-remote.spec.ts`, has no global setup, validates HTTPS and the `onrender.com`
hostname, rejects credentials in the URL, and refuses to run unless the opt-in flag equals `1`.

Update `verify:offline` exactly to:

```json
"verify:offline": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm render:check && pnpm build && pnpm test:runtime-mode && pnpm test:public-replay && pnpm test:e2e --project=chromium"
```

- [ ] **Step 4: Add failing local public browser acceptance**

The local spec must assert:

- `Public fixture replay`;
- the three request inputs are read-only;
- health returns exact 200 JSON;
- page, health, run, regeneration, and artifact responses contain required headers;
- the golden flow completes with 24, 11, 90, `BLOCK_DIRECT_RENAME`, and
  `NON_EXECUTABLE_TEMPLATE`;
- exactly four artifact tabs and downloads exist;
- favicon returns HTTP 200 with `image/svg+xml`;
- browser console has zero errors and zero warnings;
- all browser requests stay on `127.0.0.1:3110`;
- expired-artifact recovery shows `Run expired; analyze again.`.

Run the Task 2 API contract suite immediately before this browser spec as part of
`test:public-replay`; that suite supplies the local concurrency and capacity proof without adding
a production-only test override or public control route.

- [ ] **Step 5: Run local public acceptance and capture RED**

Run:

```powershell
pnpm build
pnpm test:public-replay
```

Expected: FAIL until the dedicated browser spec and all Task 1–5 contracts are wired correctly.

- [ ] **Step 6: Complete local public acceptance to GREEN**

Use only test-owned admission overrides or a test-only process environment before server startup;
never expose a production query parameter or route that changes capacity. Keep production defaults
at two and 64.

Run the Step 5 commands until they exit 0.

- [ ] **Step 7: Add the opt-in remote acceptance spec**

Reuse the same user-visible assertions against `LINEAGEGUARD_PUBLIC_URL`, excluding test-only
capacity manipulation. Capture console errors/warnings, verify the exact host for every browser
request, and check all four downloads. Do not log response bodies, environment values, or native
paths.

If the opt-in flag or URL is absent, configuration must fail before Playwright opens a browser; it
must not silently skip and report success.

- [ ] **Step 8: Run the complete offline gate**

Run:

```powershell
pnpm verify:offline
```

Expected:

- 0 formatter errors;
- 0 lint errors;
- strict type check PASS;
- all unit and contract tests PASS;
- `render:check` PASS;
- CLI and Next.js builds PASS;
- runtime-mode integration PASS;
- local public replay acceptance PASS;
- ordinary Chromium E2E PASS.

The existing anonymous-export lint warning may remain only if the repository gate still treats it
as a warning; do not add a new warning or weaken lint.

- [ ] **Step 9: Commit Task 6**

```powershell
git add playwright.public-replay.config.ts playwright.public-remote.config.ts tests/e2e/public-replay-global-setup.ts tests/e2e/public-replay-server-lifecycle.ts tests/e2e/public-replay-deployment.spec.ts tests/e2e/public-replay-remote.spec.ts playwright.config.ts package.json tests/smoke/toolchain.test.ts tests/integration/e2e-harness.integration.test.ts
git commit -m "test: prove the public replay deployment"
```

---

### Task 7: Prepare and Accept the First Real Render Candidate

**Files:**

- No repository changes until a real URL and acceptance result exist.
- External effect: create one free Render Blueprint service from the feature branch.

**Interfaces:**

- Consumes: green Task 6 branch head and canonical `render.yaml`.
- Produces for Task 8:

```text
exact HTTPS onrender.com URL
candidate Git commit SHA
Render service identifier held only by the deployment provider
sanitized remote acceptance result
```

- [ ] **Step 1: Run pre-publication repository gates**

Run:

```powershell
pnpm verify:offline
pnpm test:submission
pnpm submission:check
pnpm security:scan
pnpm security:scan:history
git diff --check
git status --short
```

Expected: every command exits 0 and the status contains no secrets, generated runs, Playwright
artifacts, `.env.local`, or unrelated changes.

- [ ] **Step 2: Run whole-branch review before external publication**

Invoke `superpowers:requesting-code-review` against the merge base and current head. Resolve every
critical or important finding through a separately approved correction when it changes the design.
Rerun the affected focused tests and Step 1 after any change.

- [ ] **Step 3: Push the candidate branch and open a draft PR**

Use the GitHub publication workflow. The PR body must state:

- `PUBLIC_REPLAY` only;
- no DataHub/OpenAI credentials or network calls;
- free Render ephemeral/cold-start limitations;
- two concurrent workflows and 64 publication reservations;
- offline gate result; and
- public acceptance still pending.

Do not mark the PR ready or merge it.

- [ ] **Step 4: Create one free Render service**

Invoke the repository's Render deployment skill against the canonical Blueprint. Create only:

```text
one Native Node web service
plan free
numInstances 1
no disk
no database
no secret environment values
autoDeployTrigger off
```

If Render account connection or repository authorization requires the owner, pause at that exact
external approval step. Do not substitute credentials, a paid plan, Docker, or another provider.

- [ ] **Step 5: Capture the actual URL and candidate commit without editing docs**

Require the returned URL to parse as HTTPS, have no username/password/query/fragment, and end in
`.onrender.com`. Confirm Render reports the candidate commit SHA expected by the branch.

Keep the service identifier private. The public URL and commit SHA are allowed submission evidence.

- [ ] **Step 6: Run opt-in remote acceptance**

Set `LINEAGEGUARD_PUBLIC_URL` in the current process to the exact returned URL and set
`RUN_PUBLIC_REPLAY_ACCEPTANCE=1`. Then run:

```powershell
pnpm test:public-deployment
```

Expected: PASS after any documented cold start, with exact health, label, `24 / 11 / 90`,
`BLOCK_DIRECT_RENAME`, four artifacts, headers, favicon, request-host, and console assertions.

- [ ] **Step 7: Review Task 7 evidence**

The task report may contain only the public URL, candidate commit, UTC/Kyiv date, pass/fail outcome,
and cold-start observation. It must not contain a Render token, account/workspace ID, raw logs,
native path, response body, or browser trace.

No commit is created in Task 7.

---

### Task 8: Document the Real URL and Bind Submission Evidence

**Files:**

- Create: `docs/public-deployment-verification.md`
- Modify: `README.md`
- Modify: `docs/resources-and-attribution.md`
- Modify: `docs/submission-checklist.md` only if the owner personally verifies the matching boxes
- Modify: `docs/judging-map.md`
- Modify: `scripts/validate-submission-assets.ts`
- Modify: `scripts/validate-submission-assets.test.ts`

**Interfaces:**

- Consumes: exact URL, candidate commit, and sanitized PASS result from Task 7.
- Produces: committed, validator-enforced public deployment evidence with no placeholders.

- [ ] **Step 1: Write failing submission-validator tests**

Require:

- `docs/public-deployment-verification.md`;
- the exact actual HTTPS `onrender.com` URL from Task 7;
- `Status: PASSED`;
- the candidate 40-character lowercase Git SHA;
- `Public fixture replay`;
- `No DataHub or OpenAI credentials`;
- `Ephemeral runs`;
- official Render Blueprint, Next.js deployment, free-tier, and health-check documentation URLs;
- README cold-start and rerun recovery copy; and
- no unresolved planning marker, fabricated hostname, account ID, token, or secret-bearing URL.

Mutate each marker independently and require a fixed safe finding.

- [ ] **Step 2: Run the validator tests and capture RED**

Run:

```powershell
pnpm test:submission
pnpm submission:check
```

Expected: FAIL because the real deployment evidence is not yet documented.

- [ ] **Step 3: Write the public verification record**

Use the exact Task 7 URL, candidate commit, and actual UTC/Europe-Kyiv verification date. The
document must contain the heading `# Public Deployment Verification` and these literal values:

```text
Status: PASSED
Mode: PUBLIC_REPLAY
Access: No login, DataHub, OpenAI, API key, or paid account required
Storage: Ephemeral runs; rerun the deterministic replay after restart
```

Add `Project URL`, `Reviewed runtime commit`, and `Verified date` fields using only the real values
returned and verified in Task 7. Do not commit descriptive stand-ins for those values.

Add a bounded evidence table for health, private-browser access, golden result, four artifacts,
headers, console, and request host. Record only `PASSED` and sanitized facts.

- [ ] **Step 4: Update README, judging map, and attribution**

Add the exact Project URL to the Fixture Replay section. State that first load may take
approximately one minute, runs are ephemeral, and `Run expired; analyze again.` means the judge
should rerun the deterministic scenario.

Add official Render references:

```text
https://render.com/docs/blueprint-spec
https://render.com/docs/deploy-nextjs-app
https://render.com/docs/free
https://render.com/docs/health-checks
```

Classify Render as deployment infrastructure, with no code or prose copied.

- [ ] **Step 5: Preserve manual checklist truth**

Ask the owner to open the Project URL in a private browser and confirm that it requires no login,
key, DataHub, OpenAI, or paid account. Only after that human confirmation may these two boxes be
checked:

```text
Provide an easy-access Project URL...
Verify the Project URL does not require...
```

Leave video, Devpost, screenshots, final tag, and every unrelated manual box unchecked.

- [ ] **Step 6: Run documentation and submission gates to GREEN**

Run:

```powershell
pnpm test:submission
pnpm submission:check
pnpm security:scan
pnpm format:check
pnpm lint
pnpm typecheck
git diff --check
```

Expected: PASS with no new lint warning and no secret finding.

- [ ] **Step 7: Commit and push Task 8**

```powershell
git add docs/public-deployment-verification.md README.md docs/resources-and-attribution.md docs/submission-checklist.md docs/judging-map.md scripts/validate-submission-assets.ts scripts/validate-submission-assets.test.ts
git commit -m "docs: record the public replay deployment"
git push
```

If the checklist did not receive human confirmation, omit it from `git add`.

- [ ] **Step 8: Manually deploy the documentation commit and rerun remote acceptance**

Because auto-deploy is off, deploy the new branch head explicitly. Set the process-local URL and
opt-in flag again, then run:

```powershell
pnpm test:public-deployment
```

Expected: PASS. The committed verification record remains bound to the reviewed runtime commit from
Task 7; Task 8 changes only submission documentation and validators.

---

### Task 9: Final Review, CI, Merge, Main Deployment, and Freeze Gate

**Files:**

- Modify only files required by approved review corrections.
- No Devpost, video, GitHub About, Slack, or upstream DataHub publication.

**Interfaces:**

- Consumes: complete branch, real public URL, green local/remote acceptance.
- Produces: merged `main`, verified main deployment, and a recommended immutable tag pending the
  owner's explicit final submission-freeze approval.

- [ ] **Step 1: Run the final full local gate**

Run:

```powershell
pnpm verify:offline
pnpm test:submission
pnpm submission:check
pnpm security:scan
pnpm security:scan:history
git diff --check
git status --short
```

Expected: every command exits 0. Report any retry, skip, stale evidence, or unavailable check
truthfully.

- [ ] **Step 2: Run final remote acceptance**

With the exact public URL in the process environment:

```powershell
pnpm test:public-deployment
```

Expected: PASS against the current branch head deployed manually on Render.

- [ ] **Step 3: Perform the final whole-branch review**

Invoke `superpowers:requesting-code-review`. Require:

- 0 critical findings;
- 0 important findings;
- exact specification coverage;
- no new dependency or lockfile diff;
- no credential, secret placeholder, raw trace, native path, or account identifier;
- exact Render free/single-instance/no-disk Blueprint;
- unchanged local `LIVE` and `REPLAY`;
- offline CI independence; and
- truthful public verification evidence.

Apply only approved minimal corrections, rerun focused tests, the full local gate, and remote
acceptance when runtime behavior changes.

- [ ] **Step 4: Mark the PR ready and wait for GitHub CI**

Update the PR body with the public URL, sanitized remote PASS, and verification-document link. Mark
it ready. Wait until every required check is complete and successful. Do not merge on pending,
cancelled, neutral, skipped-required, or failed status.

- [ ] **Step 5: Merge and synchronize main**

Use the repository's established merge method. Then:

```powershell
git switch main
git pull --ff-only origin main
```

Preserve unrelated local changes and do not remove a dirty worktree.

- [ ] **Step 6: Deploy the merged main commit**

With auto-deploy still off, manually deploy the exact merged `main` commit. Confirm Render reports
that commit and `/api/health` is HTTP 200.

- [ ] **Step 7: Run final main remote acceptance**

Run the opt-in remote Playwright acceptance against the unchanged Project URL.

Expected: PASS with the merged main deployment.

- [ ] **Step 8: Present the immutable freeze gate to the owner**

Report:

- merged main commit;
- public Project URL;
- GitHub CI result;
- final remote acceptance result;
- remaining manual video, screenshot, Devpost, and submission-checklist actions; and
- the proposed immutable tag name `datahub-hackathon-2026-submission`.

Do not create or push the tag until the owner explicitly confirms that the submission version is
ready to freeze. Tagging and Devpost submission are separate owner gates.

---

## Final Traceability

| Design requirement                                  | Primary task |
| --------------------------------------------------- | ------------ |
| `PUBLIC_REPLAY` requires credential-free `REPLAY`   | Task 1       |
| Exact golden request and fixed public UI            | Task 1–2     |
| Two concurrent workflows                            | Task 2       |
| Sixty-four publication reservations                 | Task 2       |
| Fixed safe busy/capacity errors                     | Task 2       |
| No-store and browser-security headers               | Task 3       |
| Fixed health endpoint                               | Task 3       |
| Safe ephemeral root bootstrap and child environment | Task 4       |
| Exact Node/pnpm/start lifecycle                     | Task 4       |
| One free Native Node Render service                 | Task 5       |
| No disk, database, secrets, or auto-deploy          | Task 5       |
| Local production acceptance                         | Task 6       |
| Opt-in real Render acceptance                       | Task 6–7     |
| Real URL and sanitized commit-bound evidence        | Task 8       |
| Submission validator and attribution                | Task 8       |
| CI, remote acceptance, merge, main deployment       | Task 9       |
| Immutable submission freeze remains an owner gate   | Task 9       |

## Review Gates

Each implementation task receives an independent specification-compliance review and code-quality
review before the next task starts. Task 7 and later additionally require the project owner at any
Render authorization or manual submission-checkbox gate. No reviewer may silently expand the
runtime to hosted `LIVE`, add credentials, enable persistence, change the free plan, or weaken an
offline check.
