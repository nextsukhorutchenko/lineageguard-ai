# Next.js and OpenAI Agent Demo Specification

**Specification ID:** `002-nextjs-openai-agent-demo`

**Status:** Approved

**Date:** 2026-07-22

**Project:** LineageGuard AI

## Purpose

Turn the proven deterministic DataHub impact-analysis slice into a polished local browser demo that uses an OpenAI agent to plan a grounded migration package for one supported column rename.

The demo must preserve the deterministic impact engine as the source of truth. The agent may interpret a request, request clarification, select a safe migration strategy, and draft a structured plan, but it must not invent metadata, calculate risk independently, execute SQL, mutate DataHub, or perform GitHub operations.

## Product Outcome

A data or backend engineer can propose renaming one known Snowflake column, inspect the DataHub-grounded impact and risk, follow the agent's visible progress, and download a validated migration package containing:

```text
migration-up.sql
migration-down.sql
validation.sql
rollout-plan.md
```

The golden demo must make DataHub's contribution visible and show why a direct rename is unsafe when the existing deterministic analysis reports critical downstream impact.

## User Story

As a data or backend engineer, I want an agent to turn a proposed column rename and its DataHub impact evidence into a safe, reviewable migration package so that I can plan the change without guessing about downstream dependencies or allowing an AI system to execute infrastructure changes.

## Approved Architecture

The repository remains one TypeScript `pnpm` package without a monorepo.

The approved application flow is:

```text
Next.js browser UI
  -> server-side agent route
  -> one OpenAI Agents SDK manager agent
  -> existing deterministic impact-analysis application service
  -> official DataHub MCP Server
  -> local DataHub OSS in read-only mode
  -> normalized ChangeContext
  -> structured MigrationPackageDraft
  -> deterministic Snowflake renderer and validators
  -> safe local run directory
  -> browser preview and download
```

The manager agent has only high-level, application-owned tools. It has no raw DataHub, filesystem, shell, database, or GitHub tool access.

The existing domain, DataHub adapter, evidence normalization, impact assessment, redaction, and safe artifact-writing modules remain authoritative. The browser and agent layers must reuse these modules rather than duplicate their behavior.

The OpenAI integration uses the official TypeScript Agents SDK and the Responses API path it provides. Agent output must use an explicit structured schema. The default model is configurable and initially set to `gpt-5.6-sol` with `medium` reasoning effort; the effective model and reasoning setting must be recorded in sanitized run metadata.

References consulted for this decision:

- <https://openai.github.io/openai-agents-js/>
- <https://developers.openai.com/api/docs/guides/latest-model>

## Domain Boundaries

### Deterministic Boundary

The following remain deterministic and must not be delegated to the model:

- dataset resolution after explicit user selection;
- source-column validation;
- evidence normalization;
- impact score, level, confidence, factors, and evidence gaps;
- risk-policy mapping;
- identifier validation and quoting;
- final SQL rendering;
- artifact validation;
- safe-path enforcement;
- secret redaction;
- state-transition validity.

### Agent Boundary

The agent may:

- convert a supported user request into a structured change intent;
- identify missing or ambiguous user input;
- invoke the deterministic impact-analysis tool;
- explain the resulting impact in concise user-facing language;
- select an allowed migration strategy consistent with risk and evidence;
- produce a structured migration-package draft;
- revise that draft in response to deterministic validation findings within a bounded retry policy.

The agent must not:

- override deterministic facts, risk, status, or validation findings;
- claim that table-level lineage proves column-level usage;
- invent datasets, schema fields, owners, lineage, dialect information, or downstream assets;
- produce an executable package when platform or required migration semantics are uncertain;
- execute generated SQL;
- mutate DataHub;
- write outside the application-owned run directory;
- access or operate on GitHub;
- expose private reasoning or chain-of-thought.

## Supported Scenario

The fully supported slice remains exactly one change kind:

```text
rename_column
```

The golden request is:

```text
Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details
```

The verified target is:

- dataset URN: `urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)`;
- platform: `snowflake`;
- source field: `customer_id`;
- source native type: `NUMBER(38,0)`;
- lineage bound: two downstream hops.

Against the committed sanitized fixture, the existing deterministic engine reports:

- 24 table-level downstream assets;
- 11 column-lineage assets;
- risk score 90;
- critical risk.

