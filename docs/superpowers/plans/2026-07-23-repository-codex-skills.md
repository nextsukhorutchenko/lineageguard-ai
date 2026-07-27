# Repository Codex Skills Implementation Plan

> **Lifecycle:** Implemented — historical execution record.
>
> The implementation outcome is present in the repository. Unchecked boxes preserve the original
> execution sequence; they are not an outstanding-work tracker. Earlier snippets may be superseded
> by later approved amendments and the current implementation. Use `docs/README.md` to find current
> authority, operator guidance, and verification evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three tested repository-owned Codex skills that automatically route approved-plan implementation, safe live-demo verification, and evidence-backed hackathon submission work.

**Architecture:** Keep the skills as thin instruction packages under `.agents/skills`, with one `SKILL.md` and one `agents/openai.yaml` per workflow. Precise frontmatter descriptions provide implicit matching, explicit `allow_implicit_invocation: true` metadata makes that policy auditable, and root `AGENTS.md` defines mandatory routing and compound-request order. A dependency-free Vitest contract keeps discovery, metadata, authority links, and routing stable in ordinary offline CI.

**Tech Stack:** Markdown, YAML, Codex repository skills, Node.js 22.23.1, TypeScript 6.0.3, Vitest 4.1.10, Prettier 3.9.6, the installed `skill-creator`, an ephemeral `uv` environment with pinned `PyYAML==6.0.3` for structural validation, and the official `@openai/codex@0.145.0` CLI through `npx` for fresh-worktree behavioral validation.

## Global Constraints

- Work only in the current `agent/nextjs-openai-agent-spec` worktree and preserve unrelated user changes.
- Implement exactly three repository skills under `.agents/skills`: `implement-lineageguard-approved-plan`, `verify-lineageguard-live-demo`, and `prepare-lineageguard-submission`.
- Keep each skill limited to `SKILL.md` and `agents/openai.yaml`; do not add skill-local scripts, references, or assets.
- Keep `SKILL.md` frontmatter limited to `name` and `description`.
- Set `policy.allow_implicit_invocation: true` and include the exact `$skill-name` in every `interface.default_prompt`.
- Keep root `AGENTS.md` concise and require every applicable skill for compound requests in `verify → implement → prepare` order.
- Keep the approved specification and plan authoritative; no skill may silently broaden scope.
- Preserve one TypeScript package, one `rename_column` change kind, four read-only DataHub operations, exactly two application-owned OpenAI tools, deterministic application authority, truthful `LIVE`/`REPLAY` labeling, and human approval gates.
- Keep `.agents/skills/...` separate from the unimplemented Task 14A product artifact at `skills/lineageguard-schema-change-impact/...`.
- Add no application runtime dependency, MCP dependency, OpenAI agent tool, live CI job, secret, or external publication action.
- Keep ordinary CI offline and secret-free; fresh-agent behavioral scenarios are an execution-time validation gate, not a CI job.
- Use the authoring-preflight cache for `PyYAML==6.0.3` with `uv run --offline`; if that exact package is missing, stop and obtain explicit approval before seeding the cache rather than adding it to the project.
- Use the authoring-preflight cache for `@openai/codex@0.145.0` with `npx --offline`; if that exact package is missing, stop and obtain explicit approval before seeding the cache rather than adding it to the project.
- Obtain explicit user approval before any fresh Codex CLI scenario sends its prompt and repository instructions to the official OpenAI service. Use `--ephemeral`, `--sandbox read-only`, and the exact feature-worktree path; persist no JSONL output.
- Author and validate one skill at a time with RED, GREEN, forward-test, refactor, review, and commit.
- Keep all repository content in English.

## Target File Map

- Create `tests/repository-skills.test.ts` — offline contract for skill directories, frontmatter, OpenAI metadata, exact authority paths, root routing, and compound order.
- Modify `AGENTS.md` — mandatory repository-skill routing and compound-request rules.
- Create `.agents/skills/implement-lineageguard-approved-plan/SKILL.md` — approved-plan implementation workflow and product-authority guardrails.
- Create `.agents/skills/implement-lineageguard-approved-plan/agents/openai.yaml` — UI metadata and implicit invocation policy.
- Create `.agents/skills/verify-lineageguard-live-demo/SKILL.md` — safe read-only live preflight, evidence, and fixture-source workflow.
- Create `.agents/skills/verify-lineageguard-live-demo/agents/openai.yaml` — UI metadata and implicit invocation policy.
- Create `.agents/skills/prepare-lineageguard-submission/SKILL.md` — evidence-backed submission and external-action gates.
- Create `.agents/skills/prepare-lineageguard-submission/agents/openai.yaml` — UI metadata and implicit invocation policy.

No `package.json`, lockfile, or CI workflow change is needed. The existing `pnpm test` command discovers `tests/repository-skills.test.ts`.

---

### Task 1: Add the Contract Test and Approved-Plan Implementation Skill

**Files:**

- Create: `tests/repository-skills.test.ts`
- Modify: `AGENTS.md`
- Create: `.agents/skills/implement-lineageguard-approved-plan/SKILL.md`
- Create: `.agents/skills/implement-lineageguard-approved-plan/agents/openai.yaml`

**Interfaces:**

- Consumes: `PROJECT_BRIEF.md`, approved specification `docs/specs/002-nextjs-openai-agent-demo/spec.md`, approved plan `docs/specs/002-nextjs-openai-agent-demo/plan.md`, and installed general engineering skills.
- Produces: one implicitly invocable implementation skill plus the reusable `SkillExpectation` contract used by Tasks 2 and 3.

- [ ] **Step 1: Record the pressure-scenario RED baseline**

After receiving explicit user approval for this external validation, run a fresh ephemeral Codex session rooted in the exact feature worktree:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$Prompt = @'
You are working in the LineageGuard AI repository. The user says: "Continue the next approved implementation task and preserve the project's DataHub and OpenAI safety boundaries." Do not edit files. Report the repository-specific workflow instructions you loaded, the exact authority files you must read, and the first execution gate using the exact label APPROVAL_GATE.
'@

$JsonLines = @(
  npx --offline --yes @openai/codex@0.145.0 exec `
    --ephemeral `
    --sandbox read-only `
    -C $Worktree `
    --json `
    $Prompt
)
if ($LASTEXITCODE -ne 0) {
  throw "Fresh Codex RED scenario failed to run."
}

$Events = @($JsonLines | ForEach-Object { $_ | ConvertFrom-Json })
$ReadCommands = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "command_execution"
    } |
    ForEach-Object { [string]$_.item.command }
) -join "`n"
$AgentText = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "agent_message"
    } |
    Select-Object -Last 1
).item.text
$AgentText

if ($ReadCommands -notmatch "implement-lineageguard-approved-plan[\\/]+SKILL\.md") {
  throw "RED: the implementation request did not load the required repository SKILL.md."
}
foreach ($Required in @(
  "PROJECT_BRIEF.md",
  "docs/specs/002-nextjs-openai-agent-demo/spec.md",
  "docs/specs/002-nextjs-openai-agent-demo/plan.md",
  "APPROVAL_GATE"
)) {
  if ($AgentText -notmatch [regex]::Escape($Required)) {
    throw "RED: implementation response omitted $Required."
  }
}
```

Expected RED:

- `.agents/skills/implement-lineageguard-approved-plan/SKILL.md` does not exist;
- the future-contract assertion throws because that exact `SKILL.md` was not loaded;
- repository-specific implementation routing depends only on manually rediscovering `AGENTS.md`, the specification, and the plan.

The command uses the read-only sandbox and must leave `git status --short` unchanged.

- [ ] **Step 2: Write the failing repository-skill contract**

Create `tests/repository-skills.test.ts`:

```ts
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const skillsRoot = join(repositoryRoot, ".agents", "skills");

interface SkillExpectation {
  readonly name: string;
  readonly descriptionFragments: readonly string[];
  readonly displayName: string;
  readonly shortDescription: string;
  readonly defaultPrompt: string;
  readonly routeFragment: string;
  readonly authorityFragments: readonly string[];
  readonly requiredMethodFragments: readonly string[];
}

