# Playwright Test Agents, PR Impact Reporting, and Midscene Design

**Status:** Approved

**Date:** 2026-07-26

**Authority:** This owner-approved design is a narrow repository-tooling amendment to approved
specification `002-nextjs-openai-agent-demo`. It does not change LineageGuard runtime behavior,
the application agent, DataHub or OpenAI boundaries, migration artifacts, browser product
acceptance, or the mandatory offline test requirement.

## Problem

The repository has strong deterministic Chromium coverage, but it does not yet provide:

- repository-owned Playwright Test Agent definitions for planner, generator, and healer authoring
  loops;
- a bounded deterministic report that explains which browser areas and scenarios a pull request
  may affect and reconciles that advisory classification with the completed Playwright run; or
- an isolated visual exploratory workflow for questions that deterministic DOM assertions cannot
  answer economically.

The current specification prohibits GitHub operations by the LineageGuard runtime and requires
ordinary CI to remain deterministic, offline, credential-free, and independent of live DataHub and
OpenAI services. The new tooling must preserve those boundaries.

## Chosen Approach

Add three repository-only capabilities with separate trust and execution boundaries:

1. Playwright Test Agents are local test-authoring aids generated from the exact installed
   Playwright version.
2. A deterministic PR impact layer classifies validated repository-relative changed paths and
   combines that advisory context with the completed full Playwright run.
3. Midscene is an explicit, credentialed, local-only visual exploratory workflow with its own
   Playwright configuration and report root.

The impact result never selects tests. The existing full Chromium suite remains mandatory.
Neither Playwright Test Agents nor Midscene runs in mandatory CI.

## Authority Amendment

Repository developer tooling may:

- generate repository-owned Playwright Test Agent definitions using the lockfile-pinned
  Playwright CLI;
- create bounded local JSON and Markdown reports beneath validated ignored roots;
- upload bounded CI report artifacts through the existing pinned GitHub Actions artifact action;
- append bounded sanitized Markdown to `GITHUB_STEP_SUMMARY` on `pull_request` runs; and
- execute optional Midscene visual exploration only when an operator explicitly enables it and
  supplies external model configuration.

Repository developer tooling must not:

- comment on pull requests or create or update Check Runs;
- create labels, issues, branches, commits, pull requests, reviews, or approvals;
- call GitHub REST, GraphQL, CLI, MCP, or other GitHub APIs;
- request GitHub write permissions;
- select, skip, suppress, or reorder mandatory tests based on impact analysis;
- override Playwright status or exit code;
- execute Test Agents, Midscene, DataHub, or OpenAI calls in mandatory offline CI; or
- expose secrets, absolute native paths, changed-file contents, raw provider output, hidden
  instructions, prompts, traces, or unrestricted screenshots in reports.

The workflow retains `permissions: contents: read`, immutable action pins,
`persist-credentials: false`, and frozen lockfile installation.

## Playwright Test Agents

Generate the planner, generator, and healer definitions from the installed CLI:

```text
pnpm exec playwright init-agents --loop=codex
```

The generated definitions are reviewed repository content and must be regenerated whenever the
pinned Playwright version changes. No `npx` download, `@latest` dependency, or copied external
template is permitted.

Add one deterministic seed test that reuses the current managed E2E server lifecycle, Chromium
project, REPLAY mode, fixtures, and browser conventions. The seed provides setup and repository
examples to the planner and generator; it does not grant live provider access or GitHub
capabilities.

Generated plans and tests require human review and all normal repository gates. The healer may
repair tests locally, but it may not skip a test to make a run green or weaken a product
assertion.

## Deterministic PR Impact Layer

The layer has four focused units:

1. a versioned pure mapping from repository-relative path patterns to impacted areas and expected
   stable scenario tags;
2. a bounded change-context adapter that invokes local Git with fixed argument arrays and no
   shell;
3. a Playwright reporter that reconciles the advisory mapping with discovered and completed test
   results; and
4. deterministic JSON and Markdown renderers that atomically publish bounded output.

Initial impacted areas are:

- application shell and responsive UI;
- workflow streaming and terminal states;
- artifact preview, copy, download, size, encoding, and cancellation safety;
- runtime proof and replay honesty;
- E2E harness and server lifecycle; and
- configuration, toolchain, CI, specifications, and security boundaries.

Every maintained browser scenario receives a stable, allowlisted tag. The mapping reports expected
tags and the reporter records discovered and completed tags. The reporter does not filter the
suite.

### Change Context

Changed-file contents are never read. Inputs are normalized to repository-relative slash-separated
paths and rejected if they are absolute, traversal-shaped, empty, contain unsafe control
characters, exceed their per-value bound, exceed 2,000 entries, or exceed 256 KiB in aggregate.
Git comparison refs accept only strict full commit identifiers and are passed to `spawn` or
`execFile` without a shell.

Unknown, invalid, truncated, empty, unavailable, or unmapped comparison data produces
`FULL_SUITE_REQUIRED`. This state is advisory because the full suite runs in every case.
Non-pull-request events use the fixed outcome `IMPACT_CONTEXT_UNAVAILABLE` and do not produce a
GitHub job summary in the first version.

### Report Contract

The schema-versioned JSON report contains only:

- normalized bounded repository-relative paths;
- impacted area identifiers;
- expected, discovered, completed, failed, and missing stable tags;
- aggregate passed, failed, timed-out, interrupted, skipped, and retried counts;
- the final Playwright status; and
- fixed reason codes and bounded fixed explanatory text.

