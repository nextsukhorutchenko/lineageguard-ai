# Documentation Presentation-Layer Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current documentation immediately discoverable and identify completed implementation
plans as historical execution records without rewriting their history.

**Architecture:** Add one identical lifecycle banner to the thirteen pre-existing implementation
plans and create one concise documentation map. Preserve every historical checkbox and snippet, then
mark this cleanup plan historical only after its own implementation and verification are complete.

**Tech Stack:** Markdown, Prettier, repository submission validator, Git.

**Authority:** Approved design
`docs/superpowers/specs/2026-07-27-documentation-presentation-layer-cleanup-design.md`.

## Global Constraints

- Modify documentation only.
- Preserve all 537 unchecked steps across the thirteen pre-existing implementation plans.
- Do not modify approved specifications, architecture decisions, `PROJECT_BRIEF.md`, runtime code,
  tests, workflows, manifests, lockfiles, or environment files.
- Do not change `docs/submission-checklist.md` or imply that any manual submission action is complete.
- Add the exact approved lifecycle block once to every completed implementation plan.
- Keep repository content in English.
- Do not add a validator merely to enforce presentation wording.

---

### Task 1: Label the Completed Plans and Add the Current Documentation Map

**Files:**

- Create: `docs/README.md`
- Modify: `docs/specs/001-datahub-impact-slice/plan.md`
- Modify: `docs/specs/002-nextjs-openai-agent-demo/plan.md`
- Modify: `docs/superpowers/plans/2026-07-23-datahub-runtime-blocker-remediation.md`
- Modify: `docs/superpowers/plans/2026-07-23-permanent-engineering-rules.md`
- Modify: `docs/superpowers/plans/2026-07-23-repository-codex-skills.md`
- Modify: `docs/superpowers/plans/2026-07-23-safe-datahub-fixture-recapture.md`
- Modify: `docs/superpowers/plans/2026-07-24-flat-run-envelope-storage.md`
- Modify: `docs/superpowers/plans/2026-07-24-flat-storage-cumulative-gate-remediation.md`
- Modify: `docs/superpowers/plans/2026-07-26-demo-startup-polish.md`
- Modify: `docs/superpowers/plans/2026-07-26-deterministic-pr-impact-reporting.md`
- Modify: `docs/superpowers/plans/2026-07-26-midscene-visual-exploration.md`
- Modify: `docs/superpowers/plans/2026-07-26-playwright-test-agents.md`
- Modify: `docs/superpowers/plans/2026-07-26-public-replay-deployment.md`

**Interfaces:**

- Consumes: the exact lifecycle wording and thirteen-file scope from the approved design.
- Produces: one documentation entry point and thirteen consistently labeled historical records.

- [ ] **Step 1: Capture the immutable historical baseline**

Run:

```powershell
$files = @(rg --files docs | Where-Object {
  $_ -match '(\\plan\.md$|\\plans\\.*\.md$)' -and
  $_ -ne 'docs\superpowers\plans\2026-07-27-documentation-presentation-layer-cleanup.md'
})
$unchecked = 0
foreach ($file in $files) {
  $unchecked += [int](rg -c '^- \[ \]' $file)
}
"plans=$($files.Count) unchecked=$unchecked"
```

Expected: `plans=13 unchecked=537`.

- [ ] **Step 2: Add the approved lifecycle block to the thirteen plans**

Insert this exact block once, immediately after each level-one title:

```markdown
> **Lifecycle:** Implemented — historical execution record.
>
> The implementation outcome is present in the repository. Unchecked boxes preserve the original
> execution sequence; they are not an outstanding-work tracker. Earlier snippets may be superseded
> by later approved amendments and the current implementation. Use `docs/README.md` to find current
> authority, operator guidance, and verification evidence.
```

Do not alter any existing status, checkbox, command, correction, or snippet.

- [ ] **Step 3: Create the concise documentation map**

Create `docs/README.md` with this content:

```markdown
# Documentation Map

Use the root [README](../README.md) for the product overview, public replay, setup, and supported
workflow. This map separates current guidance from historical execution records.

## Start Here

- [README](../README.md) — product overview, safety boundary, local setup, and public replay.
- [Judging map](judging-map.md) — official criteria, visible demo moments, and evidence.
- [Demo scenario](demo-scenario.md) — pinned environment, operator sequence, and 2:55 video script.

## Current Product Authority and Architecture

- [Engineering rules](../AGENTS.md) — repository process, safety, verification, and language rules.
- [Next.js and OpenAI agent specification](specs/002-nextjs-openai-agent-demo/spec.md) — current
  product authority for the browser and agent demo.
- [Public replay deployment design](superpowers/specs/2026-07-26-public-replay-deployment-design.md)
  — approved narrow amendment for hosted deterministic replay.
- [Agent demo architecture](architecture/agent-demo.md) — current runtime boundaries and data flow.
- [DataHub impact slice specification](specs/001-datahub-impact-slice/spec.md) and
  [approved decisions](specs/001-datahub-impact-slice/decisions.md) — implemented deterministic
  foundation retained by the current demo.

[PROJECT_BRIEF](../PROJECT_BRIEF.md) preserves the original exploration and contains an explicit
supersession notice. It is context, not current implementation authority.

## Operator and Judging Guidance

- [Demo scenario](demo-scenario.md) — local DataHub, MCP, replay, live, and video walkthrough.
- [Testing guidance](testing/) — Playwright agents, PR impact reporting, and optional exploration.
- [Resources and attribution](resources-and-attribution.md) — reviewed sources, versions, licenses,
  clean-room boundaries, and dataset provenance.

## Verification and Submission Evidence

- [Live verification](live-verification.md) — commit-bound local DataHub and OpenAI evidence.
- [Public deployment verification](public-deployment-verification.md) — sanitized hosted replay
  acceptance evidence.
- [Submission checklist](submission-checklist.md) — manual Devpost, video, account, and publication
  gates. Unchecked boxes remain outstanding manual actions unless a person verifies them.

## Historical Execution Records

- [DataHub impact slice plan](specs/001-datahub-impact-slice/plan.md)
- [Next.js and OpenAI agent demo plan](specs/002-nextjs-openai-agent-demo/plan.md)
- [Focused implementation and remediation plans](superpowers/plans/)

Plans in this section are implemented historical execution records. Their unchecked boxes preserve
the original sequence and do not represent remaining work. Earlier snippets may be superseded by
later approved amendments and the current implementation. Use the current authority and operator
documents above instead of copying commands or code from a historical plan.
```