const expectedSkills: readonly SkillExpectation[] = [
  {
    name: "implement-lineageguard-approved-plan",
    descriptionFragments: [
      "approved LineageGuard AI specification and plan",
      "Use when",
      "implement or continue",
      "committed DataHub fixtures",
    ],
    displayName: "Implement LineageGuard Approved Plan",
    shortDescription: "Execute approved LineageGuard plan tasks",
    defaultPrompt:
      "Use $implement-lineageguard-approved-plan to execute the next approved plan task safely.",
    routeFragment: "Approved product-plan implementation, fix, refactor, or code review",
    authorityFragments: [
      "PROJECT_BRIEF.md",
      "docs/specs/002-nextjs-openai-agent-demo/spec.md",
      "docs/specs/002-nextjs-openai-agent-demo/plan.md",
      "Task 1A",
    ],
    requiredMethodFragments: [
      "superpowers:test-driven-development",
      "superpowers:verification-before-completion",
    ],
  },
];

const authorityPaths = [
  "PROJECT_BRIEF.md",
  "docs/specs/002-nextjs-openai-agent-demo/spec.md",
  "docs/specs/002-nextjs-openai-agent-demo/plan.md",
] as const;

function parseFrontmatter(markdown: string): ReadonlyMap<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  if (match === null) {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }
  const frontmatter = match[1];
  if (frontmatter === undefined) {
    throw new Error("SKILL.md frontmatter is missing.");
  }

  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/u).filter(Boolean)) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return fields;
}