These fixture-specific values must not be hard-coded into application logic.

## In Scope

- A local Next.js browser experience in the existing TypeScript package.
- One server-side OpenAI manager agent using structured output.
- Reuse of the existing live DataHub MCP and fixture-backed catalog boundaries.
- A typed `ChangeContext` containing only validated facts, deterministic conclusions, explicit assumptions, and unknowns.
- A typed `MigrationPackageDraft` generated by the agent.
- A deterministic Snowflake-first artifact renderer.
- Deterministic package validation and evidence-reference validation.
- Preview, copy, and download for all four required artifacts.
- A sanitized activity log showing state transitions, tool names, timings, and outcomes without private reasoning.
- Local filesystem run persistence beneath the configured runs root.
- A live local mode using DataHub OSS and OpenAI.
- A clearly labeled fixture replay mode for offline CI, browser tests, and a fallback demonstration.
- Unit, contract, fixture integration, browser acceptance, and opt-in live smoke tests.

## Out of Scope

- Hosted deployment or a public hosted demo.
- Authentication, authorization, or multi-user storage.
- Schema changes other than `rename_column`.
- Full executable support for SQL dialects other than Snowflake.
- Automatic SQL execution or database credentials.
- DataHub mutation or document write-back.
- GitHub issue, branch, commit, or pull-request automation.
- A second reviewer agent or other multi-agent orchestration.
- An evaluation dashboard or automated prompt-optimization system.
- Production-grade durable queues, distributed workers, or external run storage.
- Autonomous approval of a breaking schema change.

## Preconditions

- Specification `001-datahub-impact-slice` is implemented and its offline validation gate passes.
- The existing deterministic demo fixture remains sanitized and reproducible.
- Live DataHub mode uses the pinned DataHub OSS and MCP Server versions documented by the repository.
- The OpenAI API key is supplied only through an untracked server-side environment variable.
- Package versions for Next.js, the OpenAI Agents SDK, browser testing, and SQL validation are pinned during planning and recorded in the lockfile.
- The implementation plan verifies current official OpenAI and Next.js package guidance before selecting exact versions and APIs.

## Functional Requirements

### FR-001 — Single-Page Demo

The application must provide one focused browser page containing change input, agent activity, deterministic impact assessment, generated artifacts, and supporting evidence.

### FR-002 — Supported Input

The page must accept a dataset identifier or hint, source column, target column, and a constrained natural-language request representing exactly one `rename_column` change.

### FR-003 — Structured Intent

The server must convert input into the existing validated `rename_column` intent. Unsupported, incomplete, or multi-change requests must stop before impact analysis.

### FR-004 — User Clarification

When dataset resolution is ambiguous, the system must return `NEEDS_USER_CLARIFICATION` with deterministic candidate identifiers and wait for explicit user selection. The agent must not select the first candidate or silently guess.

### FR-005 — Server-Only OpenAI Access

OpenAI requests must originate only from server-side code. The API key and provider client must never be included in browser bundles or browser-readable responses.

### FR-006 — Bounded Agent Tools

The manager agent must receive exactly two application-owned tools:

- `analyze_rename_change`, which invokes the existing deterministic analysis boundary and returns a validated `ChangeContext` or a typed clarification/failure result;
- `generate_migration_package`, which accepts a structured draft, invokes deterministic rendering and validation, and returns a typed package result or sanitized validation findings.

It must not receive raw MCP, filesystem, shell, database, or GitHub tools. Any internal persistence performed by an application-owned tool must pass the existing safe-path boundary and must not expose unrestricted file access to the model.

### FR-007 — Single Analysis per Unchanged Context

The application must not repeat DataHub impact analysis when the user regenerates artifacts without changing the resolved change intent or selected dataset. A changed intent or selection must invalidate the cached context.

### FR-008 — Validated ChangeContext

Before generation, the application must build a versioned `ChangeContext` containing at least:

- original request and normalized change intent;
- selected dataset URN, platform, environment, and known schema;
- verified source field and target field name;
- normalized downstream evidence;
- deterministic impact assessment;
- facts, assumptions, unknowns, and evidence identifiers;
- deterministic risk-policy decision;
- context schema version and stable context hash.

Raw MCP payloads and secrets must not be included.

### FR-009 — Deterministic Risk Policy

