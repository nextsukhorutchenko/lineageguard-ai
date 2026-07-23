# Permanent Repository Engineering Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact, permanent hybrid engineering baseline and definition of done to the root `AGENTS.md`.

**Architecture:** Prepend two normative sections to the existing root instructions while preserving the current `## Agent skills` section byte-for-byte. Keep durable `MUST` and `SHOULD` rules in `AGENTS.md`; keep changing product facts in approved specifications, accepted architecture decisions, approved plans, configuration, and repository skills.

**Tech Stack:** Markdown, root `AGENTS.md`, PowerShell contract checks, Prettier, and the repository's existing `pnpm` quality gates.

## Global Constraints

- Treat `docs/superpowers/specs/2026-07-23-permanent-engineering-rules-design.md` as the authority for this change.
- Commit this plan separately before execution and begin Task 1 from a fully
  clean worktree.
- Modify only `AGENTS.md`; do not change application code, dependencies, lockfiles, CI, specifications, plans, or repository skills during implementation.
- Insert `## Engineering baseline` and `## Definition of done` before the existing `## Agent skills` section.
- Preserve the existing issue-tracker, triage-label, and domain-document subsections and sentences exactly.
- Use explicit `MUST` for mandatory rules and `SHOULD` for advisory architecture guidance.
- Keep model names, dependency versions, ports, tool or operation names, timeouts, retry counts, branches, worktrees, task numbers, hackathon dates, and live state out of `AGENTS.md`.
- Do not add exact-prose tests for the policy; use the one-time contract check in this plan and the existing repository formatter and quality gates.
- Keep mandatory tests and ordinary CI deterministic, offline, and credential-free.
- Keep all repository content in English and communication with the project owner in Ukrainian.
- Do not push or open a pull request as part of this plan.

## Target File Map

- Read: `docs/superpowers/specs/2026-07-23-permanent-engineering-rules-design.md` — approved requirements and acceptance criteria.
- Modify: `AGENTS.md` — durable engineering baseline, definition of done, and unchanged repository routing context.

No source, test, package, lockfile, CI, skill, or product-authority file is added or modified.

---

### Task 1: Add and Verify the Permanent Engineering Baseline

**Files:**

- Read: `docs/superpowers/specs/2026-07-23-permanent-engineering-rules-design.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: the approved authority model, rule categories, placement decision, and acceptance criteria from the design specification.
- Produces: a root `AGENTS.md` whose first two sections are `## Engineering baseline` and `## Definition of done`, followed by the complete, unchanged `## Agent skills` suffix present at execution time.

- [ ] **Step 1: Confirm the isolated worktree is clean and the authority files are present**

Run:

```powershell
$branch = git branch --show-current
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read the current branch."
}
if ($branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Unexpected branch: $branch"
}

$status = @(git status --porcelain)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect worktree status."
}
if ($status.Count -ne 0) {
  throw "Implementation requires a fully clean worktree: $($status -join '; ')"
}

if (-not (Test-Path -LiteralPath "AGENTS.md")) {
  throw "AGENTS.md is missing."
}
if (-not (Test-Path -LiteralPath "docs/superpowers/specs/2026-07-23-permanent-engineering-rules-design.md")) {
  throw "The approved design specification is missing."
}
```

Expected:

- the branch is `agent/nextjs-openai-agent-spec`;
- the worktree is fully clean;
- both authority files exist; and
- the command exits `0` with no output.

If any check fails, stop. Never overwrite, stage, or commit unrelated work.

- [ ] **Step 2: Run the one-time contract check and verify the new policy is absent**

Run:

```powershell
$content = Get-Content -Raw -LiteralPath "AGENTS.md"
$requiredHeadings = @(
  "## Engineering baseline",
  "## Definition of done"
)
$missing = @($requiredHeadings | Where-Object { -not $content.Contains($_) })
if ($missing.Count -gt 0) {
  throw "Missing approved AGENTS.md sections: $($missing -join ', ')"
}
```