The Markdown report is derived only from the validated JSON object. It escapes Markdown control
syntax and contains no raw stacks, exception messages, stdout, stderr, traces, attachments, native
paths, or changed-file contents.

The Markdown output is limited to 32 KiB and JSON output to 256 KiB. Output is written to a
temporary file beneath an exact validated root and renamed atomically to its final fixed filename.
Intermediate context lives beneath `.tmp/pr-impact/`; final output lives beneath
`test-results/pr-impact/`. Both roots are ignored.

The custom reporter implements the minimum required Playwright hooks and returns no status from
`onEnd`, so it cannot override Playwright's result.

## CI Flow

The existing `pnpm verify:offline` remains the authoritative mandatory gate.

For `pull_request`:

1. checkout obtains the Git history required for a local comparison while retaining
   `persist-credentials: false`;
2. the bounded adapter derives changed paths from local Git or produces
   `FULL_SUITE_REQUIRED`;
3. `pnpm verify:offline` runs every existing mandatory gate and the complete Chromium suite;
4. the completed reporter publishes bounded JSON and Markdown;
5. the existing pinned artifact action uploads the bounded impact report; and
6. a separate step appends only the already validated bounded Markdown to
   `GITHUB_STEP_SUMMARY`.

The summary step performs no API call and receives no write permission. `push` and
`workflow_dispatch` continue to run the full gate but do not publish a PR impact summary in the
first version. If the full browser run never starts, no successful impact report is fabricated.

## Midscene Visual Exploration

Add one exact compatible `@midscene/web` version to `devDependencies` through pnpm, updating
`package.json` and `pnpm-lock.yaml` together. The implementation plan must record the exact version
selected from the package registry and its compatibility evidence; `@latest` is forbidden.

Midscene uses:

- a separate `playwright.midscene.config.ts`;
- tests beneath `tests/exploratory/`;
- the current managed REPLAY server;
- Chromium only, one worker, zero retries, bounded timeouts, and bounded planning cycles;
- an explicit opt-in environment flag and external model configuration; and
- a fixed ignored local report root.

Deterministic Playwright actions perform navigation, setup, and supported workflow execution.
Midscene is limited to visual exploration and visual assertions. Its report is not uploaded by
mandatory CI, its failure does not affect `verify:offline`, and no Midscene credential or model
output is committed.

## Error Handling

- Invalid impact input fails closed to a fixed advisory full-suite reason.
- Filesystem validation or atomic publication failure cannot change the Playwright result and
  produces no misleading completed report.
- Missing pull-request Git context yields a fixed unavailable result without a GitHub API fallback.
- Reporter input is treated as untrusted and reduced to allowlisted status, tag, count, and
  repository-relative path fields.
- Midscene startup, model, timeout, and report failures remain bounded inside the explicitly
  invoked exploratory command and expose no raw provider detail through repository artifacts.

## Testing

Implementation follows strict RED-GREEN-REFACTOR cycles.

Positive, negative, boundary, and regression tests must prove:

- known and unknown path mapping;
- stable deterministic ordering and byte-identical repeated reports;
- absolute-path, traversal, control-character, excessive-count, excessive-size, invalid-ref, and
  unmapped-input rejection;
- Markdown escaping and JSON/Markdown output limits;
- guarded roots and atomic publication;
- pull-request, non-pull-request, and missing-comparison behavior;
- passed, failed, timed-out, interrupted, skipped, and retried Playwright aggregation;
- expected, discovered, completed, failed, and missing tag reconciliation;
- the reporter never overrides Playwright status;
- impact analysis never filters the mandatory suite;
- Playwright Test Agents and Midscene remain outside `verify:offline`;
- CI permissions remain read-only and no GitHub API or mutation surface is introduced; and
- the isolated Midscene configuration uses REPLAY, Chromium, one worker, zero retries, explicit
  opt-in, bounded timeouts, and an ignored report root.

Focused tests run before affected suites. Broad filters must print or otherwise prove their
selected tests before their result is trusted.

## Acceptance Criteria

- LineageGuard runtime, routes, application-agent behavior, DataHub boundary, OpenAI boundary, and
  migration artifacts remain unchanged.
- The full existing Chromium suite still runs in mandatory CI.
- Ordinary CI remains deterministic, credential-free, and independent of live DataHub, OpenAI,
  Midscene, and GitHub APIs.
- Playwright Test Agent definitions come from the exact installed Playwright CLI.
- Impact reports are advisory, bounded, sanitized, deterministic, repository-relative, and
  atomically published.
- Unknown impact always fails closed to full-suite-required guidance.
- The reporter cannot change Playwright status.
- GitHub Actions retains read-only permissions and performs no GitHub API mutation.
- Midscene is exact-version-pinned, explicitly invoked, bounded, local-only, and excluded from
  `verify:offline`.
- Manifest and lockfile change together through pnpm.
- Generated output is ignored.
- Required focused tests, the affected suite, `pnpm verify:offline`, `git diff --check`, focused
  diff inspection, repository status inspection, and repository secret scanning pass.

## References

- [Playwright Test Agents](https://playwright.dev/docs/test-agents)
- [Playwright Reporter API](https://playwright.dev/docs/api/class-reporter)
- [Midscene Playwright integration](https://v1.midscenejs.com/integrate-with-playwright)
- [Midscene Web API reference](https://midscenejs.com/web-api-reference)
- [GitHub Actions job summaries](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary)