describe("repository Codex skills", () => {
  it("keeps every authority file and required plan task available", async () => {
    await Promise.all(authorityPaths.map((path) => access(join(repositoryRoot, path))));

    const plan = await readFile(
      join(repositoryRoot, "docs", "specs", "002-nextjs-openai-agent-demo", "plan.md"),
      "utf8",
    );

    expect(plan).toContain(
      "### Task 1A: Harden the Pinned DataHub MCP Boundary and Add Context Enrichment",
    );
    expect(plan).toContain(
      "### Task 14: Add the Live Smoke Test, Golden Examples, and Demo Documentation",
    );
    expect(plan).toContain(
      "### Task 14A: Ship the Hackathon Submission Pack and Read-Only DataHub Skill Candidate",
    );
  });

  it("contains exactly the expected valid skill packages", async () => {
    const skillDirectories = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(skillDirectories).toEqual(expectedSkills.map(({ name }) => name).sort());

    const discoveredNames: string[] = [];

    for (const expected of expectedSkills) {
      const skillDirectory = join(skillsRoot, expected.name);
      const skillEntries = (await readdir(skillDirectory)).sort();
      expect(skillEntries).toEqual(["SKILL.md", "agents"].sort());
      expect(await readdir(join(skillDirectory, "agents"))).toEqual(["openai.yaml"]);

      const skillMarkdown = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
      const frontmatter = parseFrontmatter(skillMarkdown);

      expect([...frontmatter.keys()].sort()).toEqual(["description", "name"]);
      expect(frontmatter.get("name")).toBe(expected.name);
      discoveredNames.push(frontmatter.get("name") ?? "");

      const description = frontmatter.get("description");
      expect(description).toBeDefined();
      for (const fragment of expected.descriptionFragments) {
        expect(description).toContain(fragment);
      }
      expect(description).not.toMatch(/[<>]/u);
      expect(description?.length).toBeLessThanOrEqual(1024);
      expect(skillMarkdown).not.toContain("Structuring This Skill");
      expect(skillMarkdown).not.toMatch(/\[(?:TO)(?:DO)/u);

      for (const fragment of expected.authorityFragments) {
        expect(skillMarkdown).toContain(fragment);
      }
      for (const fragment of expected.requiredMethodFragments) {
        expect(skillMarkdown).toContain(fragment);
      }

      const openAiYaml = await readFile(join(skillDirectory, "agents", "openai.yaml"), "utf8");
      expect(openAiYaml.replace(/\r\n/gu, "\n")).toBe(
        [
          "interface:",
          `  display_name: "${expected.displayName}"`,
          `  short_description: "${expected.shortDescription}"`,
          `  default_prompt: "${expected.defaultPrompt}"`,
          "",
          "policy:",
          "  allow_implicit_invocation: true",
          "",
        ].join("\n"),
      );
    }

    expect(new Set(discoveredNames).size).toBe(discoveredNames.length);
  });

  it("routes every expected workflow from root AGENTS.md", async () => {
    const instructions = await readFile(join(repositoryRoot, "AGENTS.md"), "utf8");

    for (const expected of expectedSkills) {
      expect(instructions).toContain(`$${expected.name}`);
      expect(instructions).toContain(expected.routeFragment);
    }

    expect(instructions).toContain(
      "Repository-skill authoring under `.agents/skills` and execution of `docs/superpowers/plans/2026-07-23-repository-codex-skills.md` do not invoke `$implement-lineageguard-approved-plan`",
    );
  });
});
```

- [ ] **Step 3: Run the static RED test**

Run:

```powershell
pnpm vitest run tests/repository-skills.test.ts
```

Expected: FAIL in `contains exactly the expected valid skill packages` because `.agents/skills` does not exist.

- [ ] **Step 4: Scaffold the skill with the installed initializer**

Run:

```powershell
$WorkspacePython = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$InitSkill = Join-Path $env:CODEX_HOME "skills\.system\skill-creator\scripts\init_skill.py"

uv run --offline --python $WorkspacePython --with "PyYAML==6.0.3" python `
  $InitSkill `
  "implement-lineageguard-approved-plan" `
  --path ".agents\skills" `
  --interface 'display_name=Implement LineageGuard Approved Plan' `
  --interface 'short_description=Execute approved LineageGuard plan tasks' `
  --interface 'default_prompt=Use $implement-lineageguard-approved-plan to execute the next approved plan task safely.'
```

Expected:

```text
[OK] Created SKILL.md
[OK] Created agents/openai.yaml
[OK] Skill 'implement-lineageguard-approved-plan' initialized successfully
```

- [ ] **Step 5: Replace the generated template with the minimal implementation workflow**

Replace `.agents/skills/implement-lineageguard-approved-plan/SKILL.md` with:

```markdown
---
name: implement-lineageguard-approved-plan
description: Executes product code, test, configuration, documentation, refactor, fix, and review work governed by the approved LineageGuard AI specification and plan. Use when a request asks to implement or continue an approved product task, change product behavior under specification 002, update committed DataHub fixtures, or review those changes.
---

# Implement LineageGuard Approved Plan

## Purpose

Execute one approved LineageGuard plan task without expanding product authority. This skill supplies repository-specific routing and guardrails; installed engineering skills supply the general development method.

## Authority

Before changing repository content, read:

1. `PROJECT_BRIEF.md`;
2. `docs/specs/002-nextjs-openai-agent-demo/spec.md`;
3. `docs/specs/002-nextjs-openai-agent-demo/plan.md`; and
4. the complete current task section, including its interfaces, tests, commands, and commit boundary.

Inspect the current branch, worktree status, and overlapping user changes. Stop at the design or planning gate if the specification or requested task is missing, superseded, or not approved.

## Required Method

Use the installed skills when their triggers apply:

- `superpowers:brainstorming` for behavior outside the approved design;
- `superpowers:subagent-driven-development` or `superpowers:executing-plans` for plan execution;
- `superpowers:test-driven-development` before implementation;
- `superpowers:systematic-debugging` for any failure or unexpected behavior;
- `superpowers:verification-before-completion` before a completion claim; and
- `superpowers:requesting-code-review` at the task's review gate.

Do not copy those skills into this file.

## Non-Negotiable Boundaries

- Keep one TypeScript `pnpm` package.
- Support only `rename_column`.
- Allow only `search`, `list_schema_fields`, `get_lineage`, and `get_entities` inside the DataHub adapter.
- Expose only `analyze_rename_change` and `generate_migration_package` to the OpenAI agent.
- Keep risk, completeness, context coverage, identifiers, rendering, validation, persistence, and safety deterministic.
- Keep DataHub read-only and require human approval for migration decisions.
- Label fixture runs `REPLAY`; never represent replay as live DataHub or OpenAI evidence.
- Keep repository content in English.

## Workflow

1. Identify the exact approved plan task and its allowed files.
2. Reproduce the requested behavior or write the task's failing test.
3. Implement the smallest change that makes the focused test pass.
4. Refactor only while the focused and surrounding tests remain green.
5. Run the task's exact verification commands and inspect the diff.
6. Commit only the reviewed task scope and stop at the next approval gate.

Committed DataHub fixtures are a stop condition until `$verify-lineageguard-live-demo` is installed and validated. Do not capture or update them in this task. Any later fixture write must read Task 1A and enforce its strict replay schemas, canonical ordering, create-only writes, and prohibition on email or profile data, descriptions over 2,000 characters, related documents, raw SQL, tokens, and MCP diagnostics.

## Do Not Use

Do not use this skill for explanation-only repository discovery, verify-only live diagnosis, submission-only copy, external publication, or work in another repository.

Do not use this skill to author or validate files under `.agents/skills` or to execute `docs/superpowers/plans/2026-07-23-repository-codex-skills.md`; those tasks are governed by `skill-creator`, `superpowers:writing-skills`, and `superpowers:writing-plans`.

## Stop Conditions

Stop and report the blocker when work requires an unapproved scope change, a DataHub mutation, another agent tool, a second runtime stack, destructive recovery, external publication, or overwriting unrelated user changes.
```

Replace `.agents/skills/implement-lineageguard-approved-plan/agents/openai.yaml` with:

```yaml
interface:
  display_name: "Implement LineageGuard Approved Plan"
  short_description: "Execute approved LineageGuard plan tasks"
  default_prompt: "Use $implement-lineageguard-approved-plan to execute the next approved plan task safely."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 6: Add the first mandatory route to root instructions**

Append this section to `AGENTS.md`:

```markdown
### Repository workflow skills

Use every applicable repository workflow skill.

| Request type                                                        | Required repository skill               |
| ------------------------------------------------------------------- | --------------------------------------- |
| Approved product-plan implementation, fix, refactor, or code review | `$implement-lineageguard-approved-plan` |

Repository-skill authoring under `.agents/skills` and execution of `docs/superpowers/plans/2026-07-23-repository-codex-skills.md` do not invoke `$implement-lineageguard-approved-plan`; use `skill-creator`, `superpowers:writing-skills`, and `superpowers:writing-plans`.
```

- [ ] **Step 7: Run structural validation and GREEN tests**

Run:

```powershell
$WorkspacePython = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$QuickValidate = Join-Path $env:CODEX_HOME "skills\.system\skill-creator\scripts\quick_validate.py"

uv run --offline --python $WorkspacePython --with "PyYAML==6.0.3" python `
  $QuickValidate `
  ".agents\skills\implement-lineageguard-approved-plan"

pnpm vitest run tests/repository-skills.test.ts
```

Expected:

```text
Skill is valid!
Test Files  1 passed (1)
Tests  3 passed (3)
```

- [ ] **Step 8: Run the positive and negative forward tests**

Run two approved, fresh, ephemeral, read-only Codex sessions from the feature worktree:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$PositivePrompt = @'
You are working in the LineageGuard AI repository. The user says: "Continue the next approved implementation task and preserve the project's DataHub and OpenAI safety boundaries." Do not edit files. Report the repository-specific workflow instructions you loaded, the exact authority files you must read, and the first execution gate using the exact label APPROVAL_GATE.
'@
$NegativePrompt = @'
Review docs/superpowers/plans/2026-07-23-repository-codex-skills.md for the next repository-skill authoring task. Do not edit files. Report the applicable authoring skills.
'@

function Invoke-FreshReadOnlyCodex([string]$Prompt) {
  $Lines = @(
      npx --offline --yes @openai/codex@0.145.0 exec `
        --ephemeral `
        --sandbox read-only `
        -C $Worktree `
        --json `
        $Prompt
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Fresh Codex routing scenario failed."
  }
  return @($Lines | ForEach-Object { $_ | ConvertFrom-Json })
}

function Get-CommandTranscript([object[]]$Events) {
  return (
    $Events |
      Where-Object {
        $_.type -eq "item.completed" -and
        $_.item.type -eq "command_execution"
      } |
      ForEach-Object { [string]$_.item.command }
  ) -join "`n"
}

function Get-AgentText([object[]]$Events) {
  return [string](
    $Events |
      Where-Object {
        $_.type -eq "item.completed" -and
        $_.item.type -eq "agent_message"
      } |
      Select-Object -Last 1
  ).item.text
}

$PositiveEvents = Invoke-FreshReadOnlyCodex $PositivePrompt
$PositiveCommands = Get-CommandTranscript $PositiveEvents
$PositiveText = Get-AgentText $PositiveEvents
if ($PositiveCommands -notmatch "implement-lineageguard-approved-plan[\\/]+SKILL\.md") {
  throw "Positive scenario did not read the implementation skill."
}
foreach ($Required in @(
  "PROJECT_BRIEF.md",
  "docs/specs/002-nextjs-openai-agent-demo/spec.md",
  "docs/specs/002-nextjs-openai-agent-demo/plan.md",
  "APPROVAL_GATE"
)) {
  if ($PositiveText -notmatch [regex]::Escape($Required)) {
    throw "Implementation response omitted: $Required"
  }
}

$NegativeEvents = Invoke-FreshReadOnlyCodex $NegativePrompt
$NegativeCommands = Get-CommandTranscript $NegativeEvents
$NegativeText = Get-AgentText $NegativeEvents
if ($NegativeCommands -match "implement-lineageguard-approved-plan[\\/]+SKILL\.md") {
  throw "Negative scenario unexpectedly read the implementation skill."
}
foreach ($Required in @("skill-creator", "superpowers:writing-skills")) {
  if ($NegativeText -notmatch [regex]::Escape($Required)) {
    throw "Repository-skill authoring response omitted: $Required"
  }
}
```

Expected: the positive session reads the exact implementation `SKILL.md`, names all three authority files and the `APPROVAL_GATE` in its final response, and stops before changing code. The repository-skill authoring negative session does not read the implementation skill and routes to `skill-creator` plus `superpowers:writing-skills`.

If either result differs, do not commit. Report whether the mismatch is a missing positive read or an unexpected negative read, include only the sanitized command path and final agent message, and stop for a reviewed plan amendment.

- [ ] **Step 9: Run the implementation-skill REFACTOR gate**

Re-read the positive and negative final messages, then inspect the implementation skill's description, body, and root route for overlap, ambiguity, duplication, or a loophole around product authority and repository-skill authoring.

If a correction is needed:

1. add or strengthen the smallest static or behavioral assertion that exposes the ambiguity and observe it fail;
2. make the smallest wording-only correction without broadening the approved trigger or product scope;
3. rerun Task 1 Step 7; and
4. rerun the complete Task 1 Step 8 behavioral block.

If no correction is needed, record that the existing wording passed the REFACTOR inspection. Do not commit until structural and behavioral checks are green after this gate.

Request a focused read-only review of the implementation skill, its contract object, and its root route. Resolve every blocking finding with a failing assertion first, then rerun Steps 7 and 8. Proceed only when the review has no blockers.

- [ ] **Step 10: Format, inspect, and commit Task 1**

Run:

```powershell
& ".\node_modules\.bin\prettier.cmd" --write `
  "AGENTS.md" `
  "tests/repository-skills.test.ts" `
  ".agents/skills/implement-lineageguard-approved-plan/SKILL.md" `
  ".agents/skills/implement-lineageguard-approved-plan/agents/openai.yaml"

pnpm vitest run tests/repository-skills.test.ts
pnpm lint
pnpm typecheck
git diff --check
git status --short
```

Expected: focused tests, lint, and typecheck pass; only the four Task 1 paths are changed.

Commit:

```powershell
git add `
  AGENTS.md `
  tests/repository-skills.test.ts `
  .agents/skills/implement-lineageguard-approved-plan
git commit -m "chore: add approved-plan repository skill"
```

---

### Task 2: Add the Safe Live-Demo Verification Skill

**Files:**

- Modify: `tests/repository-skills.test.ts`
- Modify: `AGENTS.md`
- Modify: `.agents/skills/implement-lineageguard-approved-plan/SKILL.md`
- Create: `.agents/skills/verify-lineageguard-live-demo/SKILL.md`
- Create: `.agents/skills/verify-lineageguard-live-demo/agents/openai.yaml`

**Interfaces:**

- Consumes: Task 14 live preflight, Task 1A fixture-sanitization boundary, the implementation skill's compound handoff, and shell-local live configuration.
- Produces: one implicitly invocable verify-only workflow that establishes current evidence without modifying repository content plus the finalized `verify → implement` committed-fixture handoff.

- [ ] **Step 1: Record the live-verification pressure-scenario RED baseline**

Run an approved, fresh, ephemeral, read-only Codex session:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$Prompt = @'
Prepare the LineageGuard AI live demo. Check DataHub, the pinned MCP subprocess, and OpenAI in the safe order. Do not edit files or run destructive recovery. Report the gates in order using the exact labels DATAHUB_GATE, MCP_GATE, and OPENAI_GATE, and state the exact fallback label REPLAY.
'@

$JsonLines = @(
  npx --offline --yes @openai/codex@0.145.0 exec `
    --ephemeral `
    --sandbox read-only `
    -C $Worktree `
    --json `
    $Prompt
)
if ($LASTEXITCODE -ne 0) {
  throw "Fresh Codex live RED scenario failed to run."
}

$Events = @($JsonLines | ForEach-Object { $_ | ConvertFrom-Json })
$ReadCommands = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "command_execution"
    } |
    ForEach-Object { [string]$_.item.command }
) -join "`n"
$AgentText = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "agent_message"
    } |
    Select-Object -Last 1
).item.text
$AgentText

if ($ReadCommands -notmatch "verify-lineageguard-live-demo[\\/]+SKILL\.md") {
  throw "RED: the live request did not load the required repository SKILL.md."
}
$PreviousPosition = -1
foreach ($Required in @("DATAHUB_GATE", "MCP_GATE", "OPENAI_GATE")) {
  $Position = $AgentText.IndexOf($Required)
  if ($Position -le $PreviousPosition) {
    throw "RED: live response omitted or misordered $Required."
  }
  $PreviousPosition = $Position
}
if ($AgentText -notmatch [regex]::Escape("REPLAY")) {
  throw "RED: live response omitted the REPLAY fallback."
}
```

Expected RED:

- `.agents/skills/verify-lineageguard-live-demo/SKILL.md` does not exist;
- the future-contract assertion throws because that exact `SKILL.md` was not loaded;
- no repository skill yet enforces DataHub/MCP-before-OpenAI order or verify-only no-write behavior.

- [ ] **Step 2: Extend the contract with the missing live skill**

Add this object after the existing object in `expectedSkills`:

```ts
  {
    name: "verify-lineageguard-live-demo",
    descriptionFragments: [
      "safe LineageGuard AI live demo",
      "Use when",
      "DataHub",
      "transient fixture-source inspection",
    ],
    displayName: "Verify LineageGuard Live Demo",
    shortDescription: "Verify the safe LineageGuard live demo",
    defaultPrompt:
      "Use $verify-lineageguard-live-demo to verify the safe local live-demo path.",
    routeFragment:
      "DataHub/MCP/OpenAI live setup, diagnosis, transient inspection, or live evidence",
    authorityFragments: [
      "docs/specs/002-nextjs-openai-agent-demo/plan.md",
      "Task 14",
      "Task 1A",
    ],
    requiredMethodFragments: [
      "superpowers:systematic-debugging",
      "openai-developers:openai-api-troubleshooting",
      "superpowers:verification-before-completion",
    ],
  },
```

- [ ] **Step 3: Run the live-skill RED test**

Run:

```powershell
pnpm vitest run tests/repository-skills.test.ts
```

Expected: FAIL because the expected `verify-lineageguard-live-demo` directory is absent.

- [ ] **Step 4: Scaffold the live skill**

Run:

```powershell
$WorkspacePython = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$InitSkill = Join-Path $env:CODEX_HOME "skills\.system\skill-creator\scripts\init_skill.py"

uv run --offline --python $WorkspacePython --with "PyYAML==6.0.3" python `
  $InitSkill `
  "verify-lineageguard-live-demo" `
  --path ".agents\skills" `
  --interface 'display_name=Verify LineageGuard Live Demo' `
  --interface 'short_description=Verify the safe LineageGuard live demo' `
  --interface 'default_prompt=Use $verify-lineageguard-live-demo to verify the safe local live-demo path.'
```

Expected: the initializer creates `SKILL.md` and `agents/openai.yaml` without resource directories.

- [ ] **Step 5: Replace the template with the safe live workflow**

Replace `.agents/skills/verify-lineageguard-live-demo/SKILL.md` with:

```markdown
---
name: verify-lineageguard-live-demo
description: Verifies and diagnoses the safe LineageGuard AI live demo without changing repository content. Use when a request concerns local DataHub, GMS, the pinned MCP subprocess, PATs, ports, Docker resources, uvx, live OpenAI, current live evidence, or transient fixture-source inspection.
---

# Verify LineageGuard Live Demo

## Purpose

Establish whether the local DataHub and OpenAI path may truthfully be described as `LIVE`. Keep diagnosis read-only with respect to repository content and preserve deterministic replay whenever a live dependency is unavailable.

## Authority

Read Task 14 in `docs/specs/002-nextjs-openai-agent-demo/plan.md` before acting. Read the repository's operator and live-verification documentation when those files exist.

If the request creates or updates committed fixtures, this skill only verifies the live source. Hand the repository write to `$implement-lineageguard-approved-plan`, which must read Task 1A and enforce the fixture sanitizer and strict replay schemas.

## Required Method

Use `superpowers:systematic-debugging` for any failed gate or unexpected behavior, `openai-developers:openai-api-troubleshooting` for an OpenAI API failure, and `superpowers:verification-before-completion` before making a live-readiness claim. Do not copy those general workflows into this file.

## Safe Order

Complete these gates in order:

1. verify pinned Python, DataHub CLI, DataHub Core, MCP Server, Node.js, and project versions;
2. verify Docker resources and the certified local ports;
3. run the pinned `datahub docker check`;
4. verify GMS health;
5. inspect the DataHub UI for the golden asset, schema, lineage, and ownership;
6. resolve the absolute pinned `uvx` executable;
7. run the four-operation read-only MCP integration contract; and
8. run live OpenAI verification only after every prior required gate passes.

The allowed DataHub operations are `search`, `list_schema_fields`, `get_lineage`, and `get_entities`. Capability annotations are evidence, not authorization.

## Secret and Evidence Rules

- Keep `DATAHUB_GMS_TOKEN` and `OPENAI_API_KEY` shell-local.
- Never print, persist, commit, screenshot, or copy secret values into task output.
- Sanitize live evidence and bind committed evidence to the tested commit.
- Treat stale screenshots, configuration, replay data, or a successful login as insufficient proof of a current live run.
- Use `LIVE` only for current DataHub and OpenAI evidence; otherwise report `REPLAY` or the unavailable gate.

## Read-Only Boundary

Do not modify repository files during verify-only diagnosis. Do not enable mutations, expose unrestricted MCP tools, bypass DataHub authorization, disable authentication, or execute SQL.

Do not run `datahub docker nuke`, Docker pruning, database repair, index repair, publication, or another external-state change without explicit user authorization.

## Failure Behavior

Stop before OpenAI when any required DataHub or MCP gate fails. Report the exact failed gate, preserve sanitized diagnostics, and keep deterministic replay available. Never weaken a gate merely to recover the expected demo result.

## Do Not Use

Do not use this skill for ordinary offline tests, replay-only feature development, production hosting, SSO, ingestion, mutation enablement, submission-only prose, or unrelated repositories.
```

Replace `.agents/skills/verify-lineageguard-live-demo/agents/openai.yaml` with:

```yaml
interface:
  display_name: "Verify LineageGuard Live Demo"
  short_description: "Verify the safe LineageGuard live demo"
  default_prompt: "Use $verify-lineageguard-live-demo to verify the safe local live-demo path."

policy:
  allow_implicit_invocation: true
```

In `.agents/skills/implement-lineageguard-approved-plan/SKILL.md`, replace the temporary committed-fixture stop paragraph with:

```markdown
For committed DataHub fixture creation or updates, first use `$verify-lineageguard-live-demo` to establish the live source. Then read Task 1A and enforce its strict replay schemas, canonical ordering, create-only writes, and prohibition on email or profile data, descriptions over 2,000 characters, related documents, raw SQL, tokens, and MCP diagnostics.
```

- [ ] **Step 6: Add the live route**

Replace the repository workflow table in `AGENTS.md` with:

```markdown
| Request type                                                                     | Required repository skill               |
| -------------------------------------------------------------------------------- | --------------------------------------- |
| Approved product-plan implementation, fix, refactor, or code review              | `$implement-lineageguard-approved-plan` |
| DataHub/MCP/OpenAI live setup, diagnosis, transient inspection, or live evidence | `$verify-lineageguard-live-demo`        |
```

- [ ] **Step 7: Validate the live skill and run GREEN tests**

Run:

```powershell
$WorkspacePython = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$QuickValidate = Join-Path $env:CODEX_HOME "skills\.system\skill-creator\scripts\quick_validate.py"

uv run --offline --python $WorkspacePython --with "PyYAML==6.0.3" python `
  $QuickValidate `
  ".agents\skills\verify-lineageguard-live-demo"

pnpm vitest run tests/repository-skills.test.ts
```

Expected: `Skill is valid!` and all three repository-skill tests pass.

- [ ] **Step 8: Run live, negative, and committed-fixture forward tests**

Run three approved, fresh, ephemeral, read-only Codex sessions:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$PositivePrompt = @'
Prepare the LineageGuard AI live demo. Check DataHub, the pinned MCP subprocess, and OpenAI in the safe order. Do not edit files or run destructive recovery. Report the gates in order using the exact labels DATAHUB_GATE, MCP_GATE, and OPENAI_GATE, and state the exact fallback label REPLAY.
'@
$NegativePrompt = @'
Run the ordinary offline unit tests for the LineageGuard impact formula. Do not use Docker, DataHub, MCP, OpenAI, or live credentials. Report only the test command you would use.
'@
$FixturePrompt = @'
The user wants to capture current local DataHub metadata and update the five committed LineageGuard replay fixtures. Do not run project commands or edit files. Report the repository skills in required order, the exact plan tasks each reads, and the forbidden fields. Use the exact terms Task 14, Task 1A, email, profile, descriptions over 2,000 characters, related documents, raw SQL, tokens, and MCP diagnostics.
'@

function Invoke-FreshReadOnlyCodex([string]$Prompt) {
  $Lines = @(
    npx --offline --yes @openai/codex@0.145.0 exec `
      --ephemeral `
      --sandbox read-only `
      -C $Worktree `
      --json `
      $Prompt
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Fresh Codex routing scenario failed."
  }
  return @($Lines | ForEach-Object { $_ | ConvertFrom-Json })
}

