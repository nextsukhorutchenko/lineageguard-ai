# Permanent Repository Engineering Rules Design

**Date:** 2026-07-23

**Decision:** Compact hybrid engineering baseline in the root `AGENTS.md`

**Status:** Approved

## Context

LineageGuard AI already uses the root `AGENTS.md` as a durable repository
router for issue tracking, triage labels, and domain documentation. A separate
approved design and plan will add three repository workflow skills and their
mandatory routing rules.

The repository now also needs a stable engineering baseline that prevents
implementation drift across fresh Codex sessions. The baseline must cover
authority, scope control, testing, trust boundaries, secrets, external side
effects, CI hardening, completion evidence, and repository language without
copying time-sensitive product details from approved specifications and plans.

Current Codex guidance recommends keeping `AGENTS.md` practical and concise,
using it for durable repository conventions, constraints, verification, and
definition-of-done rules. Repeated workflows belong in skills, while
feature-specific facts belong in specifications, accepted architecture
decisions, and implementation plans.

The project owner selected a hybrid enforcement model:

- safety, authority, permissions, trust boundaries, and verification honesty
  are mandatory `MUST` rules; and
- maintainability and design preferences are concise `SHOULD` rules that allow
  a documented exception when an approved specification or architecture
  decision requires one.

## Goals

- Make the repository's durable engineering expectations available in every
  Codex session.
- Fail closed on scope, permission, secret, trust-boundary, and verification
  ambiguity.
- Keep ordinary development and CI deterministic, offline, and
  credential-free.
- Preserve strict TypeScript and repository quality gates.
- Require evidence before completion claims.
- Keep the root instructions concise enough to be read and applied reliably.
- Compose cleanly with the approved repository workflow skills.
- Keep all added repository content in English while preserving Ukrainian
  communication with the project owner.

## Non-Goals

- Claiming that process rules can guarantee defect-free software.
- Replacing approved product specifications, plans, accepted architecture
  decisions, or repository workflow skills.
- Copying current model names, dependency versions, ports, tool names,
  operation allowlists, timeouts, retry counts, branch names, worktree paths,
  task numbers, hackathon dates, or live-environment state into `AGENTS.md`.
- Changing application behavior, dependencies, CI, DataHub, MCP, OpenAI, or
  submission scope.
- Adding an exhaustive engineering handbook to the root instructions.
- Adding brittle exact-prose tests for every `AGENTS.md` sentence.

## Considered Approaches

### A. Compact normative baseline in `AGENTS.md`

Keep a small set of durable `MUST` and `SHOULD` rules directly in the root
instructions. Refer to specifications, plans, decisions, package metadata, and
skills for changing details.

**Advantages**

- Critical rules are loaded with the repository instructions.
- Clear enforcement language.
- Low context and maintenance cost.
- No extra discovery hop for safety constraints.
- Compatible with the planned workflow-skill routing block.

**Disadvantages**

- Requires discipline to keep transient facts out.
- Some detailed rationale remains in authority documents rather than the root
  file.

### B. Router-only `AGENTS.md`

Keep only links in `AGENTS.md` and move the complete policy into a separate
engineering document.

**Advantages**

- Smallest root file.
- More room for explanations in the linked document.

**Disadvantages**

- Critical rules require an additional read.
- Greater risk that a fresh agent applies the router but misses the policy.
- Safety requirements are less visible during routine work.

### C. Full engineering handbook in `AGENTS.md`

Put detailed architecture, product, toolchain, security, testing, operational,
and submission instructions in one file.

**Advantages**

- One apparent source for all guidance.
- Extensive detail is immediately searchable.

**Disadvantages**

- High context cost.
- Rapidly becomes stale.
- Duplicates specifications, plans, skills, and configuration.
- Creates frequent merge conflicts and contradictory sources of truth.

## Decision

Use Approach A: a compact normative baseline in the root `AGENTS.md`.

The file will state permanent engineering rules directly and route changing
details to their authoritative repository artifacts. It will not become a
product specification or operational runbook.

## Instruction Precedence and Authority

The permanent rules must respect higher-priority runtime instructions. Within
the repository, they define this authority model:

