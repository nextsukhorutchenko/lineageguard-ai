# Playwright Test Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repository-owned Playwright planner, generator, and healer definitions for local
Codex-assisted test authoring without changing runtime behavior or mandatory CI.

**Architecture:** The lockfile-pinned Playwright 1.61.1 CLI generates the three Codex TOML agent
definitions. A deterministic REPLAY seed test supplies the existing managed Chromium harness to
the agents, while a focused smoke contract detects missing, stale, or unsafe generated files.

**Tech Stack:** Node.js 22.23.1, pnpm 10.10.0, TypeScript 6.0.3, Playwright Test 1.61.1, Vitest
4.1.10.

## Global Constraints

- Treat the approved design in
  `docs/superpowers/specs/2026-07-26-playwright-agents-pr-impact-midscene-design.md` as authority.
- Keep LineageGuard runtime, application-agent, DataHub, OpenAI, artifact, and browser product
  behavior unchanged.
- Generate agents only with the exact installed Playwright CLI; never use `@latest`.
- Keep Test Agents local-authoring-only and outside `verify:offline` and GitHub Actions.
- Reuse the managed REPLAY server lifecycle and Chromium project.
- Keep all repository artifacts in English.
- Preserve strict TypeScript, ESM, relative `.js` import conventions, and current gates.
- Do not commit, push, create branches, or change GitHub state without separate owner permission.

---

### Task 1: Define the Playwright Agent Repository Contract

**Files:**