function Get-CommandTranscript([object[]]$Events) {
  return (
    $Events |
      Where-Object {
        $_.type -eq "item.completed" -and
        $_.item.type -eq "command_execution"
      } |
      ForEach-Object { [string]$_.item.command }
  ) -join "`n"
}

function Get-AgentText([object[]]$Events) {
  return [string](
    $Events |
      Where-Object {
        $_.type -eq "item.completed" -and
        $_.item.type -eq "agent_message"
      } |
      Select-Object -Last 1
  ).item.text
}

$Before = git -C $Worktree status --porcelain=v1

$PositiveEvents = Invoke-FreshReadOnlyCodex $PositivePrompt
$PositiveCommands = Get-CommandTranscript $PositiveEvents
$PositiveText = Get-AgentText $PositiveEvents
if ($PositiveCommands -notmatch "verify-lineageguard-live-demo[\\/]+SKILL\.md") {
  throw "Positive scenario did not read the live skill."
}

$PreviousPosition = -1
foreach ($Required in @("DATAHUB_GATE", "MCP_GATE", "OPENAI_GATE")) {
  $Position = $PositiveText.IndexOf($Required)
  if ($Position -le $PreviousPosition) {
    throw "Live response omitted or misordered: $Required"
  }
  $PreviousPosition = $Position
}
if ($PositiveText -notmatch [regex]::Escape("REPLAY")) {
  throw "Live response omitted the REPLAY fallback."
}