The application must map the existing score to an advisory decision without changing the existing impact formula:

| Score  | Advisory decision          |
| ------ | -------------------------- |
| 0–39   | `PROCEED_WITH_REVIEW`      |
| 40–74  | `MANUAL_APPROVAL_REQUIRED` |
| 75–100 | `BLOCK_DIRECT_RENAME`      |

A high score may still produce a reviewable staged package, but it must not be labeled ready for unattended execution.

### FR-010 — Structured Agent Output

The agent must return a versioned `MigrationPackageDraft` validated against an explicit schema. It must contain strategy, rationale, ordered rollout stages, rollback intent, validation checks, evidence references, warnings, and execution classification.

Free-form model text must not be passed directly to final artifact writers.

### FR-011 — Allowed Migration Strategies

The first implementation must support a small, enumerated strategy set appropriate to a Snowflake column rename. Strategy selection must be consistent with the risk policy and available evidence.

At minimum, a critical-risk result must select a staged compatibility strategy or a non-executable advisory template. It must not present a direct breaking rename as approved for immediate execution.

### FR-012 — Snowflake-First Rendering

Confirmed Snowflake context may be rendered using a deterministic Snowflake renderer. Dataset, table, and column identifiers must be sourced from validated context and quoted by application code.

The model must not interpolate arbitrary identifiers into final executable SQL.

### FR-013 — Unknown Platform Safety

If the platform is missing, unsupported, or inconsistent, the application must produce `NON_EXECUTABLE_TEMPLATE` output with an explicit explanation. It must not emit unqualified executable SQL.

### FR-014 — Migration Up Artifact

`migration-up.sql` must contain a forward migration or staged compatibility template consistent with the confirmed platform, selected strategy, known schema facts, and risk decision.

Risky or manual steps must be visibly labeled and linked to evidence or a deterministic validation finding.

### FR-015 — Migration Down Artifact

`migration-down.sql` must contain a compatible rollback path or an explicit, prominent explanation when safe rollback cannot be guaranteed.

The rollback must not claim restoration of data that the forward plan could destroy.

### FR-016 — Validation Artifact

`validation.sql` must contain applicable pre-migration and post-migration checks derived from known schema facts and the selected strategy. It must not invent referential, uniqueness, or nullability guarantees absent from evidence.

### FR-017 — Rollout Plan Artifact

`rollout-plan.md` must contain preparation, staged change, downstream migration, validation, rollback triggers, approval gates, and completion criteria appropriate to the risk decision.

For `BLOCK_DIRECT_RENAME`, it must explicitly require human approval and downstream coordination before any breaking step.

### FR-018 — Evidence Grounding

Every named dataset, schema field, downstream asset, and impact assertion in the generated package must be grounded in the supplied `ChangeContext`. Every material migration decision must cite one or more valid evidence identifiers or be clearly labeled as an assumption or recommendation.

### FR-019 — Deterministic Validation

Before a package is marked completed, deterministic validators must verify at least:

- all four files are present;
- the structured draft conforms to its schema;
- referenced evidence identifiers exist;
- identifiers belong to validated context;
- executable-mode SQL uses the supported Snowflake strategy;
- unresolved placeholders are absent in executable mode;
- rollback and forward strategies are consistent;
- validation checks use known fields;
- rollout policy matches the deterministic risk decision;
- prohibited destructive or autonomous operations are absent;
- final output paths remain beneath the configured run root.

### FR-020 — Bounded Repair

If structured generation fails validation, the application may return sanitized findings to the agent for a small, explicit number of repair attempts. Exhausting the limit must produce `VALIDATION_FAILED`; it must not bypass validators.

The retry count is a technical-plan decision and must be recorded in run metadata.

### FR-021 — Run State Model

The agent workflow must use a new `WorkflowStatus` that is distinct from and preserves the existing deterministic `AnalysisRun.status`. It must use valid transitions among:

```text
DRAFT
RESOLVING_CONTEXT
NEEDS_USER_CLARIFICATION
ANALYZING_IMPACT
GENERATING_ARTIFACTS
VALIDATING_ARTIFACTS
COMPLETED
```

Failures or cancellation must use the applicable terminal workflow state:

