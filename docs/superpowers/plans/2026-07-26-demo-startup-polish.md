# Demo Startup Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a repository-owned browser icon and run the built local demo through `next start`
without the incompatible standalone-output warning.

**Architecture:** Keep the approved local Next.js runtime and existing `start:web` command. Remove
only the incompatible standalone build output, add one static App Router metadata icon, and protect
both changes with focused configuration and browser boundary tests.

**Tech Stack:** TypeScript 6.0.3, Next.js 16.2.11 App Router, React 19.2.8, Vitest 4.1.10,
Playwright 1.61.1, pnpm 10.10.0, Node.js 22.23.1.

## Global Constraints

- Approved product authority is `docs/specs/002-nextjs-openai-agent-demo/spec.md`.
- Approved corrective design is
  `docs/superpowers/specs/2026-07-26-demo-startup-polish-design.md`.
- Keep `start:web` exactly `next start`; hosted deployment remains out of scope.
- Do not add dependencies or modify `pnpm-lock.yaml`.
- Preserve strict TypeScript, ESM, Webpack build flags, runtime modes, API routes, and security
  boundaries.
- Keep code, tests, documentation, UI text, commits, and repository artifacts in English.
- Do not stage or modify the existing unrelated generated `next-env.d.ts` working-tree change.
- Follow strict RED-GREEN TDD for each behavior change.

## File Map

- Modify `tests/smoke/toolchain.test.ts` — protect the compatible built-runtime configuration.
- Modify `next.config.ts` — stop requesting standalone output.
- Modify `tests/e2e/lineageguard-demo.spec.ts` — prove the rendered icon boundary.
- Create `app/icon.svg` — provide the static, script-free LineageGuard browser icon.
- Inspect only `package.json`, `pnpm-lock.yaml`, and `next-env.d.ts` — prove they remain unchanged
  by this implementation.

---

### Task 1: Make the Built Output Compatible with `next start`

**Files:**

- Modify: `tests/smoke/toolchain.test.ts`
- Modify: `next.config.ts`

**Interfaces:**

- Consumes: the current `NextConfig` default export and the existing package script contract.
- Produces: a Next.js build without `output: "standalone"` while preserving `start:web` as
  `next start`.

- [ ] **Step 1: Add the failing runtime-compatibility test**

Add the config import:

```ts
import nextConfig from "../../next.config.js";
```

Add this focused test inside `describe("toolchain", ...)`:

```ts
it("keeps the built output compatible with next start", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(process.cwd(), "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
  };

  expect(packageJson.scripts["start:web"]).toBe("next start");
  expect(nextConfig.output).toBeUndefined();
});
```

The production mutation this test catches is reintroducing standalone output while the repository
still starts the built application with `next start`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm vitest run tests/smoke/toolchain.test.ts
```

Expected: FAIL in `keeps the built output compatible with next start` because the received output
is `"standalone"`.

- [ ] **Step 3: Apply the minimal compatible configuration**

Change `next.config.ts` to:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm vitest run tests/smoke/toolchain.test.ts
```

Expected: PASS with both toolchain tests green.

- [ ] **Step 5: Verify the focused diff**

Run:

```powershell
git diff --check
git diff -- next.config.ts tests/smoke/toolchain.test.ts
git status --short
```

Expected: only the two Task 1 files plus the already-preserved `next-env.d.ts` and plan/design
artifacts appear; no manifest or lockfile changes exist.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- next.config.ts tests/smoke/toolchain.test.ts
git diff --cached --check
git commit -m "fix: align demo output with next start"
```

---

### Task 2: Serve a Repository-Owned Browser Icon

**Files:**

- Modify: `tests/e2e/lineageguard-demo.spec.ts`
- Create: `app/icon.svg`

**Interfaces:**

- Consumes: Next.js App Router metadata-file discovery and the existing Playwright base URL.
- Produces: one rendered `link[rel="icon"]` whose repository-owned SVG target returns HTTP 200
  with an SVG content type.

- [ ] **Step 1: Add the failing browser boundary test**

Add this test after the existing `beforeEach` block:

```ts
test("serves the repository-owned browser icon", async ({ page, request }) => {
  await page.goto("/");

  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveCount(1);
  const href = await icon.getAttribute("href");
  expect(href).not.toBeNull();

  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
});
```

The production mutation this test catches is removing or breaking the icon metadata file so the
document no longer points to a successfully served repository asset.

- [ ] **Step 2: Run the focused browser test and verify RED**

Run:

```powershell
pnpm test:e2e --project=chromium --grep "serves the repository-owned browser icon"
```

Expected: FAIL because the rendered document has no `link[rel="icon"]`.

- [ ] **Step 3: Add the minimal script-free SVG icon**

Create `app/icon.svg` with:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0b1220" />
  <path
    d="M32 7 53 15v15c0 13-8.2 22.2-21 27C19.2 52.2 11 43 11 30V15L32 7Z"
    fill="none"
    stroke="#39d9c5"
    stroke-width="4"
  />
  <text
    x="32"
    y="38"
    fill="#f8fafc"
    font-family="Arial, sans-serif"
    font-size="19"
    font-weight="700"
    text-anchor="middle"
  >
    LG
  </text>
</svg>
```