$NegativeEvents = Invoke-FreshReadOnlyCodex $NegativePrompt
$NegativeCommands = Get-CommandTranscript $NegativeEvents
if ($NegativeCommands -match "verify-lineageguard-live-demo[\\/]+SKILL\.md") {
  throw "Negative scenario unexpectedly read the live skill."
}

$FixtureEvents = Invoke-FreshReadOnlyCodex $FixturePrompt
$FixtureCommands = Get-CommandTranscript $FixtureEvents
$FixtureText = Get-AgentText $FixtureEvents
$VerifyRead = [regex]::Match(
  $FixtureCommands,
  "verify-lineageguard-live-demo[\\/]+SKILL\.md"
)
$ImplementRead = [regex]::Match(
  $FixtureCommands,
  "implement-lineageguard-approved-plan[\\/]+SKILL\.md"
)
if (
  -not $VerifyRead.Success -or
  -not $ImplementRead.Success -or
  $ImplementRead.Index -le $VerifyRead.Index
) {
  throw "Fixture routing did not read verify before implement."
}
foreach ($Required in @(
  "Task 14",
  "Task 1A",
  "email",
  "profile",
  "descriptions over 2,000 characters",
  "related documents",
  "raw SQL",
  "tokens",
  "MCP diagnostics"
)) {
  if ($FixtureText -notmatch [regex]::Escape($Required)) {
    throw "Fixture-routing response omitted: $Required"
  }
}

$After = git -C $Worktree status --porcelain=v1
if (($Before -join "`n") -ne ($After -join "`n")) {
  throw "Read-only live routing tests changed repository content."
}
```

Expected: the positive session reads the exact live `SKILL.md`, reports `DATAHUB_GATE → MCP_GATE → OPENAI_GATE`, preserves the `REPLAY` fallback, and makes no repository change. The negative session does not read the live skill. The fixture session reads verify before implement, maps the live source check to Task 14 and the committed write to Task 1A, and rejects every forbidden field including overlong descriptions and related documents.

Expected status comparison: identical output.

- [ ] **Step 9: Run the live-skill REFACTOR gate**

Re-read all three Task 2 final messages, then inspect the live skill's description, body, root route, and implementation-skill handoff for overlap, ambiguity, duplication, or a loophole around safe gate order, replay, verify-only writes, or fixture sanitization.

If a correction is needed:

1. add or strengthen the smallest static or behavioral assertion that exposes the ambiguity and observe it fail;
2. make the smallest wording-only correction without broadening live authority or enabling mutation;
3. rerun Task 2 Step 7; and
4. rerun the complete Task 2 Step 8 behavioral block.

If no correction is needed, record that the existing wording passed the REFACTOR inspection. Do not commit until structural and behavioral checks are green after this gate.

Request a focused read-only review of the live skill, its contract object, its fixture handoff, and its root route. Resolve every blocking finding with a failing assertion first, then rerun Steps 7 and 8. Proceed only when the review has no blockers.

- [ ] **Step 10: Format, inspect, and commit Task 2**

Run:

```powershell
& ".\node_modules\.bin\prettier.cmd" --write `
  "AGENTS.md" `
  "tests/repository-skills.test.ts" `
  ".agents/skills/implement-lineageguard-approved-plan/SKILL.md" `
  ".agents/skills/verify-lineageguard-live-demo/SKILL.md" `
  ".agents/skills/verify-lineageguard-live-demo/agents/openai.yaml"

pnpm vitest run tests/repository-skills.test.ts
pnpm lint
pnpm typecheck
git diff --check
git status --short
```

Expected: checks pass and only the five Task 2 paths are changed.

Commit:

```powershell
git add `
  AGENTS.md `
  tests/repository-skills.test.ts `
  .agents/skills/implement-lineageguard-approved-plan/SKILL.md `
  .agents/skills/verify-lineageguard-live-demo
git commit -m "chore: add live-demo verification skill"
```

---

### Task 3: Add the Evidence-Backed Submission Skill

**Files:**

- Modify: `tests/repository-skills.test.ts`
- Modify: `AGENTS.md`
- Create: `.agents/skills/prepare-lineageguard-submission/SKILL.md`
- Create: `.agents/skills/prepare-lineageguard-submission/agents/openai.yaml`

**Interfaces:**

- Consumes: Task 14A, completed offline-demo evidence, current live-verification evidence when available, submission validators when implemented, and authoritative hackathon sources.
- Produces: one implicitly invocable submission workflow that separates facts from claims and preserves explicit authorization for publication.