```text
DATAHUB_UNAVAILABLE
MCP_UNAVAILABLE
TARGET_NOT_FOUND
COLUMN_NOT_FOUND
ANALYSIS_FAILED
GENERATION_FAILED
VALIDATION_FAILED
ARTIFACT_WRITE_FAILED
CANCELLED
```

The nested deterministic analysis status, including `COMPLETED_WITH_LIMITATIONS` or `INSUFFICIENT_METADATA`, must remain available to the UI and generation policy without being overwritten by the overall workflow status.

### FR-022 — Failure Preservation

If OpenAI generation or artifact validation fails after deterministic analysis succeeds, the impact report and sanitized diagnostic findings must remain available. Model failure must not discard a valid DataHub result.

### FR-023 — Activity Log

The UI must show concise factual activity entries for state transitions, application tool calls, durations, and success or failure. It must not display hidden reasoning, chain-of-thought, secrets, or raw provider traces.

### FR-024 — Impact Presentation

The UI must show score, level, confidence, risk factors, advisory decision, confirmed downstream count, evidence level, assumptions, and unknowns directly from deterministic results.

Agent-generated explanation must be visually subordinate to these authoritative values.

### FR-025 — Artifact Experience

The UI must provide separate previews for the four required artifacts and allow each artifact to be copied and downloaded after validation.

Unvalidated drafts must be visibly labeled and must not use the completed visual state.

### FR-026 — Evidence Experience

The UI must list relevant DataHub assets and evidence identifiers supporting the package, while preserving the distinction between table-level and column-level evidence.

### FR-027 — Local Persistence

Each run must be written beneath a run-specific directory under the configured runs root. The system must persist final artifacts, sanitized metadata, state history, evidence references, validation findings, and artifact hashes.

### FR-028 — Run Metadata

Sanitized run metadata must include timestamps, state transitions, provider, effective model, reasoning setting, prompt/schema versions, application tool calls, token usage and latency when available, context hash, evidence identifiers, validation results, execution classification, and artifact hashes.

### FR-029 — Fixture Replay Mode

The application must provide a clearly labeled fixture replay mode that can demonstrate the complete browser experience without DataHub, OpenAI, or secrets. Replay output must be committed, sanitized, deterministic, and distinguishable from a live agent run.

### FR-030 — Live Local Mode

The application must provide a documented local mode using the pinned DataHub stack and a server-side OpenAI API key. The UI must make the active mode visible.

### FR-031 — Configuration Validation

Startup and request handling must fail clearly when required live-mode configuration is absent or malformed. Configuration errors must not leak secret values.

### FR-032 — Cancellation and Timeouts

Browser cancellation or server timeouts must propagate to in-flight agent and DataHub operations where supported. A cancelled run must not later be marked completed or publish a partially validated package.

### FR-033 — Accessible Demonstration

The primary flow must be keyboard usable, preserve visible focus, expose meaningful labels and status semantics, and not rely on color alone to communicate risk or completion.

### FR-034 — Responsive Demonstration

The primary demo must remain usable on a typical laptop viewport and must not require horizontal scrolling to understand risk, state, or artifact content.

## Artifact Execution Classifications

Every generated package must have exactly one classification:

| Classification            | Meaning                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `EXECUTABLE_WITH_REVIEW`  | Platform and semantics are confirmed; deterministic validators passed.      |
| `ADVISORY_ONLY`           | The package is grounded but risk policy requires manual coordination.       |
| `NON_EXECUTABLE_TEMPLATE` | Platform, semantics, or required facts are insufficient for executable SQL. |

No classification implies autonomous approval or execution.

## Failure and Recovery Requirements

| Condition                          | Required status              | Required behavior                                                                      |
| ---------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| DataHub is unavailable             | `DATAHUB_UNAVAILABLE`        | Show local setup guidance; do not call generation without a validated context.         |
| Deterministic analysis fails       | `ANALYSIS_FAILED`            | Preserve sanitized diagnostics; do not generate a definitive package.                  |
| Dataset is ambiguous               | `NEEDS_USER_CLARIFICATION`   | Show candidates and wait for explicit selection.                                       |
| OpenAI is unavailable or times out | `GENERATION_FAILED`          | Preserve the deterministic impact report and allow a bounded retry.                    |
| Structured output is invalid       | `GENERATION_FAILED`          | Apply bounded repair; fail without publishing final artifacts if repair is exhausted.  |
| Artifact validation fails          | `VALIDATION_FAILED`          | Preserve draft and findings as debugging material, clearly marked unvalidated.         |
| Artifact persistence fails         | `ARTIFACT_WRITE_FAILED`      | Preserve the in-memory result and report the attempted safe path.                      |
| Platform is unknown or unsupported | completed template result    | Produce `NON_EXECUTABLE_TEMPLATE`; do not emit unqualified executable SQL.             |
| Browser connection is interrupted  | cancelled or recoverable run | Avoid false completion and allow the user to retry or reopen a persisted terminal run. |