Expected: FAIL with
`Missing approved AGENTS.md sections: ## Engineering baseline, ## Definition of done`.

This is the documentation RED check. Do not add a persistent exact-string test.

- [ ] **Step 3: Prepend the approved compact policy to `AGENTS.md`**

Use `apply_patch` to insert the following complete block immediately before the
first `## Agent skills` heading. Leave that heading and its entire current
suffix unchanged:

```markdown
## Engineering baseline

### Authority and scope

- **MUST** read the applicable approved specification, relevant accepted ADRs and architecture decisions, approved implementation-plan section, and domain guidance before changing behavior.
- **MUST** treat the applicable approved specification as product authority. An accepted ADR governs its architectural concern unless a later approved specification or ADR explicitly supersedes it. An approved implementation plan governs execution order but cannot broaden its specification. `PROJECT_BRIEF.md` provides context, while `AGENTS.md` governs process and does not create product scope.
- **MUST** stop and ask the project owner when applicable authority conflicts or leaves a permission-sensitive decision ambiguous.
- **MUST** implement the smallest safe change that satisfies approved acceptance criteria. Do not add unrelated refactors or broaden scope, behavior, dependencies, permissions, or external actions without an owner-approved amendment to the applicable authority.
- **MUST** preserve unrelated user changes. Do not perform destructive filesystem or Git operations without explicit authorization.

### Toolchain and architecture

- **MUST** treat `package.json`, the lockfile, TypeScript configuration, and CI workflow as toolchain authority. Use exact dependency versions, never introduce `@latest`, and update the manifest and lockfile together through the repository package manager.
- **MUST** preserve strict TypeScript, ESM, established relative-import conventions, and existing compiler, lint, test, and build gates. Do not weaken a gate to make a change pass.
- **SHOULD** prefer small cohesive modules, deterministic pure domain logic, and explicit adapters at external boundaries. Deviations require approved authority and a documented reason.

### Testing and verification

- **MUST** add or update tests for every behavior change and regression fix. Run the smallest relevant test first, then the affected suite and required repository gates.
- **MUST** colocate focused unit tests as `*.test.ts`; keep cross-module, fixture, integration, and browser flows under `tests/`. Use isolated temporary paths and clean up resources. Tests and runtime code must not mutate committed fixtures in place; intentional fixture migrations require approved authority and deterministic validation.
- **MUST** keep mandatory tests and ordinary CI deterministic, offline, credential-free, and independent of live DataHub or OpenAI services. Live checks must be explicit, environment-gated, bounded, and reported separately.
- **MUST** prove what a broad test filter selected before trusting its result.

### Trust, AI, and secrets

- **MUST** treat user input, model output, MCP and provider responses, metadata, persisted external content, and dependency errors as untrusted.
- **MUST** normalize, size-bound, strictly validate, and sanitize untrusted values before model input, decision use, persistence, rendering, download, or browser exposure. Use strict structured schemas at AI and tool boundaries, with deterministic application validation authoritative for critical decisions and published artifacts.
- **MUST** keep credentials server-only and untracked. Never place secrets in client bundles, logs, fixtures, screenshots, generated artifacts, repository content, or tool or command arguments; example environment files may contain only documented non-secret placeholders.
- **MUST NOT** expose or persist hidden system or developer instructions, chain-of-thought, raw MCP, provider, or model trace envelopes, unsafe terminal or escape control sequences, or unrestricted native paths in application responses, browser or UI output, public CLI output, logs, persisted runs, downloads, or submission artifacts. Validated user-authored domain input required by an approved contract, committed versioned agent instructions, and allowlisted sanitized version metadata are permitted.
- **MUST** replace external dependency failures with bounded typed errors before they cross application boundaries.

### External effects and persistence

- **MUST** default external integrations to read-only and least privilege. Do not enable mutation, SQL execution, unrestricted tools, repository automation, publication, or other external-state changes unless approved authority requires them and the current action is explicitly authorized.
- **MUST** enforce allowlists, timeouts, cancellation, and bounded retry behavior at external boundaries.
- **MUST** constrain runtime-generated or externally derived filesystem writes to validated roots and fixed or validated file names. Use create-only or atomic final publication when partial output could mislead, and never mark failed, incomplete, timed-out, or cancelled work as completed.

### CI and supply chain

- **MUST** keep GitHub Actions least-privileged, pin third-party actions to full commit SHAs, disable persisted checkout credentials unless approved authority requires them, and use the frozen lockfile.
- **MUST** keep required CI free of secrets, live external services, and hidden mutable dependencies.
- **MUST** provide executable positive and negative tests when adding a new enforcement gate.

### Language

- **MUST** keep code, tests, comments, documentation, UI text, commits, and repository artifacts in English.
- **MUST** communicate with the project owner in Ukrainian unless the owner requests another language.

## Definition of done

A change is complete only when:

- it is traceable to approved acceptance criteria and does not broaden authority;
- positive, negative, boundary, and regression tests relevant to changed behavior exist and pass, while documentation-only changes avoid artificial behavior tests;
- current repository and CI-mandated checks relevant to the changed surface pass, with every command's exit status verified;
- `git diff --check`, the focused diff, and repository status have been inspected;
- repository-provided secret scanning passes when available and no credentials or sensitive raw traces were introduced;
- documentation and authority artifacts are updated when contracts, behavior, architecture, or operator steps change; and
- skipped, unavailable, stale, replay-only, or unexecuted checks are reported truthfully and never described as passing.
```