- [ ] **Step 1: Record the submission pressure-scenario RED baseline**

Run an approved, fresh, ephemeral, read-only Codex session:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$Prompt = @'
Prepare LineageGuard AI for its final Devpost review. Check the submission-facing README, judging evidence, attribution, demo video, repository safety, and truthfulness. Do not publish or submit anything. Report every gate that can remain unpassed using the exact labels UNAVAILABLE, LIVE, REPLAY, and USER_APPROVAL_REQUIRED.
'@

$JsonLines = @(
  npx --offline --yes @openai/codex@0.145.0 exec `
    --ephemeral `
    --sandbox read-only `
    -C $Worktree `
    --json `
    $Prompt
)
if ($LASTEXITCODE -ne 0) {
  throw "Fresh Codex submission RED scenario failed to run."
}

$Events = @($JsonLines | ForEach-Object { $_ | ConvertFrom-Json })
$ReadCommands = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "command_execution"
    } |
    ForEach-Object { [string]$_.item.command }
) -join "`n"
$AgentText = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "agent_message"
    } |
    Select-Object -Last 1
).item.text
$AgentText

if ($ReadCommands -notmatch "prepare-lineageguard-submission[\\/]+SKILL\.md") {
  throw "RED: the submission request did not load the required repository SKILL.md."
}
foreach ($Required in @(
  "UNAVAILABLE",
  "LIVE",
  "REPLAY",
  "USER_APPROVAL_REQUIRED"
)) {
  if ($AgentText -notmatch [regex]::Escape($Required)) {
    throw "RED: submission response omitted $Required."
  }
}
```

Expected RED:

- `.agents/skills/prepare-lineageguard-submission/SKILL.md` does not exist;
- the future-contract assertion throws because that exact `SKILL.md` was not loaded;
- a missing planned validator may be mistaken for a passed gate.

- [ ] **Step 2: Extend the contract with the missing submission skill**

Add this object after the live-skill object in `expectedSkills`:

```ts
  {
    name: "prepare-lineageguard-submission",
    descriptionFragments: [
      "evidence-backed LineageGuard AI hackathon submission",
      "Use when",
      "submission-facing README",
      "Devpost",
    ],
    displayName: "Prepare LineageGuard Submission",
    shortDescription: "Prepare evidence-backed hackathon submission",
    defaultPrompt:
      "Use $prepare-lineageguard-submission to prepare evidence-backed hackathon assets.",
    routeFragment:
      "Devpost, submission-facing README, judging, attribution, video, release, or submission readiness",
    authorityFragments: [
      "docs/specs/002-nextjs-openai-agent-demo/plan.md",
      "Task 14A",
    ],
    requiredMethodFragments: [
      "superpowers:verification-before-completion",
      "superpowers:requesting-code-review",
    ],
  },
```

- [ ] **Step 3: Run the submission-skill RED test**

Run:

```powershell
pnpm vitest run tests/repository-skills.test.ts
```

Expected: FAIL because the expected `prepare-lineageguard-submission` directory is absent.

- [ ] **Step 4: Scaffold the submission skill**

Run:

```powershell
$WorkspacePython = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$InitSkill = Join-Path $env:CODEX_HOME "skills\.system\skill-creator\scripts\init_skill.py"

uv run --offline --python $WorkspacePython --with "PyYAML==6.0.3" python `
  $InitSkill `
  "prepare-lineageguard-submission" `
  --path ".agents\skills" `
  --interface 'display_name=Prepare LineageGuard Submission' `
  --interface 'short_description=Prepare evidence-backed hackathon submission' `
  --interface 'default_prompt=Use $prepare-lineageguard-submission to prepare evidence-backed hackathon assets.'
```

Expected: the initializer creates the third skill package without resource directories.

- [ ] **Step 5: Replace the template with the evidence-backed submission workflow**

Replace `.agents/skills/prepare-lineageguard-submission/SKILL.md` with:

```markdown
---
name: prepare-lineageguard-submission
description: Prepares and audits an evidence-backed LineageGuard AI hackathon submission without publishing it. Use when a request concerns Devpost, a submission-facing README, judging evidence, attribution, demo video, sanitized sample outputs, public-repository readiness, release readiness, or final LIVE and REPLAY claim checks.
---

# Prepare LineageGuard Submission

## Purpose

Prepare a truthful, judge-ready submission package whose material claims map to repository evidence. This skill does not authorize product changes, publication, submission, community posts, releases, or upstream pull requests.

## Authority

Read Task 14A in `docs/specs/002-nextjs-openai-agent-demo/plan.md` before acting. Read the current hackathon rules, terms, judging criteria, submission checklist, attribution inventory, judging map, live-verification record, and example-output documentation when those repository files exist.

Use current primary sources for deadlines, eligibility, required fields, judging criteria, video rules, licensing, and challenge categories whenever those facts may have changed.

## Required Method

Use `superpowers:verification-before-completion` before a readiness claim and `superpowers:requesting-code-review` for the final package review. Use GitHub publication skills only after explicit user authorization. Do not copy those general workflows into this file.

## Preconditions

- Require the approved offline browser-demo gate before describing the package as ready.
- Use current live evidence only when making a `LIVE` claim.
- Keep replay usable and label it `REPLAY`.
- Treat a missing planned document, validator, scan, recording, URL, or live check as an unpassed gate.

## Workflow

1. Inventory every required submission artifact and current gate.
2. Map every material claim to a file, test, sanitized output, current live record, or authoritative source.
3. Separate implemented behavior, verified live behavior, deterministic replay, planned work, and unavailable evidence.
4. Run the repository submission validator and working-tree and history secret scans when those scripts exist.
5. Verify Apache-2.0 licensing, dataset provenance, external attribution, AI-tool disclosure, pre-existing-software disclosure, public repository access, video length, and immutable commit identity.
6. Verify that sample outputs are sanitized and that their `LIVE` or `REPLAY` provenance is explicit.
7. Produce a readiness report with passed, failed, unavailable, and user-approval gates.

## Truthfulness Rules

- Never claim a live DataHub or OpenAI run from fixture data, configuration, screenshots, or stale evidence.
- Never claim an accepted upstream DataHub contribution before an approved upstream pull request is merged.
- Never mark a missing validator or artifact as passed.
- Never omit limitations, incomplete evidence, Context Coverage gaps, human approval, or the read-only DataHub boundary.

## External-Action Gate

Require explicit user authorization before submitting to Devpost, publishing a video, making a repository public, creating a release, posting to Slack, contacting organizers, or opening an upstream pull request.

## Do Not Use

Do not use this skill for ordinary technical README maintenance, core feature implementation, verify-only live diagnosis, general marketing outside the approved hackathon, or unrelated repositories.
```

Replace `.agents/skills/prepare-lineageguard-submission/agents/openai.yaml` with:

```yaml
interface:
  display_name: "Prepare LineageGuard Submission"
  short_description: "Prepare evidence-backed hackathon submission"
  default_prompt: "Use $prepare-lineageguard-submission to prepare evidence-backed hackathon assets."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 6: Add the submission route**

Replace the repository workflow table in `AGENTS.md` with:

```markdown
| Request type                                                                                     | Required repository skill               |
| ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Approved product-plan implementation, fix, refactor, or code review                              | `$implement-lineageguard-approved-plan` |
| DataHub/MCP/OpenAI live setup, diagnosis, transient inspection, or live evidence                 | `$verify-lineageguard-live-demo`        |
| Devpost, submission-facing README, judging, attribution, video, release, or submission readiness | `$prepare-lineageguard-submission`      |
```

- [ ] **Step 7: Validate the submission skill and run GREEN tests**

Run:

```powershell
$WorkspacePython = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$QuickValidate = Join-Path $env:CODEX_HOME "skills\.system\skill-creator\scripts\quick_validate.py"

uv run --offline --python $WorkspacePython --with "PyYAML==6.0.3" python `
  $QuickValidate `
  ".agents\skills\prepare-lineageguard-submission"

pnpm vitest run tests/repository-skills.test.ts
```

Expected: `Skill is valid!` and all three repository-skill tests pass with exactly three discovered skill directories.

- [ ] **Step 8: Run submission positive and negative forward tests**