1. The applicable approved feature specification governs product scope and
   acceptance criteria; an explicitly documented supersession controls when
   more than one specification addresses the same behavior.
2. An accepted architecture decision governs its architectural concern unless
   a later approved specification or decision explicitly supersedes it.
3. An approved implementation plan governs execution order and verification but
   cannot broaden an approved specification.
4. `PROJECT_BRIEF.md` provides project context and intent but cannot override a
   newer approved specification or decision.
5. `AGENTS.md` governs repository process and durable engineering constraints;
   it does not create new product authority.

When applicable authority files conflict or leave a permission-sensitive
decision ambiguous, Codex must stop, report the conflict, and request approval
instead of silently selecting or combining behavior.

## Permanent Rule Set

### 1. Authority and Scope

The root instructions will require agents to:

- read the applicable approved specification, accepted decisions, approved
  plan section, and domain guidance before changing behavior;
- implement the smallest safe change that satisfies the approved acceptance
  criteria;
- avoid unrelated refactors, dependency additions, permission expansion, and
  external actions;
- propose and obtain owner approval for an amendment to the authoritative
  specification, decision, or plan before making a material deviation;
- preserve unrelated user changes; and
- avoid destructive filesystem or Git operations without explicit
  authorization.

### 2. Toolchain and Code Quality

The root instructions will require agents to:

- treat `package.json`, the lockfile, TypeScript configuration, and CI workflow
  as current toolchain authority;
- preserve strict TypeScript, ESM, and existing quality gates instead of
  weakening them to make a change pass;
- use exact dependency versions, never introduce `@latest`, and update the
  manifest and lockfile together through the repository package manager; and
- preserve the repository's established relative-import convention.

Agents should prefer small cohesive modules, deterministic pure domain logic,
and explicit adapters at external boundaries. A different structure requires
approved authority and a documented reason.

### 3. Testing and Verification

The root instructions will require agents to:

- add or update tests for every behavior change and regression fix;
- use the smallest relevant test first, then expand to the affected suite and
  required repository gates;
- keep unit tests colocated and use `tests/` for cross-module, fixture,
  integration, and browser coverage according to existing repository
  conventions;
- keep mandatory tests and ordinary CI deterministic, offline,
  credential-free, and independent of live DataHub or OpenAI services;
- make live checks explicit, environment-gated, bounded, and separately
  reported;
- isolate temporary paths and clean up test resources; and
- verify what broad test filters selected before trusting their result.

### 4. Trust, AI, and Secret Boundaries

The root instructions will require agents to:

- treat user input, model output, MCP responses, provider errors, metadata, and
  persisted external content as untrusted;
- normalize, size-bound, strictly validate, and sanitize untrusted values
  before model input, decision use, persistence, rendering, download, or
  browser exposure;
- use strict structured schemas at AI and tool boundaries;
- keep deterministic application validation authoritative for critical
  decisions and published artifacts;
- keep credentials server-only, untracked, absent from client bundles, logs,
  fixtures, screenshots, generated artifacts, and tool arguments;
- keep only non-secret placeholders in example environment files;
- avoid exposing or persisting chain-of-thought, runtime user or model prompt
  contents, unsanitized MCP or provider handshakes and traces, control
  characters, and unrestricted native paths in application responses,
  browser/UI output, public CLI output, logs, persisted runs, downloads, and
  submission artifacts;
- permit committed versioned agent instructions and allowlisted, sanitized
  provider, model, MCP, and dependency version metadata when required by
  approved authority; and
- replace external dependency failures with bounded typed errors before they
  cross application boundaries.

### 5. External Effects and Persistence

The root instructions will require agents to:

- default external integrations to read-only and least privilege;
- avoid enabling mutations, SQL execution, unrestricted tools, repository
  automation, publication, or other external-state changes unless an approved
  specification requires them and the current action is authorized;
- enforce allowlists, timeouts, cancellation, and bounded retry behavior at
  external boundaries;
- constrain repository writes to validated roots and fixed or validated file
  names;
- use create-only or atomic final publication when partial output would be
  misleading; and
- never mark failed, incomplete, timed-out, or cancelled work as completed.

