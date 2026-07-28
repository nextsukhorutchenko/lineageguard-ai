# README Agent-First Hero Implementation Plan

> **Lifecycle:** Implemented — historical execution record.
>
> The implementation outcome is present in the repository. Unchecked boxes preserve the original
> execution sequence; they are not an outstanding-work tracker. Earlier snippets may be superseded
> by later approved amendments and the current implementation. Use `docs/README.md` to find current
> authority, operator guidance, and verification evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outdated CLI-first README introduction with the approved compact
agent-product hero, public replay CTA, verified golden result, four artifact links, and concise
safety boundary.

**Architecture:** Change only the root README content between `# LineageGuard AI` and
`## Architecture and Safety Boundary`. Keep every detailed section below that boundary unchanged
and derive every claim from the approved design and committed verification evidence.

**Tech Stack:** Markdown, Prettier, Vitest submission-validator tests, repository submission
validator, Git.

## Global Constraints

- Product and repository content must remain English.
- Modify only the root `README.md` introduction during implementation.
- Use the exact approved hero copy from
  `docs/superpowers/specs/2026-07-27-readme-agent-hero-design.md`.
- Present the hosted URL as deterministic fixture replay, not live DataHub or OpenAI.
- Preserve the public URL, `24 downstream`, `11 column-confirmed`, `risk 90 (critical)`,
  `BLOCK_DIRECT_RENAME`, and the four exact artifact filenames.
- Preserve read-only DataHub access, no SQL execution, no DataHub mutation, deterministic decision
  authority, and mandatory human approval.
- Do not add badges, screenshots, imagery, dependencies, runtime changes, or validator changes.
- Do not rewrite content at or below `## Architecture and Safety Boundary`.
- Documentation-only work must use existing validation; do not create artificial behavior tests.

---

### Task 1: Replace and Verify the README Hero

**Files:**

- Modify: `README.md:1-11`
- Reference: `docs/superpowers/specs/2026-07-27-readme-agent-hero-design.md`
- Verify: `scripts/validate-submission-assets.test.ts`

**Interfaces:**

- Consumes: the exact approved Markdown hero from the design specification and the existing
  `## Architecture and Safety Boundary` section as the immutable lower boundary.
- Produces: a root README whose first screen presents the agent product, public replay, golden
  result, four artifact links, and safety boundary while preserving all later content byte-for-byte.

- [x] **Step 1: Verify the immutable lower boundary**

Run:

```powershell
$readme = Get-Content -LiteralPath README.md
$boundary = [Array]::IndexOf($readme, '## Architecture and Safety Boundary')
if ($boundary -lt 1) {
  throw 'README architecture boundary is missing.'
}
if (-not (($readme[0..($boundary - 1)] -join "`n").Contains('CLI-first'))) {
  throw 'Expected legacy README introduction is missing.'
}
```

Expected: exit `0`; the architecture boundary and legacy introduction are both present before the
replacement.

- [x] **Step 2: Replace only the README introduction**

Use `apply_patch` to replace the content before `## Architecture and Safety Boundary` with this
exact approved block:

```markdown
# LineageGuard AI

**A DataHub-grounded AI agent for safe schema-change planning.** It turns a proposed column rename
into an explainable impact decision and a validated, review-ready migration package.

[**Try the public replay →**](https://lineageguard-ai-replay.onrender.com)

> **Public demo:** deterministic fixture replay; no DataHub, OpenAI, API key, or paid account
> required. Live DataHub + OpenAI runs locally.

**Golden result:** `24 downstream` · `11 column-confirmed` · `risk 90 (critical)` ·
`BLOCK_DIRECT_RENAME`

**Four validated artifacts:**
[`migration-up.sql`](examples/002-nextjs-openai-agent-demo/migration-up.sql) ·
[`migration-down.sql`](examples/002-nextjs-openai-agent-demo/migration-down.sql) ·
[`validation.sql`](examples/002-nextjs-openai-agent-demo/validation.sql) ·
[`rollout-plan.md`](examples/002-nextjs-openai-agent-demo/rollout-plan.md)

**Safety boundary:** DataHub access is read-only. LineageGuard does not execute SQL, mutate DataHub,
perform GitHub operations, or approve breaking changes. Deterministic application logic owns the
impact result and risk decision; human approval remains mandatory.

[How it works](docs/architecture/agent-demo.md) ·
[Deployment evidence](docs/public-deployment-verification.md) ·
[Run the replay locally](#browser-demo--fixture-replay)
```

- [x] **Step 3: Prove the lower README content is unchanged**

Run:

```powershell
$before = @(git show HEAD:README.md)
if ($LASTEXITCODE -ne 0) {
  throw 'Could not read the committed README baseline.'
}
$after = @(Get-Content -LiteralPath README.md)
$beforeBoundary = [Array]::IndexOf($before, '## Architecture and Safety Boundary')
$afterBoundary = [Array]::IndexOf($after, '## Architecture and Safety Boundary')
if ($beforeBoundary -lt 1 -or $afterBoundary -lt 1) {
  throw 'README architecture boundary is missing after hero replacement.'
}
$beforeLower = $before[$beforeBoundary..($before.Count - 1)]
$afterLower = $after[$afterBoundary..($after.Count - 1)]
if (Compare-Object -ReferenceObject $beforeLower -DifferenceObject $afterLower -SyncWindow 0) {
  throw 'README content below the hero changed.'
}
```

Expected: exit `0` with no output.

- [x] **Step 4: Verify every hero link target**

Run:

```powershell
$targets = @(
  'examples/002-nextjs-openai-agent-demo/migration-up.sql',
  'examples/002-nextjs-openai-agent-demo/migration-down.sql',
  'examples/002-nextjs-openai-agent-demo/validation.sql',
  'examples/002-nextjs-openai-agent-demo/rollout-plan.md',
  'docs/architecture/agent-demo.md',
  'docs/public-deployment-verification.md'
)
$missing = @($targets | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missing.Count -ne 0) {
  throw "Missing README hero target: $($missing -join ', ')"
}
$readme = Get-Content -LiteralPath README.md -Raw
if (-not $readme.Contains('https://lineageguard-ai-replay.onrender.com')) {
  throw 'Verified public Project URL is missing.'
}
if (-not $readme.Contains('## Browser Demo — Fixture Replay')) {
  throw 'Local replay anchor target is missing.'
}
```

Expected: exit `0` with no output.

- [x] **Step 5: Run focused documentation validation**

Run:

```powershell
pnpm exec prettier --check README.md
pnpm vitest run scripts/validate-submission-assets.test.ts
pnpm submission:check
git diff --check
```

Expected: README formatting passes; the submission-validator test file passes; submission assets
report `OK`; Git reports no whitespace errors.

- [x] **Step 6: Inspect scope and commit**

Run:

```powershell
git diff -- README.md
git status --short
git add README.md
git commit -m "docs: lead README with agent demo"
```

Expected: the focused diff changes only the README introduction; status before staging shows only
`README.md` plus no tracked implementation files; the commit succeeds.