- [ ] **Step 4: Verify the focused presentation contract**

Run:

```powershell
$files = @(rg --files docs | Where-Object {
  $_ -match '(\\plan\.md$|\\plans\\.*\.md$)' -and
  $_ -ne 'docs\superpowers\plans\2026-07-27-documentation-presentation-layer-cleanup.md'
})
$bannerCount = 0
$unchecked = 0
foreach ($file in $files) {
  $bannerCount += [int](rg -c '^\> \*\*Lifecycle:\*\* Implemented — historical execution record\.$' $file)
  $unchecked += [int](rg -c '^- \[ \]' $file)
}
"plans=$($files.Count) banners=$bannerCount unchecked=$unchecked"
```

Expected: `plans=13 banners=13 unchecked=537`.

Verify every documentation-map target:

```powershell
$targets = @(
  'README.md',
  'AGENTS.md',
  'PROJECT_BRIEF.md',
  'docs/judging-map.md',
  'docs/demo-scenario.md',
  'docs/specs/002-nextjs-openai-agent-demo/spec.md',
  'docs/superpowers/specs/2026-07-26-public-replay-deployment-design.md',
  'docs/architecture/agent-demo.md',
  'docs/specs/001-datahub-impact-slice/spec.md',
  'docs/specs/001-datahub-impact-slice/decisions.md',
  'docs/testing',
  'docs/resources-and-attribution.md',
  'docs/live-verification.md',
  'docs/public-deployment-verification.md',
  'docs/submission-checklist.md',
  'docs/specs/001-datahub-impact-slice/plan.md',
  'docs/specs/002-nextjs-openai-agent-demo/plan.md',
  'docs/superpowers/plans'
)
$missing = @($targets | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count -ne 0) {
  throw "Documentation map contains a missing repository target."
}
```

Expected: exit 0 with no output.

- [ ] **Step 5: Run documentation validation**

Run:

```powershell
pnpm format:check
pnpm submission:check
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the presentation cleanup**

Run:

```powershell
git add docs/README.md docs/specs/001-datahub-impact-slice/plan.md docs/specs/002-nextjs-openai-agent-demo/plan.md docs/superpowers/plans
git commit -m "docs: clarify current and historical documentation"
```

Expected: one documentation-only commit.

---

### Task 2: Close the Cleanup Record and Verify the Branch

**Files:**

- Modify: `docs/superpowers/plans/2026-07-27-documentation-presentation-layer-cleanup.md`

**Interfaces:**

- Consumes: completed Task 1 documentation and its focused verification.
- Produces: a historical lifecycle marker for this plan and a clean, reviewable documentation-only
  branch.

- [ ] **Step 1: Add the lifecycle block to this completed plan**

Insert the same exact approved lifecycle block immediately after this plan's level-one title. Do not
change its checkboxes.

- [ ] **Step 2: Verify lifecycle coverage and branch scope**

Run:

```powershell
$allPlans = @(rg --files docs | Where-Object { $_ -match '(\\plan\.md$|\\plans\\.*\.md$)' })
$bannerCount = 0
foreach ($file in $allPlans) {
  $bannerCount += [int](rg -c '^\> \*\*Lifecycle:\*\* Implemented — historical execution record\.$' $file)
}
"plans=$($allPlans.Count) banners=$bannerCount"
```

Expected: `plans=14 banners=14`.

Run:

```powershell
git diff main...HEAD --name-only
pnpm format:check
pnpm submission:check
git diff --check
git status --short
```

Expected:

- the branch diff contains only the approved design, this plan, `docs/README.md`, and the thirteen
  pre-existing plan files;
- all validation commands exit 0; and
- repository status shows only this plan's intended lifecycle edit before the final commit.

- [ ] **Step 3: Commit the completed execution record**

Run:

```powershell
git add docs/superpowers/plans/2026-07-27-documentation-presentation-layer-cleanup.md
git commit -m "docs: close presentation cleanup record"
git status --short --branch
```

Expected: the final status is clean on `docs/presentation-layer-cleanup`.