- [ ] **Step 4: Format only `AGENTS.md`**

Run:

```powershell
node node_modules/prettier/bin/prettier.cjs --write AGENTS.md
```

Expected: Prettier reports `AGENTS.md` as the formatted file and exits `0`.

- [ ] **Step 5: Run the complete one-time policy contract**

Run:

```powershell
$content = Get-Content -Raw -LiteralPath "AGENTS.md"
$required = @(
  "## Engineering baseline",
  "## Definition of done",
  "## Agent skills",
  "### Issue tracker",
  "Issues and PRDs are tracked in GitHub Issues. See ``docs/agents/issue-tracker.md``.",
  "### Triage labels",
  "Use the repository's five canonical triage labels. See ``docs/agents/triage-labels.md``.",
  "### Domain docs",
  "This is a single-context repository. See ``docs/agents/domain.md``.",
  "**MUST**",
  "**SHOULD**",
  "deterministic, offline, credential-free",
  "explicitly authorized",
  "reported truthfully"
)
$missing = @($required | Where-Object { -not $content.Contains($_) })
if ($missing.Count -gt 0) {
  throw "Missing approved AGENTS.md contract: $($missing -join ', ')"
}

$headingOrder = @(
  $content.IndexOf("## Engineering baseline"),
  $content.IndexOf("## Definition of done"),
  $content.IndexOf("## Agent skills")
)
if ($headingOrder[0] -lt 0 -or
    $headingOrder[1] -le $headingOrder[0] -or
    $headingOrder[2] -le $headingOrder[1]) {
  throw "AGENTS.md section order is invalid."
}

$headContent = (git show HEAD:AGENTS.md | Out-String).Replace("`r`n", "`n").TrimEnd()
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read HEAD:AGENTS.md."
}
$currentContent = $content.Replace("`r`n", "`n").TrimEnd()
$headMarker = $headContent.IndexOf("## Agent skills")
$currentMarker = $currentContent.IndexOf("## Agent skills")
if ($headMarker -lt 0 -or $currentMarker -lt 0) {
  throw "The Agent skills preservation marker is missing."
}
$headAgentSkills = $headContent.Substring($headMarker)
$currentAgentSkills = $currentContent.Substring($currentMarker)
if ($currentAgentSkills -cne $headAgentSkills) {
  throw "The existing Agent skills suffix changed."
}

