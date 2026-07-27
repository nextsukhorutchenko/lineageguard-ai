# Documentation Presentation-Layer Cleanup Design

**Status:** Approved

**Date:** 2026-07-27

**Authority:** Project-owner approval of approach A for all thirteen pre-existing implementation
plans and final Amendment A for this cleanup plan's verified self-closure.

## Problem

The repository contains thirteen completed implementation plans whose unchecked task boxes preserve
their original execution sequence. Without a lifecycle explanation, those historical records can
look like outstanding work. Some plans also retain earlier snippets that later approved amendments
supersede, which makes them unsuitable as current operator instructions.

The `docs/` directory has no concise index that separates current product authority, operator and
judging guidance, verification evidence, and historical execution records.

## Goals

- Mark all thirteen completed implementation plans as implemented historical records.
- Explain that unchecked boxes preserve the original sequence and do not represent remaining work.
- Direct readers from every historical plan to one concise current-document map.
- Create `docs/README.md` as the documentation entry point.
- Preserve approved specifications, amendments, correction history, and Git traceability.

## Non-Goals

- Do not mark individual historical checkboxes as completed.
- Do not rewrite, condense, move, or delete implementation-plan content.
- Do not change approved specifications, architecture decisions, runtime behavior, tests, CI, or
  dependencies.
- Do not mark any manual item in `docs/submission-checklist.md` as completed.
- Do not claim that every historical command was executed exactly as originally written.

## Chosen Approach

Add the following exact block once, immediately after the level-one title in each in-scope plan:

```markdown
> **Lifecycle:** Implemented — historical execution record.
>
> The implementation outcome is present in the repository. Unchecked boxes preserve the original
> execution sequence; they are not an outstanding-work tracker. Earlier snippets may be superseded
> by later approved amendments and the current implementation. Use `docs/README.md` to find current
> authority, operator guidance, and verification evidence.
```

The lifecycle statement describes the plan as a historical execution record without asserting that
every original step ran unchanged. Existing `Status: Approved` metadata remains intact.

Create `docs/README.md` with five short sections:

1. start here;
2. current product authority and architecture;
3. operator and judging guidance;
4. verification and submission evidence; and
5. historical execution records.

The map must state that current behavior is established by the applicable approved specification
or later approved amendment together with the implementation, tests, `package.json`, and CI.
Historical plan snippets are traceability evidence, not current copy-and-paste instructions.

## In-Scope Plans

1. `docs/specs/001-datahub-impact-slice/plan.md`
2. `docs/specs/002-nextjs-openai-agent-demo/plan.md`
3. `docs/superpowers/plans/2026-07-23-datahub-runtime-blocker-remediation.md`
4. `docs/superpowers/plans/2026-07-23-permanent-engineering-rules.md`
5. `docs/superpowers/plans/2026-07-23-repository-codex-skills.md`
6. `docs/superpowers/plans/2026-07-23-safe-datahub-fixture-recapture.md`
7. `docs/superpowers/plans/2026-07-24-flat-run-envelope-storage.md`
8. `docs/superpowers/plans/2026-07-24-flat-storage-cumulative-gate-remediation.md`
9. `docs/superpowers/plans/2026-07-26-demo-startup-polish.md`
10. `docs/superpowers/plans/2026-07-26-deterministic-pr-impact-reporting.md`
11. `docs/superpowers/plans/2026-07-26-midscene-visual-exploration.md`
12. `docs/superpowers/plans/2026-07-26-playwright-test-agents.md`
13. `docs/superpowers/plans/2026-07-26-public-replay-deployment.md`

## Final Amendment A: Verified Self-Closure

After both cleanup tasks and all required verification complete, the cleanup implementation plan
itself may receive the same exact lifecycle block. This self-closure does not broaden Task 1's
thirteen-plan scope or change any historical checkbox. Final lifecycle coverage is fourteen plans:
the thirteen pre-existing plans above plus
`docs/superpowers/plans/2026-07-27-documentation-presentation-layer-cleanup.md`.

## Rejected Approaches

### Move plans into `docs/history/`

Rejected because it creates broad path churn, breaks existing links, and obscures specification
traceability without improving the underlying records.

### Mark every checkbox completed

Rejected because it would convert preserved planning steps into unverified execution claims and
repeat the exact automation mistake this cleanup is intended to prevent.

## Verification

- Confirm the exact lifecycle block appears once in each of the thirteen plans.
- After verified self-closure, confirm the exact lifecycle block appears once in each of all
  fourteen plans.
- Confirm the unchecked-checkbox counts are unchanged.
- Confirm `docs/README.md` links only to existing repository files.
- Confirm no specification, submission checklist, code, test, workflow, manifest, or lockfile
  changed.
- Run Prettier on the changed documentation, `pnpm format:check`, `pnpm submission:check`, and
  `git diff --check`.
- Inspect the focused diff and repository status before completion.

## Acceptance Criteria

- A first-time reviewer can identify current documentation without opening a historical plan.
- Every completed implementation plan is visibly labeled as an implemented historical record.
- No unchecked historical box can reasonably be mistaken for an outstanding project task.
- Earlier snippets remain available for traceability but are explicitly non-authoritative when a
  later approved amendment or the current implementation supersedes them.
- Manual Devpost, video, account, and submission gates remain truthful and untouched.