Run two approved, fresh, ephemeral, read-only Codex sessions:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$PositivePrompt = @'
Prepare LineageGuard AI for its final Devpost review. Check the submission-facing README, judging evidence, attribution, demo video, repository safety, and truthfulness. Do not publish or submit anything. Report every gate that can remain unpassed using the exact labels UNAVAILABLE, LIVE, REPLAY, and USER_APPROVAL_REQUIRED.
'@
$NegativePrompt = @'
Improve the technical README explanation of the internal TypeScript module boundaries. This is not hackathon copy, judging evidence, release preparation, or submission work. Do not edit files; report the applicable repository workflow only.
'@

function Invoke-FreshReadOnlyCodex([string]$Prompt) {
  $Lines = @(
      npx --offline --yes @openai/codex@0.145.0 exec `
        --ephemeral `
        --sandbox read-only `
        -C $Worktree `
        --json `
        $Prompt
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Fresh Codex routing scenario failed."
  }
  return @($Lines | ForEach-Object { $_ | ConvertFrom-Json })
}

function Get-CommandTranscript([object[]]$Events) {
  return (
    $Events |
      Where-Object {
        $_.type -eq "item.completed" -and
        $_.item.type -eq "command_execution"
      } |
      ForEach-Object { [string]$_.item.command }
  ) -join "`n"
}

function Get-AgentText([object[]]$Events) {
  return [string](
    $Events |
      Where-Object {
        $_.type -eq "item.completed" -and
        $_.item.type -eq "agent_message"
      } |
      Select-Object -Last 1
  ).item.text
}

$PositiveEvents = Invoke-FreshReadOnlyCodex $PositivePrompt
$PositiveCommands = Get-CommandTranscript $PositiveEvents
$PositiveText = Get-AgentText $PositiveEvents
if ($PositiveCommands -notmatch "prepare-lineageguard-submission[\\/]+SKILL\.md") {
  throw "Positive scenario did not read the submission skill."
}
foreach ($Required in @(
  "UNAVAILABLE",
  "LIVE",
  "REPLAY",
  "USER_APPROVAL_REQUIRED"
)) {
  if ($PositiveText -notmatch [regex]::Escape($Required)) {
    throw "Submission response omitted: $Required"
  }
}

$NegativeCommands = Get-CommandTranscript (Invoke-FreshReadOnlyCodex $NegativePrompt)
if ($NegativeCommands -match "prepare-lineageguard-submission[\\/]+SKILL\.md") {
  throw "Negative scenario unexpectedly read the submission skill."
}
```

Expected: the positive session reads the exact submission `SKILL.md` and reports `UNAVAILABLE`, `LIVE`, `REPLAY`, and `USER_APPROVAL_REQUIRED` gates. The negative session does not read the submission skill; it may read the implementation skill only if the change belongs to an approved product task.

If either result differs, do not commit. Report whether the mismatch is a missing positive read or an unexpected negative read, include only the sanitized command path and final agent message, and stop for a reviewed plan amendment.

- [ ] **Step 9: Run the submission-skill REFACTOR gate**

Re-read the positive and negative final messages, then inspect the submission skill's description, body, and root route for overlap, ambiguity, duplication, or a loophole around evidence states, missing gates, ordinary README work, or external authorization.

If a correction is needed:

1. add or strengthen the smallest static or behavioral assertion that exposes the ambiguity and observe it fail;
2. make the smallest wording-only correction without authorizing publication or broadening product scope;
3. rerun Task 3 Step 7; and
4. rerun the complete Task 3 Step 8 behavioral block.

If no correction is needed, record that the existing wording passed the REFACTOR inspection. Do not commit until structural and behavioral checks are green after this gate.

Request a focused read-only review of the submission skill, its contract object, and its root route. Resolve every blocking finding with a failing assertion first, then rerun Steps 7 and 8. Proceed only when the review has no blockers.

- [ ] **Step 10: Format, inspect, and commit Task 3**

Run:

```powershell
& ".\node_modules\.bin\prettier.cmd" --write `
  "AGENTS.md" `
  "tests/repository-skills.test.ts" `
  ".agents/skills/prepare-lineageguard-submission/SKILL.md" `
  ".agents/skills/prepare-lineageguard-submission/agents/openai.yaml"

pnpm vitest run tests/repository-skills.test.ts
pnpm lint
pnpm typecheck
git diff --check
git status --short
```

Expected: checks pass and only the four Task 3 paths are changed.

Commit:

```powershell
git add `
  AGENTS.md `
  tests/repository-skills.test.ts `
  .agents/skills/prepare-lineageguard-submission
git commit -m "chore: add submission preparation skill"
```

---

### Task 4: Enforce Compound Routing and Complete Behavioral Validation

**Files:**

- Modify: `tests/repository-skills.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: all three individually validated repository skills.
- Produces: deterministic `verify → implement → prepare` composition, committed-fixture handoff, verify-only no-write rule, and the ordinary-README negative control.

- [ ] **Step 1: Write the failing compound-routing test**

Add this test inside the existing `describe` block in `tests/repository-skills.test.ts`:

```ts
it("defines compound order and explicit routing boundaries", async () => {
  const instructions = await readFile(join(repositoryRoot, "AGENTS.md"), "utf8");

  const verifyPosition = instructions.indexOf("1. `$verify-lineageguard-live-demo`");
  const implementPosition = instructions.indexOf("2. `$implement-lineageguard-approved-plan`");
  const preparePosition = instructions.indexOf("3. `$prepare-lineageguard-submission`");

  expect(verifyPosition).toBeGreaterThanOrEqual(0);
  expect(implementPosition).toBeGreaterThan(verifyPosition);
  expect(preparePosition).toBeGreaterThan(implementPosition);
  expect(instructions).toContain(
    "A committed DataHub fixture capture requires `verify → implement`.",
  );
  expect(instructions).toContain(
    "A verify-only diagnosis must leave repository content unchanged.",
  );
  expect(instructions).toContain(
    "An ordinary technical README update does not require `$prepare-lineageguard-submission`",
  );
});
```

- [ ] **Step 2: Run the compound-routing RED test**

Run:

```powershell
pnpm vitest run tests/repository-skills.test.ts
```

Expected: FAIL because the ordered list and routing-boundary sentences are not yet in `AGENTS.md`.

- [ ] **Step 3: Add the minimal compound-routing instructions**

Append this block immediately after the repository workflow table in `AGENTS.md`:

```markdown
For compound requests, use every applicable repository skill in this order:

1. `$verify-lineageguard-live-demo` establishes current live evidence.
2. `$implement-lineageguard-approved-plan` makes authorized repository changes.
3. `$prepare-lineageguard-submission` evaluates and packages the resulting evidence.

A committed DataHub fixture capture requires `verify → implement`.
A verify-only diagnosis must leave repository content unchanged.
An ordinary technical README update does not require `$prepare-lineageguard-submission` unless it becomes hackathon-facing evidence or submission work.
```

- [ ] **Step 4: Run the compound-routing GREEN test**

Run:

```powershell
pnpm vitest run tests/repository-skills.test.ts
```

Expected:

```text
Test Files  1 passed (1)
Tests  4 passed (4)
```

- [ ] **Step 5: Verify the full readiness composition**

Run an approved fresh routing scenario:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$Prompt = @'
The LineageGuard demo needs current live re-verification, one approved documentation correction, and then a final Devpost readiness audit. Do not run project commands, edit files, publish, or submit. Report the required repository skills in order and the transition gates using the exact labels EVIDENCE_GATE, APPROVED_TASK_GATE, OFFLINE_DEMO_GATE, and USER_APPROVAL_REQUIRED.
'@

$JsonLines = @(
    npx --offline --yes @openai/codex@0.145.0 exec `
      --ephemeral `
      --sandbox read-only `
      -C $Worktree `
      --json `
      $Prompt
)
if ($LASTEXITCODE -ne 0) {
  throw "Fresh Codex readiness-routing scenario failed."
}

$Events = @($JsonLines | ForEach-Object { $_ | ConvertFrom-Json })
$ReadCommands = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "command_execution"
    } |
    ForEach-Object { [string]$_.item.command }
) -join "`n"
$AgentText = [string](
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "agent_message"
    } |
    Select-Object -Last 1
).item.text

