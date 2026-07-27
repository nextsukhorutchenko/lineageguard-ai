# README Agent-First Hero Design

**Status:** Approved

**Date:** 2026-07-27

**Authority:** Project-owner approval of the compact judging-first approach.

## Problem

The root README opens with the original deterministic CLI-first vertical-slice positioning. The
current product is a DataHub-grounded AI agent with a browser experience, a verified public replay,
an OpenAI-backed local live mode, deterministic impact authority, and four validated review-ready
artifacts.

The public Project URL currently appears only in the later fixture-replay section. A judge or new
visitor therefore has to read past setup and implementation detail before seeing the strongest
product proof.

## Goals

- Present LineageGuard AI as an agent product in the first sentence.
- Make the verified public replay the primary call to action.
- Show the golden `24 / 11 / 90` result and `BLOCK_DIRECT_RENAME` above the fold.
- Name all four validated artifacts above the fold.
- State the safety boundary without implying that the hosted replay is a live DataHub or OpenAI
  service.
- Preserve the detailed architecture, setup, verification, replay, and live-mode documentation
  below the hero.

## Non-Goals

- Do not change runtime behavior, UI behavior, tests, deployment configuration, or public evidence.
- Do not move or rewrite the detailed README sections below `## Architecture and Safety Boundary`.
- Do not describe the public replay as a live DataHub or OpenAI run.
- Do not add remote badges, screenshots, generated imagery, or dependencies.
- Do not change the supported single `rename_column` scenario or broaden product capability.

## Chosen Approach

Use a compact judging-first hero. Replace only the introductory content between the level-one
`LineageGuard AI` heading and `## Architecture and Safety Boundary`.

The hero has this information order:

1. agent-product outcome;
2. primary public-replay call to action;
3. explicit replay-versus-live disclosure;
4. golden deterministic result;
5. four validated artifact links;
6. concise safety boundary; and
7. links to architecture, deployment evidence, and local replay instructions.

This order lets a judge understand what the product does, try it, inspect its proof, and understand
its limits before reaching setup detail.

## Approved Hero Copy

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

## Evidence Authority

- The public URL and no-login replay status come from
  `docs/public-deployment-verification.md`.
- The golden `24 downstream`, `11 column-confirmed`, risk score `90`, critical level, and
  `BLOCK_DIRECT_RENAME` result come from the deterministic fixture and the approved agent-demo
  specification.
- The four public artifacts are exactly `migration-up.sql`, `migration-down.sql`,
  `validation.sql`, and `rollout-plan.md`.
- Replay remains visibly deterministic and credential-free. Live DataHub + OpenAI remains a local
  operator workflow.
- The deterministic engine, not the model, owns impact facts, score, level, and policy decision.

## Verification

- Confirm the diff changes only the root README introduction.
- Confirm every hero link resolves and the public URL matches the verified Project URL.
- Run `pnpm exec prettier --check README.md`.
- Run `pnpm vitest run scripts/validate-submission-assets.test.ts`.
- Run `pnpm submission:check`.
- Run `git diff --check`.
- Inspect the focused diff and repository status.