### 6. CI and Supply-Chain Safety

The root instructions will require agents to:

- keep GitHub Actions at least privilege;
- pin third-party actions to full commit SHAs;
- disable persisted checkout credentials unless an approved workflow requires
  them;
- use the frozen lockfile in CI;
- keep required CI free of secrets, live external services, and hidden mutable
  dependencies; and
- provide executable positive and negative tests when adding a new enforcement
  gate.

### 7. Repository Language

The root instructions will require:

- code, tests, comments, documentation, UI text, commits, and repository
  artifacts in English; and
- communication with the project owner in Ukrainian unless the owner requests
  another language.

## Definition of Done

The root `AGENTS.md` will define completion as all of the following:

1. The change is traceable to approved acceptance criteria and does not broaden
   authority.
2. Positive, negative, boundary, and regression tests relevant to the changed
   behavior exist and pass; documentation-only changes do not require
   artificial behavior tests.
3. The current repository and CI-mandated checks for the changed surface pass,
   with each command's exit status verified.
4. `git diff --check`, the focused diff, and repository status are inspected.
5. Secret scanning is run when the repository provides it, and no credentials
   or sensitive raw traces are introduced.
6. Documentation and authority artifacts are updated when contracts, behavior,
   architecture, or operator steps change.
7. Skipped, unavailable, stale, replay-only, and unexecuted checks are reported
   truthfully and are never described as passing.

## Placement and Composition

To avoid textual conflict with the already approved repository-skills plan, the
engineering sections will be inserted before the existing `## Agent skills`
section:

1. `## Engineering baseline`;
2. `## Definition of done`; and
3. the existing `## Agent skills` section.

The repository-skills plan can then add `### Repository workflow skills` after
the existing issue-tracker, triage-label, and domain-doc subsections without
moving or rewriting the engineering baseline.

The workflow-skill routing block owns workflow selection and compound ordering.
The engineering baseline owns durable repository behavior. Product
specifications and accepted decisions continue to own product constraints.

## Verification Strategy

This documentation change will be verified by:

1. formatting the modified Markdown with the repository formatter;
2. running the repository documentation or quality checks applicable to the
   changed file;
3. running `git diff --check`;
4. reviewing the complete `AGENTS.md` diff for duplicated, contradictory, or
   transient rules;
5. confirming the existing agent-skill links remain unchanged;
6. confirming no application, dependency, CI, or product-authority file
   changed; and
7. inspecting repository status before commit.

The implementation will not add exact-string tests for every policy sentence.
The planned repository-skill routing test may continue to protect its own
stable headings and route entries.

## Acceptance Criteria

1. The root `AGENTS.md` contains a concise `Engineering baseline`.
2. Mandatory rules use unambiguous normative language.
3. Advisory architecture guidance is distinguishable from mandatory safety
   rules.
4. The file defines repository authority and a fail-closed conflict rule.
5. The file covers testing, offline CI, untrusted input, strict schemas,
   secrets, external effects, safe persistence, CI hardening, and completion
   evidence.
6. The file defines English repository content and Ukrainian owner
   communication.
7. The definition of done prohibits unsupported completion claims.
8. No model, version, port, operation list, deadline, branch, task, or live
   status is embedded as permanent policy.
9. Existing issue-tracker, triage-label, and domain-document routes remain
   unchanged.
10. The approved repository-workflow-skill design and plan remain compatible.
11. Only the approved documentation files change.
12. Repository formatting and applicable verification pass.

## References

- [Codex best practices](https://learn.chatgpt.com/guides/best-practices.md)
- [OpenAI Agents SDK guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)
- [OpenAI Agents SDK tools](https://openai.github.io/openai-agents-js/guides/tools/)
- [OpenAI Agents SDK agent execution](https://openai.github.io/openai-agents-js/guides/running-agents/)
- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-js/guides/tracing/)
- [Next.js server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [DataHub MCP Server](https://docs.datahub.com/docs/features/feature-guides/mcp)
- [DataHub quickstart](https://docs.datahub.com/docs/quickstart)
- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [GitHub push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)
- [TypeScript `strict`](https://www.typescriptlang.org/tsconfig/strict.html)