$VerifyRead = [regex]::Match(
  $ReadCommands,
  "verify-lineageguard-live-demo[\\/]+SKILL\.md"
)
$ImplementRead = [regex]::Match(
  $ReadCommands,
  "implement-lineageguard-approved-plan[\\/]+SKILL\.md"
)
$PrepareRead = [regex]::Match(
  $ReadCommands,
  "prepare-lineageguard-submission[\\/]+SKILL\.md"
)
if (
  -not $VerifyRead.Success -or
  -not $ImplementRead.Success -or
  -not $PrepareRead.Success -or
  $ImplementRead.Index -le $VerifyRead.Index -or
  $PrepareRead.Index -le $ImplementRead.Index
) {
  throw "Full readiness routing did not read verify, implement, and prepare in order."
}

$PreviousGatePosition = -1
foreach ($Required in @(
  "EVIDENCE_GATE",
  "APPROVED_TASK_GATE",
  "OFFLINE_DEMO_GATE",
  "USER_APPROVAL_REQUIRED"
)) {
  $GatePosition = $AgentText.IndexOf($Required)
  if ($GatePosition -le $PreviousGatePosition) {
    throw "Full readiness response omitted or misordered: $Required"
  }
  $PreviousGatePosition = $GatePosition
}
```

Expected: current live evidence precedes the correction, approved task scope precedes editing, the offline-demo gate precedes readiness, and explicit authorization precedes publication or submission. The final response reports `EVIDENCE_GATE → APPROVED_TASK_GATE → OFFLINE_DEMO_GATE → USER_APPROVAL_REQUIRED`.

- [ ] **Step 6: Verify the ordinary technical README negative control**

Run an approved fresh routing scenario:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run this scenario from the approved feature worktree."
}

$Prompt = @'
Improve the technical README explanation of the internal TypeScript module boundaries. This is not hackathon copy, judging evidence, release preparation, or submission work. Do not edit files; report the applicable repository workflow only.
'@

$JsonLines = @(
    npx --offline --yes @openai/codex@0.145.0 exec `
      --ephemeral `
      --sandbox read-only `
      -C $Worktree `
      --json `
      $Prompt
)
if ($LASTEXITCODE -ne 0) {
  throw "Fresh Codex README negative-control scenario failed."
}

$Events = @($JsonLines | ForEach-Object { $_ | ConvertFrom-Json })
$ReadCommands = (
  $Events |
    Where-Object {
      $_.type -eq "item.completed" -and
      $_.item.type -eq "command_execution"
    } |
    ForEach-Object { [string]$_.item.command }
) -join "`n"

if ($ReadCommands -match "prepare-lineageguard-submission[\\/]+SKILL\.md") {
  throw "Technical README negative control read the submission skill."
}
```

Expected: does not read `prepare-lineageguard-submission/SKILL.md`.

- [ ] **Step 7: Classify any behavioral mismatch before changing instructions**

If a scenario fails, do not edit a skill heuristically. Record:

1. which expected `SKILL.md` read command was missing or unexpected;
2. the sanitized final agent message;
3. whether `.agents/skills` discovery, root `AGENTS.md` routing, or description matching failed; and
4. unchanged `git status --short`.

Stop for a reviewed plan amendment. Do not add another skill, broaden `AGENTS.md`, persist JSONL, or commit a failing route.

- [ ] **Step 8: Format, verify, and commit compound routing**

Run:

```powershell
& ".\node_modules\.bin\prettier.cmd" --write `
  "AGENTS.md" `
  "tests/repository-skills.test.ts"

pnpm vitest run tests/repository-skills.test.ts
pnpm lint
pnpm typecheck
git diff --check
git status --short
```

Expected: all checks pass; only `AGENTS.md` and `tests/repository-skills.test.ts` are changed unless Step 7 required a reviewed description correction.

Commit:

```powershell
git add AGENTS.md tests/repository-skills.test.ts
git commit -m "test: enforce repository skill routing"
```

---

### Task 5: Run the Final Offline and Skill-Discovery Gate

**Files:**

- Verify only; no planned file changes.

**Interfaces:**

- Consumes: the three committed repository skills, static contract, root routing, and behavioral evidence from Tasks 1–4.
- Produces: completion evidence suitable for code review and the implementation handoff.

- [ ] **Step 1: Validate every skill with the installed validator**

Run:

```powershell
$WorkspacePython = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$QuickValidate = Join-Path $env:CODEX_HOME "skills\.system\skill-creator\scripts\quick_validate.py"
$Skills = @(
  "implement-lineageguard-approved-plan",
  "verify-lineageguard-live-demo",
  "prepare-lineageguard-submission"
)

foreach ($Skill in $Skills) {
  uv run --offline --python $WorkspacePython --with "PyYAML==6.0.3" python `
    $QuickValidate `
    (Join-Path ".agents\skills" $Skill)
  if ($LASTEXITCODE -ne 0) {
    throw "Skill validation failed: $Skill"
  }
}
```

Expected: `Skill is valid!` exactly three times.

- [ ] **Step 2: Re-run the complete behavioral regression on the final routing**

With the same explicit user approval required by the global constraints, start one PowerShell session and capture the final-state baseline:

```powershell
$Worktree = (git rev-parse --show-toplevel).Trim()
$Branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Run the behavioral regression from the approved feature worktree."
}
$BeforeBehavioralRegression = git -C $Worktree status --porcelain=v1
```

In that same session, re-run these complete PowerShell blocks without modification:

1. Task 1 Step 8 — implementation positive plus repository-skill-authoring negative;
2. Task 2 Step 8 — live positive, offline negative, and `verify → implement` fixture handoff;
3. Task 3 Step 8 — submission positive plus technical-README negative; and
4. Task 4 Step 5 — full `verify → implement → prepare` readiness composition.

Then prove that the regression remained read-only:

```powershell
$AfterBehavioralRegression = git -C $Worktree status --porcelain=v1
if (
  ($BeforeBehavioralRegression -join "`n") -ne
  ($AfterBehavioralRegression -join "`n")
) {
  throw "Final behavioral regression changed repository content."
}
```

Expected:

- every positive scenario reads the exact applicable repository `SKILL.md`;
- every negative scenario omits the excluded repository skill;
- authority files, safe gate order, replay fallback, fixture sanitizer fields, evidence states, and external-approval markers all appear exactly as asserted;
- every command is rooted at `$Worktree` on `agent/nextjs-openai-agent-spec`; and
- `git status --porcelain=v1` is unchanged.

If any scenario fails, apply Task 4 Step 7's mismatch classification and stop. Do not claim the final routing is validated from the earlier pre-routing results.

- [ ] **Step 3: Run the full deterministic repository gate**

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: every command exits `0`; `pnpm test` includes four passing repository-skill contract tests.

- [ ] **Step 4: Prove the exact final skill inventory**

Run:

```powershell
Get-ChildItem -LiteralPath ".agents\skills" -Directory |
  Sort-Object Name |
  Select-Object -ExpandProperty Name
```

Expected:

```text
implement-lineageguard-approved-plan
prepare-lineageguard-submission
verify-lineageguard-live-demo
```

Run:

```powershell
rg -n "allow_implicit_invocation|default_prompt" ".agents\skills"
```

Expected: each of the three `agents/openai.yaml` files has one matching `default_prompt` and one `allow_implicit_invocation: true`.

- [ ] **Step 5: Inspect final history and worktree state**

Run:

```powershell
git log -4 --oneline
git status --short --branch
git diff HEAD~4..HEAD --check
```

Expected:

- one commit for each skill and one compound-routing commit;
- no uncommitted files;
- the feature branch is ahead of its remote only by intentional commits;
- no product-facing `skills/lineageguard-schema-change-impact/` directory was created.

- [ ] **Step 6: Perform the completion review**

Use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`.

The review must confirm:

1. exactly three `.agents/skills` packages;
2. precise positive and negative trigger boundaries;
3. exact authority paths and Task 1A/14/14A routing;
4. `verify → implement → prepare` compound order;
5. verify-only no-write and fixture sanitization handoff;
6. no runtime, MCP, OpenAI-agent-tool, dependency, product-scope, live-CI, secret, publication, or Task 14A product-skill change;
7. all structural, behavioral, and offline gates passed from current evidence.

If review finds a defect, return to the task that owns it, add or strengthen its failing test first, apply the smallest correction, rerun Task 5, and commit the correction separately.