## Security and Privacy Requirements

- `OPENAI_API_KEY` and DataHub credentials must remain server-side and untracked.
- The client must never receive provider credentials, MCP credentials, or unrestricted filesystem paths.
- Secrets must be redacted from logs, errors, traces, artifacts, fixtures, and metadata.
- Raw MCP responses must not be sent to the model when the normalized context is sufficient.
- Model input must be minimized to the supported request and normalized evidence needed for the migration decision.
- Agent and application tools must follow least privilege.
- The official DataHub MCP Server must remain read-only.
- All output paths must pass the existing safe-path boundary.
- Downloads must use a fixed allowlist of artifact filenames and a validated run identifier.
- Model output must be treated as untrusted input until schema and deterministic validation pass.
- Prompt-injection text present in metadata must be treated as data, not instructions.
- Telemetry or tracing that could send sensitive content to an external destination must be disabled by default or explicitly sanitized and documented.
- The UI must not expose hidden reasoning or chain-of-thought.

## Testing Requirements

### Unit Tests

Unit tests must cover:

- agent input and output schemas;
- valid and invalid state transitions;
- deterministic risk-policy mapping;
- context hashing and cache invalidation;
- Snowflake identifier validation and quoting;
- migration strategy selection constraints;
- artifact rendering and validation;
- evidence-reference validation;
- redaction and download-path safety.

### Contract Tests

Contract tests must cover:

- a fake agent provider returning valid structured output;
- malformed structured output;
- hallucinated identifiers and evidence references;
- bounded validation repair;
- conversion of existing analysis output into minimal `ChangeContext`;
- regeneration without repeated DataHub analysis;
- provider errors, timeouts, and cancellation.

### Fixture Integration Tests

An offline integration suite must exercise:

```text
sanitized DataHub fixture
  -> deterministic analysis
  -> fake agent
  -> Snowflake renderer
  -> validators
  -> persisted run
  -> browser-facing application boundary
```

The suite must not require network access, credentials, live DataHub, or OpenAI.

### Browser Acceptance Tests

Automated browser tests must cover:

- the successful golden replay flow;
- ambiguous dataset clarification;
- DataHub unavailable;
- OpenAI generation failure;
- artifact validation failure;
- visible live/replay mode labeling;
- artifact preview, copy, and download;
- keyboard navigation through the primary flow.

### Live Smoke Tests

Live DataHub and OpenAI checks must be opt-in, environment-gated, separately documented, and excluded from the required offline CI gate. Their output must be sanitized before it is retained.

## Acceptance Criteria

### AC-001 — Golden Browser Flow

Given fixture replay mode and the golden request, the browser completes the full workflow, displays the authoritative impact result, and presents four validated downloadable artifacts.

### AC-002 — Live Grounded Flow

Given healthy pinned local DataHub services and valid OpenAI configuration, the golden request invokes real DataHub analysis and an OpenAI agent, then produces a validated migration package without mutating DataHub or executing SQL.

### AC-003 — Verified Golden Facts

For the committed golden fixture, the UI displays 24 downstream assets, 11 column-lineage assets, score 90, critical risk, and `BLOCK_DIRECT_RENAME` directly from deterministic analysis.

### AC-004 — Safe Critical-Risk Strategy

For the golden result, the package uses a staged compatibility strategy or explicit advisory template, is not labeled safe for unattended execution, and includes human approval and downstream coordination gates.

### AC-005 — No Hallucinated Metadata

Tests prove that an agent draft containing an unknown dataset, field, downstream asset, or evidence identifier is rejected before final artifacts are published.

### AC-006 — Unknown Platform Safety

Given valid impact evidence without a supported confirmed platform, the system produces `NON_EXECUTABLE_TEMPLATE` and no unqualified executable SQL.

### AC-007 — Clarification Before Analysis Completion

