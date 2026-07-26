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
