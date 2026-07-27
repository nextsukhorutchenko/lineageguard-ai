# Documentation Map

Use the root [README](../README.md) for the product overview, public replay, setup, and supported
workflow. This map separates current guidance from historical execution records.

## Start Here

- [README](../README.md) — product overview, safety boundary, local setup, and public replay.
- [Judging map](judging-map.md) — official criteria, visible demo moments, and evidence.
- [Demo scenario](demo-scenario.md) — pinned environment, operator sequence, and 2:55 video script.

## Current Product Authority and Architecture

Current behavior is established by the applicable approved specification or later approved amendment
together with the implementation, tests, `package.json`, and CI.

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