Given multiple plausible datasets, the UI lists deterministic candidates, waits for explicit selection, and does not display a definitive impact conclusion or migration package before selection.

### AC-008 — Deterministic Authority

The model cannot change the deterministic score, level, confidence, evidence counts, risk-policy decision, or validation findings presented by the application.

### AC-009 — Generation Failure Preservation

Given an OpenAI failure after successful analysis, the browser retains the deterministic impact report, reports `GENERATION_FAILED`, and offers a bounded retry without repeating unchanged DataHub analysis.

### AC-010 — Validation Failure Safety

Given malformed or unsafe generated content, the final package is not marked completed or offered as validated, and sanitized findings remain available.

### AC-011 — Secret Safety

Automated tests confirm that representative OpenAI keys, DataHub tokens, passwords, and sensitive environment values do not appear in browser responses, artifacts, logs, traces, fixtures, or persisted metadata.

### AC-012 — Output and Download Safety

Automated tests confirm that malicious run identifiers, artifact filenames, or user input cannot read or write outside the configured runs directory.

### AC-013 — Replay Honesty

Fixture replay works without network access or credentials and is visibly labeled so it cannot be mistaken for a live OpenAI or DataHub run.

### AC-014 — Offline CI

Formatting, linting, type checking, unit tests, contract tests, fixture integration tests, browser tests, and production build pass in CI without secrets or external services.

### AC-015 — Repeatable Local Demo

English documentation enables a clean checkout to run both fixture replay and the opt-in live local demo with the required services and environment configuration.

## Required Deliverables

- One Next.js page implementing the approved demonstration flow.
- One server-side manager-agent boundary using the official OpenAI TypeScript Agents SDK.
- One provider interface with real and fake implementations.
- Versioned `ChangeContext` and `MigrationPackageDraft` schemas.
- One deterministic risk-policy adapter.
- One Snowflake-first strategy renderer and artifact validator set.
- Four generated example artifacts for the golden scenario.
- Sanitized run metadata and state history.
- Fixture replay mode.
- Offline automated tests, including browser acceptance tests.
- Opt-in live OpenAI smoke coverage.
- Updated English setup, configuration, architecture, safety, and demo documentation.

## Definition of Done

This specification is implemented only when:

- every functional requirement is implemented or explicitly verified as not applicable;
- every acceptance criterion is covered by automation or a documented live check where external services are required;
- the existing deterministic impact-analysis behavior and fixtures remain passing;
- the offline CI gate passes from a clean checkout without secrets;
- the golden fixture replay completes in the browser and produces all required artifacts;
- the live local demo completes with pinned DataHub services and OpenAI configuration;
- generated golden artifacts contain no facts absent from normalized evidence;
- the critical-risk golden result cannot be presented as approved for autonomous execution;
- DataHub remains read-only and no database execution capability exists;
- model output cannot bypass deterministic validation;
- browser bundles and responses contain no server credentials;
- output and download boundaries cannot escape the configured runs root;
- documentation clearly distinguishes live mode from fixture replay;
- no secret, private trace, or sensitive environment value is present in tracked files.

## Deferred Decisions

The implementation plan must decide, after verifying current package documentation:

- exact pinned Next.js, React, OpenAI Agents SDK, Playwright, and SQL-validation package versions;
- exact Next.js routing and server-streaming mechanism;
- the provider interface shape and dependency-injection boundary;
- the versioned schemas for `ChangeContext`, `MigrationPackageDraft`, run state, and persisted metadata;
- the enumerated Snowflake migration strategies and their deterministic render templates;
- the bounded generation-repair count, timeouts, and cancellation behavior;
- the exact prompt text and prompt versioning convention;
- the exact local run-directory layout and artifact manifest;
- the fixture replay transport and committed replay payload;
- whether safe sanitized OpenAI SDK tracing is retained or disabled entirely;
- the exact browser component structure and visual design tokens.

These are technical-plan decisions. They must not broaden the approved product scope or weaken the safety boundaries in this specification.

## Traceability

This specification extends `001-datahub-impact-slice` and is derived from the approved design discussion and `PROJECT_BRIEF.md`, especially its requirements for a browser demo, agentic workflow, DataHub grounding, migration artifacts, Snowflake-aware safety, error handling, testing, and preservation of deterministic facts.