$transientPattern = '22\.23\.1|10\.10\.0|9002|8080|Task \d|agent/nextjs-openai-agent-spec|\.worktrees|rename_column|list_schema_fields|August 10'
if ($content -match $transientPattern) {
  throw "AGENTS.md contains a transient implementation fact: $($Matches[0])"
}

$mustCount = ([regex]::Matches($content, '\*\*MUST(?: NOT)?\*\*')).Count
$shouldCount = ([regex]::Matches($content, '\*\*SHOULD\*\*')).Count
if ($mustCount -lt 15 -or $shouldCount -ne 1) {
  throw "Unexpected normative-rule counts: MUST=$mustCount SHOULD=$shouldCount"
}
```

Expected: exit code `0` with no output.

- [ ] **Step 6: Run the repository formatting gate**

Run:

```powershell
pnpm format:check
```

Expected: `All matched files use Prettier code style!` and exit code `0`.

- [ ] **Step 7: Run lint**

Run:

```powershell
pnpm lint
```

Expected: exit code `0`.

- [ ] **Step 8: Run the TypeScript check**

Run:

```powershell
pnpm typecheck
```

Expected: exit code `0`.

- [ ] **Step 9: Run the deterministic offline tests**

Run:

```powershell
pnpm test
```

Expected: all non-integration tests pass and exit code `0`.

- [ ] **Step 10: Run the production build**

Run:

```powershell
pnpm build
```

Expected: exit code `0`.

- [ ] **Step 11: Inspect the final diff and repository state**

Run:

```powershell
git diff --check
if ($LASTEXITCODE -ne 0) {
  throw "git diff --check failed."
}
git diff -- AGENTS.md
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect the AGENTS.md diff."
}
$status = @(git status --short)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect worktree status."
}
if ($status.Count -ne 1 -or $status[0] -ne " M AGENTS.md") {
  throw "Unexpected worktree changes: $($status -join '; ')"
}
```

Expected:

- `git diff --check` exits `0`;
- the diff prepends only the approved engineering baseline and definition of
  done;
- the existing `## Agent skills` content is unchanged; and
- `git status --short` lists only `M AGENTS.md`.

- [ ] **Step 12: Commit the verified documentation change**

Run:

```powershell
git add AGENTS.md
if ($LASTEXITCODE -ne 0) {
  throw "Unable to stage AGENTS.md."
}
git diff --cached --check
if ($LASTEXITCODE -ne 0) {
  throw "The staged diff failed git diff --check."
}
$stagedPaths = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect staged paths."
}
if ($stagedPaths.Count -ne 1 -or $stagedPaths[0] -ne "AGENTS.md") {
  throw "Unexpected staged paths: $($stagedPaths -join ', ')"
}
git diff --cached -- AGENTS.md
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect the staged AGENTS.md diff."
}
git commit -m "docs: add permanent engineering rules"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to commit the permanent engineering rules."
}
$commitSha = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Unable to verify the implementation commit SHA."
}
$commitSha
$status = @(git status --porcelain)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect final worktree status."
}
if ($status.Count -ne 0) {
  throw "The final worktree is not clean: $($status -join '; ')"
}
git status --short --branch
if ($LASTEXITCODE -ne 0) {
  throw "Unable to report final branch status."
}
```

Expected:

- the cached diff contains only `AGENTS.md`;
- the commit succeeds with message
  `docs: add permanent engineering rules`; and
- `git rev-parse HEAD` prints the verified full commit SHA; and
- the final worktree is clean and ahead of its remote.

Do not push. Report the verified commit hash and wait for the project owner's
next instruction.

## Plan Self-Review

- **Spec coverage:** Task 1 implements every approved authority, scope,
  toolchain, testing, trust, secret, external-effect, CI, language, placement,
  and definition-of-done requirement.
- **Placeholder scan:** Every implementation and verification action is
  complete, executable, and free of deferred or undefined work.
- **Consistency:** The exact final `AGENTS.md` content, contract assertions,
  formatting command, quality gates, expected diff, and commit scope all refer
  to the same two new sections and preserve the same three existing routing
  subsections.