- [ ] **Step 4: Run the focused browser test and verify GREEN**

Run:

```powershell
pnpm test:e2e --project=chromium --grep "serves the repository-owned browser icon"
```

Expected: PASS; the rendered icon link exists and its target returns HTTP 200 with
`image/svg+xml`.

- [ ] **Step 5: Run the complete Chromium browser suite**

Run:

```powershell
pnpm test:e2e --project=chromium
```

Expected: PASS with no golden-flow, error-state, download, cancellation, or accessibility
regression.

- [ ] **Step 6: Verify the focused diff**

Run:

```powershell
git diff --check
git diff -- app/icon.svg tests/e2e/lineageguard-demo.spec.ts
git status --short
```

Expected: only the two Task 2 files and the preserved unrelated `next-env.d.ts` remain outside
earlier commits.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- app/icon.svg tests/e2e/lineageguard-demo.spec.ts
git diff --cached --check
git commit -m "fix: serve the LineageGuard browser icon"
```

---

### Task 3: Run the Final Preflight

**Files:**

- Inspect: `package.json`
- Inspect: `pnpm-lock.yaml`
- Inspect: `next-env.d.ts`
- Inspect: all Task 1 and Task 2 diffs and commits
- Create temporarily and remove: one rehearsal-owned runs directory and local server logs beneath
  the ignored `tmp/` root

**Interfaces:**

- Consumes: the built application, local DataHub GMS/UI, pinned MCP `0.6.0`, and repository
  verification scripts.
- Produces: fresh local evidence that the offline gate, production startup, favicon boundary,
  DataHub preflight, and secret scan pass without a paid OpenAI request.

- [ ] **Step 1: Run the complete offline verification gate**

Run:

```powershell
pnpm verify:offline
```

Expected: formatting, lint, type checking, offline Vitest, CLI and web builds, built-runtime tests,
and Chromium browser tests all PASS.

- [ ] **Step 2: Run submission and secret gates**

Run:

```powershell
pnpm test:submission
pnpm submission:check
pnpm security:scan
```

Expected: all three commands exit 0 and report no repository credential findings.

- [ ] **Step 3: Verify local DataHub health**

Run:

```powershell
(Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -TimeoutSec 5).StatusCode
(Invoke-WebRequest -Uri "http://localhost:9002" -UseBasicParsing -TimeoutSec 5).StatusCode
```

Expected: `200` for both GMS and the DataHub UI.

- [ ] **Step 4: Run the pinned read-only MCP integration preflight**

Load the existing local PAT into the process only, without printing it:

```powershell
$env:DATAHUB_GMS_URL = "http://localhost:8080"
$env:DATAHUB_GMS_TOKEN = & .\.venv\Scripts\python.exe -c "from pathlib import Path; import yaml; config=yaml.safe_load(Path.home().joinpath('.datahubenv').read_text(encoding='utf-8')); find=lambda value: next((found for key,item in value.items() for found in ([item] if key.lower()=='token' and isinstance(item,str) else [find(item)] if isinstance(item,dict) else []) if found), None); token=find(config); assert token and isinstance(token,str); print(token)"
$env:DATAHUB_MCP_UVX_PATH = (Get-Command uvx -ErrorAction Stop).Source
try {
  pnpm test:integration
  if ($LASTEXITCODE -ne 0) { throw "Pinned MCP integration preflight failed." }
} finally {
  Remove-Item Env:DATAHUB_GMS_TOKEN -ErrorAction SilentlyContinue
}
```

Expected: the environment-gated pinned MCP integration tests PASS; any explicitly conditional
probe remains reported as skipped rather than passed.

- [ ] **Step 5: Verify the real production startup and favicon console**

Start `pnpm start:web` in replay mode with a unique ignored temporary runs root, capture stdout and
stderr, and wait until `http://localhost:3000` returns HTTP 200. Use the Playwright CLI in a named
session to open the page and verify:

```text
link[rel="icon"] count = 1
icon response status = 200
browser console errors = 0
```

Inspect the captured server logs and require that neither contains:

```text
does not work with "output: standalone"
```

Stop only the verified process tree owned by this preflight, close the named browser session,
confirm port 3000 is released, and remove only the exact preflight-owned temporary directory.

- [ ] **Step 6: Inspect final repository state**

Run:

```powershell
git diff --check
git status --short
git log -3 --oneline --decorate
git diff main...HEAD --stat
git diff main...HEAD -- package.json pnpm-lock.yaml next-env.d.ts
```

Expected:

- `git diff --check` passes;
- `package.json` and `pnpm-lock.yaml` have no implementation diff;
- the pre-existing uncommitted `next-env.d.ts` change remains preserved and uncommitted;
- no temporary runs, logs, credentials, downloads, or browser artifacts remain;
- the branch contains the approved design/plan and the two focused implementation commits.

- [ ] **Step 7: Perform the whole-branch review**

Review `git diff main...HEAD` against every acceptance criterion in
`docs/superpowers/specs/2026-07-26-demo-startup-polish-design.md`. Confirm:

- no scope expansion;
- the startup warning is eliminated by a compatible configuration, not hidden;
- the icon contains no scripts or external references;
- both regression tests fail under the corresponding reverse production mutation;
- no secret, trace, generated run, or unrelated file entered the branch.