- Create: `tests/smoke/playwright-agents.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `package.json`, `tests/e2e/seed.spec.ts`, `specs/README.md`, and generated
  `.codex/agents/*.toml`.
- Produces: one deterministic smoke contract and the exact `agents:init` package script used by
  later tasks.

- [ ] **Step 1: Install the frozen repository toolchain**

Run:

```powershell
pnpm install --frozen-lockfile
```

Expected: exit 0 without modifying `package.json` or `pnpm-lock.yaml`.

- [ ] **Step 2: Write the failing smoke contract**

Create `tests/smoke/playwright-agents.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = async (path: string): Promise<string> =>
  await readFile(resolve(process.cwd(), path), "utf8");

const agents = [
  {
    path: ".codex/agents/playwright_test_planner.toml",
    name: "playwright_test_planner",
    sandboxMode: "read-only",
  },
  {
    path: ".codex/agents/playwright_test_generator.toml",
    name: "playwright_test_generator",
    sandboxMode: "read-only",
  },
  {
    path: ".codex/agents/playwright_test_healer.toml",
    name: "playwright_test_healer",
    sandboxMode: "workspace-write",
  },
] as const;

describe("Playwright Test Agents", () => {
  it("uses the exact installed Playwright CLI for regeneration", async () => {
    const packageJson = JSON.parse(await readRepositoryFile("package.json")) as {
      readonly devDependencies: Readonly<Record<string, string>>;
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(packageJson.devDependencies["@playwright/test"]).toBe("1.61.1");
    expect(packageJson.scripts["agents:init"]).toBe(
      "playwright init-agents --loop=codex --project=chromium",
    );
    expect(packageJson.scripts["verify:offline"]).not.toContain("agents:init");
  });

  it.each(agents)("keeps $name as a bounded local Codex definition", async (agent) => {
    const content = await readRepositoryFile(agent.path);

    expect(content).toContain(`name = "${agent.name}"`);
    expect(content).toContain(`sandbox_mode = "${agent.sandboxMode}"`);
    expect(content).toContain("[mcp_servers.playwright-test]");
    expect(content).toContain('"playwright", "run-test-mcp-server"');
    expect(content).not.toContain("@latest");
    expect(content).not.toContain("GITHUB_TOKEN");
    expect(content).not.toContain("GH_TOKEN");
  });

  it("uses a deterministic fixture-replay seed", async () => {
    const seed = await readRepositoryFile("tests/e2e/seed.spec.ts");
    const plansReadme = await readRepositoryFile("specs/README.md");

    expect(seed).toContain('test("seeds the fixture replay workspace"');
    expect(seed).toContain('page.goto("/")');
    expect(seed).toContain('"Fixture replay"');
    expect(seed).not.toContain("OPENAI_API_KEY");
    expect(seed).not.toContain("DATAHUB_GMS_TOKEN");
    expect(plansReadme).toContain("Playwright Agent Test Plans");
    expect(plansReadme).toContain("human review");
  });
});
```

- [ ] **Step 3: Add the exact regeneration script**

Add this entry to `package.json` under `scripts`:

```json
"agents:init": "playwright init-agents --loop=codex --project=chromium"
```

Do not change any dependency or existing script.

- [ ] **Step 4: Run the focused contract and verify RED**

Run:

```powershell
pnpm vitest run tests/smoke/playwright-agents.test.ts
```

Expected: FAIL because `tests/e2e/seed.spec.ts`, `specs/README.md`, and the three Codex agent
definitions do not exist.

- [ ] **Step 5: Inspect the focused diff**

Run:

```powershell
git diff -- package.json tests/smoke/playwright-agents.test.ts
git diff --check
```

Expected: only the script and failing smoke contract are present; `git diff --check` exits 0.
Do not commit.

---

### Task 2: Add the REPLAY Seed and Generate the Codex Definitions

**Files:**

- Create: `tests/e2e/seed.spec.ts`
- Create: `specs/README.md`
- Generate: `.codex/agents/playwright_test_planner.toml`
- Generate: `.codex/agents/playwright_test_generator.toml`
- Generate: `.codex/agents/playwright_test_healer.toml`
- Test: `tests/smoke/playwright-agents.test.ts`

**Interfaces:**

- Consumes: the current `playwright.config.ts`, managed `globalSetup`, Chromium project, REPLAY
  server, and `agents:init` script.
- Produces: one runnable seed and three Playwright-generated Codex agent definitions.

- [ ] **Step 1: Create the deterministic seed test**

Create `tests/e2e/seed.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("seeds the fixture replay workspace", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Know the blast radius before you ship." }),
  ).toBeVisible();
  await expect(page.locator(".mode-badge")).toHaveText("Fixture replay");
  await expect(page.getByRole("button", { name: "Analyze change" })).toBeEnabled();
});
```

The seed performs no live request, mutation, generation, or GitHub operation. Because adding a
second spec file otherwise makes Playwright run two files concurrently against the shared
stateful REPLAY harness, keep the main configuration explicitly single-worker.

- [ ] **Step 2: Create the repository-owned test-plan directory contract**

Create `specs/README.md`:

```markdown
# Playwright Agent Test Plans

This directory contains human-readable plans produced for Playwright Test Agent authoring.

Agent-produced plans are advisory drafts. They require human review before the generator creates
or changes tests. Generated tests must preserve the repository's REPLAY harness, deterministic
assertions, safety boundaries, and mandatory offline gates.

Do not place product specifications, credentials, provider output, traces, or native paths here.
Approved product authority remains under `docs/specs/` and `docs/superpowers/specs/`.
```

- [ ] **Step 3: Generate the three definitions from Playwright 1.61.1**

Run:

```powershell
pnpm agents:init
```

Expected output identifies project `chromium`, the existing seed file, and these files:

```text
.codex/agents/playwright_test_planner.toml
.codex/agents/playwright_test_generator.toml
.codex/agents/playwright_test_healer.toml
```

The command must not create `.github/agents`, a GitHub workflow, or a second Playwright
configuration.

- [ ] **Step 4: Review generated capabilities before trusting them**

Run:

```powershell
Get-ChildItem .codex/agents -File | Select-Object -ExpandProperty Name
Select-String -Path .codex/agents/*.toml -Pattern '@latest|GITHUB_TOKEN|GH_TOKEN|github api|gh '
```

Expected:

- exactly the three approved TOML files are listed;
- the pattern scan returns no match;
- planner and generator are read-only;
- healer is workspace-write;
- every MCP command names `playwright run-test-mcp-server` without a version download.

- [ ] **Step 5: Run the smoke contract and verify GREEN**

Run:

```powershell
pnpm vitest run tests/smoke/playwright-agents.test.ts
```

Expected: PASS.

- [ ] **Step 6: Prove the narrow browser filter before running it**

Run:

```powershell
pnpm exec playwright test --project=chromium --grep "seeds the fixture replay workspace" --list
```

Expected: exactly one selected test, `tests/e2e/seed.spec.ts`.

- [ ] **Step 7: Run the seed through the managed lifecycle**

Run:

```powershell
pnpm exec playwright test --project=chromium --grep "seeds the fixture replay workspace"
```

Expected: one test passes, the command exits 0, the managed server stops, and no live DataHub or
OpenAI call occurs.

- [ ] **Step 8: Review the complete generated diff**

Run:

```powershell
git status --short
git diff -- package.json tests/smoke/playwright-agents.test.ts
git diff --no-index -- NUL tests/e2e/seed.spec.ts
git diff --no-index -- NUL specs/README.md
Get-Content .codex/agents/playwright_test_planner.toml
Get-Content .codex/agents/playwright_test_generator.toml
Get-Content .codex/agents/playwright_test_healer.toml
```

Expected: only approved Test Agent files, seed, plan-directory README, smoke contract, design
document, and implementation-plan documents are present. Do not commit.

---

### Task 3: Document and Verify the Local Authoring Workflow

**Files:**

- Create: `docs/testing/playwright-test-agents.md`
- Test: `tests/smoke/playwright-agents.test.ts`
- Test: `tests/e2e/seed.spec.ts`

**Interfaces:**

- Consumes: `pnpm agents:init`, the three `.codex/agents` definitions, `specs/`, and the REPLAY
  seed.
- Produces: one English operator guide and complete offline verification evidence.

- [ ] **Step 1: Write the operator guide**

Create `docs/testing/playwright-test-agents.md` with these exact sections and requirements:

```markdown
# Playwright Test Agents

## Purpose

The repository includes Playwright planner, generator, and healer definitions for local Codex
test authoring. They are developer tools, not LineageGuard runtime agents.

## Prerequisites

Run `pnpm install --frozen-lockfile` and install the pinned Chromium browser. The agents use the
repository's existing `chromium` project, managed REPLAY server, and
`tests/e2e/seed.spec.ts`.

## Regeneration

Run `pnpm agents:init` whenever the exact `@playwright/test` version changes. Review all generated
files under `.codex/agents/` before accepting them. Never replace the command with an `@latest`
download.

## Authoring Loop

1. Ask the planner for one bounded user flow and review the Markdown draft under `specs/`.
2. Ask the generator to implement only approved scenarios.
3. Run the narrow test list, the focused test, and then the complete Chromium suite.
4. Use the healer only for a genuine test defect. Do not skip a test, weaken an assertion, or hide
   a product failure.

## Safety Boundary

The agents must not receive live provider credentials, modify GitHub state, call GitHub APIs,
change LineageGuard runtime behavior, or run in mandatory CI. Agent-authored files are untrusted
drafts until they pass human review and repository gates.
```

- [ ] **Step 2: Run focused formatting and static verification**

Run:

```powershell
pnpm exec prettier --check tests/smoke/playwright-agents.test.ts tests/e2e/seed.spec.ts specs/README.md docs/testing/playwright-test-agents.md
pnpm vitest run tests/smoke/playwright-agents.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the complete Chromium suite**

Run:

```powershell
pnpm test:e2e --project=chromium
```

Expected: every existing browser test plus the seed passes; the process exits 0 and owns its
server lifecycle.

- [ ] **Step 4: Run repository gates**

Run in order:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:runtime-mode
pnpm security:scan
pnpm verify:offline
git diff --check
git status --short
```

Expected: every command exits 0. Prove the browser selection from `verify:offline` by retaining its
Playwright test count and confirming it includes `tests/e2e/seed.spec.ts`. Report any unavailable
check truthfully. Inspect the focused diff and do not commit.
