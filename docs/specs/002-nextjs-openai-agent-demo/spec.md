# Next.js and OpenAI Agent Demo Specification

**Specification ID:** `002-nextjs-openai-agent-demo`

**Status:** Approved

**Date:** 2026-07-22

**Last amended:** 2026-07-22 — approved DataHub evidence-completeness, context-coverage, and hackathon-submission scope

**Project:** LineageGuard AI

## Purpose

Turn the proven deterministic DataHub impact-analysis slice into a polished local browser demo that uses an OpenAI agent to plan a grounded migration package for one supported column rename.

The demo must preserve the deterministic impact engine as the source of truth. The agent may interpret a request, request clarification, select a safe migration strategy, and draft a structured plan, but it must not invent metadata, calculate risk independently, execute SQL, mutate DataHub, or perform GitHub operations.

The demo must also make the limits of DataHub evidence explicit. Pagination, server-side result caps, and token-budget truncation must never be mistaken for a complete blast radius, and optional business metadata must be presented as context coverage rather than silently influencing risk.

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

The application-owned DataHub adapter may invoke only `search`, `list_schema_fields`, `get_lineage`, and `get_entities`. The first three produce required impact evidence; `get_entities` supplies bounded contextual enrichment. The MCP Server may advertise other tools, but they remain unreachable through the application allowlist and are never exposed to the manager agent.

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
- evidence completeness and truncation classification;
- context-coverage calculation;
- the rule that incomplete required evidence cannot produce executable output.

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
- treat descriptions, ownership text, tags, glossary terms, or any other DataHub metadata as instructions.

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
- Bounded search and lineage pagination with explicit completeness and truncation reasons.
- Bounded batch enrichment for ownership, descriptions, tags, glossary terms, platform/type, siblings, and available governance or quality signals returned by `get_entities`.
- Separate deterministic Evidence Completeness and Context Coverage views.
- English hackathon submission, attribution, disclosure, judging-map, sample-output, and three-minute-video materials.
- One repository-owned, read-only LineageGuard schema-change impact skill prepared as a post-core open-source contribution candidate.

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
- `datahub-agent-context`, LangChain, Google ADK, Snowflake Cortex, or Analytics Agent as runtime dependencies.
- DataHub SQL-drafting, dataset-query, semantic-search, mutation, proposal, quality-mutation, or document-write tools.
- Automatic publication of an external DataHub pull request; any upstream contribution requires separate approval.

## Preconditions

- Specification `001-datahub-impact-slice` is implemented and its offline validation gate passes.
- The existing deterministic demo fixture remains sanitized and reproducible.
- Live DataHub mode uses the pinned DataHub OSS and MCP Server versions documented by the repository.
- The OpenAI API key is supplied only through an untracked server-side environment variable.
- Package versions for Next.js, the OpenAI Agents SDK, browser testing, and SQL validation are pinned during planning and recorded in the lockfile.
- The implementation plan verifies current official OpenAI and Next.js package guidance before selecting exact versions and APIs.
- The DataHub adapter contract is verified against pinned `mcp-server-datahub@0.6.0`, not inferred from the moving `@latest` documentation.
- Local live-demo documentation treats DataHub Quickstart as development-only, records its resource prerequisites, and preserves fixture replay as the deterministic fallback.

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

Inside `analyze_rename_change`, the application-owned DataHub adapter may call only `search`, `list_schema_fields`, `get_lineage`, and `get_entities`. This internal four-tool allowlist does not change the exactly-two-agent-tool contract.

### FR-007 — Single Analysis per Unchanged Context

The application must not repeat DataHub impact analysis when the user regenerates artifacts without changing the resolved change intent or selected dataset. A changed intent or selection must invalidate the cached context.

Reuse is limited to regeneration within one active workflow lineage. A new top-level run must query DataHub again so metadata changes can produce a new context hash.

### FR-008 — Validated ChangeContext

Before generation, the application must build a versioned `ChangeContext` containing at least:

- original request and normalized change intent;
- selected dataset URN, platform, environment, a bounded known-schema summary, and a deterministic fingerprint/count for the full collected schema;
- verified source field and target field name;
- normalized downstream evidence;
- deterministic impact assessment;
- facts, assumptions, unknowns, and evidence identifiers;
- deterministic risk-policy decision;
- per-operation search, schema, table-lineage, and column-lineage completeness;
- bounded truncation reasons and evidence provenance including tool, URN, direction, depth, page, and timestamp;
- bounded entity context and a deterministic context-coverage summary;
- context schema version and stable context hash.

Raw MCP payloads and secrets must not be included.

The stable context hash must include semantic evidence, normalized entity context, completeness state, and Context Coverage. It must exclude timestamps, durations, token counts, trace call IDs, page-request timestamps, and other volatile telemetry.

### FR-009 — Deterministic Risk Policy

The application must map the existing score to an advisory decision without changing the existing impact formula:

| Score  | Advisory decision          |
| ------ | -------------------------- |
| 0–39   | `PROCEED_WITH_REVIEW`      |
| 40–74  | `MANUAL_APPROVAL_REQUIRED` |
| 75–100 | `BLOCK_DIRECT_RENAME`      |

A high score may still produce a reviewable staged package, but it must not be labeled ready for unattended execution.

Incomplete collection must not change the existing score formula; the score represents collected evidence and must be labeled as a lower bound when applicable. If search or schema evidence is incomplete, the package must be `NON_EXECUTABLE_TEMPLATE`. If only table or column lineage is incomplete, `ADVISORY_ONLY` is the maximum classification. Missing optional entity context may reduce Context Coverage and add explicit unknowns, but it must not alter the impact score.

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

The nested deterministic analysis status, including `COMPLETED_WITH_LIMITATIONS`, `INSUFFICIENT_METADATA`, or `INCOMPLETE_EVIDENCE`, must remain available to the UI and generation policy without being overwritten by the overall workflow status. Status precedence is: any required collection dimension incomplete produces `INCOMPLETE_EVIDENCE`; otherwise preserve the existing derivation.

### FR-022 — Failure Preservation

If OpenAI generation or artifact validation fails after deterministic analysis succeeds, the impact report and sanitized diagnostic findings must remain available. Model failure must not discard a valid DataHub result.

### FR-023 — Activity Log

The UI must show concise factual activity entries for state transitions, application tool calls, durations, and success or failure. It must not display hidden reasoning, chain-of-thought, secrets, or raw provider traces.

### FR-024 — Impact Presentation

The UI must show score, level, confidence, risk factors, advisory decision, confirmed downstream count, evidence level, assumptions, and unknowns directly from deterministic results.

Agent-generated explanation must be visually subordinate to these authoritative values.

Evidence Completeness and Context Coverage must be shown separately from score, risk, and confidence. The UI must not visually merge metadata richness with blast-radius completeness.

### FR-025 — Artifact Experience

The UI must provide separate previews for the four required artifacts and allow each artifact to be copied and downloaded after validation.

Unvalidated drafts must be visibly labeled and must not use the completed visual state.

### FR-026 — Evidence Experience

The UI must list relevant DataHub assets and evidence identifiers supporting the package, while preserving the distinction between table-level and column-level evidence.

Grounded entity context from `get_entities` may be displayed only with its source URN and retrieval state. The UI must distinguish metadata that is absent on a successfully retrieved entity from metadata that is unknown because enrichment was incomplete.

### FR-027 — Local Persistence

Each run must be written beneath a run-specific directory under the configured runs root. The system must persist final artifacts, sanitized metadata, state history, evidence references, validation findings, and artifact hashes.

The validated package must be committed atomically behind a package manifest. All final files and their completed snapshot must first be written to a run-local staging directory; the manifest must hash that metadata, and readers must verify that it parses as `COMPLETED`. Only a successful atomic rename may make the package visible. The workflow may transition to `COMPLETED` and emit its terminal snapshot only after that commit succeeds. A commit that fails or is interrupted before rename must remove the staging directory, transition from validation to `ARTIFACT_WRITE_FAILED` or `CANCELLED`, and expose no package downloads.

Cancellation or timeout may preserve a sanitized impact report or debugging material outside the final package, but it must not finalize, expose as completed, or offer downloads for the validated four-file package.

### FR-028 — Run Metadata

Sanitized run metadata must include timestamps, state transitions, provider, effective model, reasoning setting, prompt/schema versions, application tool calls, token usage and latency when available, context hash, evidence identifiers, validation results, execution classification, and artifact hashes.

It must also include the configured MCP package/version, reported server identity/version when available, per-operation page and item counts, completeness flags and reason codes, context-enrichment retrieval state, Context Coverage, the exact configured deadline policy, and bounded instantiated deadline events keyed by owner and attempt. It must not include raw descriptions, personal profile fields, email addresses, abort reasons, or volatile trace payloads unless separately required and sanitized.

### FR-029 — Fixture Replay Mode

The application must provide a clearly labeled fixture replay mode that can demonstrate the complete browser experience without DataHub, OpenAI, or secrets. Replay output must be committed, sanitized, deterministic, and distinguishable from a live agent run.

### FR-030 — Live Local Mode

The application must provide a documented local mode using the pinned DataHub stack and a server-side OpenAI API key. The UI must make the active mode visible.

### FR-031 — Configuration Validation

Startup and request handling must fail clearly when required live-mode configuration is absent or malformed. Configuration errors must not leak secret values.

### FR-032 — Cancellation and Timeouts

Browser cancellation or server timeouts must propagate to in-flight agent and DataHub operations where supported. A cancelled run must not later be marked completed or publish a partially validated package.

Positive finite deadlines must exist for MCP connection, the complete DataHub analysis, both Agents SDK tools, the agent runner, and the overall workflow. Configured policy and instantiated owner/attempt events must be persisted separately so a two-attempt generation cannot overflow or duplicate metadata. One classified abort chain must propagate browser cancellation and deadlines while preserving the originating owner through nested operations: a child interrupted by its parent must not relabel that parent expiry as browser cancellation. A connection deadline maps to `MCP_UNAVAILABLE`, a DataHub-read deadline maps to `DATAHUB_UNAVAILABLE`, an OpenAI deadline maps to `GENERATION_FAILED`, and browser cancellation maps to `CANCELLED`. Every owned timeout must reach the normal sanitized terminal persistence and best-effort event-delivery path. A deadline or cancellation during optional `get_entities` enrichment remains terminal and must not be downgraded to a context gap.

The atomic rename of the fully staged package directory is the completion linearization point. An abort before that rename must close the owned MCP client or subprocess, preserve only sanitized diagnostics, prevent later state publication, remove staging, and write no final migration package. Once the rename succeeds, the validated completed package is irrevocably authoritative: a later disconnect may prevent final event delivery but must not relabel the run `CANCELLED`, overwrite completed metadata, or delete the package; reload must return the committed completion.

### FR-033 — Accessible Demonstration

The primary flow must be keyboard usable, preserve visible focus, expose meaningful labels and status semantics, and not rely on color alone to communicate risk or completion.

### FR-034 — Responsive Demonstration

The primary demo must remain usable on a typical laptop viewport and must not require horizontal scrolling to understand risk, state, or artifact content.

### FR-035 — Bounded MCP Pagination

Dataset search, schema retrieval, table lineage, and column lineage must use bounded pagination with validated offsets, returned counts, page progress, and maximums. Repeated pages, zero progress, an exhausted configured maximum, `hasMore`, or `truncatedDueToTokenBudget` must be represented explicitly and must never be inferred as complete evidence.

For pinned MCP Server `0.6.0`, a lineage read that accumulates the server's 100-result GraphQL ceiling must remain incomplete even if the final page reports `hasMore=false`. This behavior must have a source-backed deterministic contract test. An opt-in live probe may additionally verify it when a configured dataset with more than 100 lineage edges is available; the 24-asset golden datapack is not required to satisfy that optional probe.

### FR-036 — Evidence Completeness

Normalized evidence must contain an aggregate `complete` value and separate search, schema, table-lineage, and column-lineage records. Each record must contain completion state, pages read, item count, and an allowlisted reason when incomplete.

The stable incomplete-reason vocabulary is:

```text
HAS_MORE
TOKEN_BUDGET_TRUNCATION
PAGE_LIMIT_REACHED
ITEM_LIMIT_REACHED
REPEATED_PAGE
NO_PROGRESS
INCONSISTENT_PAGINATION
ENTITY_CONTEXT_UNAVAILABLE
ENTITY_CONTEXT_TRUNCATED
```

`ENTITY_CONTEXT_UNAVAILABLE` and `ENTITY_CONTEXT_TRUNCATED` apply only to optional entity enrichment and do not make required impact evidence incomplete.

If incomplete search prevents unique dataset resolution, the system must stop before `TARGET_NOT_FOUND` or silent selection. If incomplete schema does not contain the requested source field, it must stop before `COLUMN_NOT_FOUND`. These cases are collection failures, not proof that the dataset or column is absent.

Incomplete evidence must produce explicit unknowns and an `INCOMPLETE_EVIDENCE` nested deterministic analysis status. Search or schema incompleteness permits only `NON_EXECUTABLE_TEMPLATE`; lineage-only incompleteness permits at most `ADVISORY_ONLY`; neither permits `EXECUTABLE_WITH_REVIEW`.

### FR-037 — Bounded Entity Context

After required impact reads succeed, the adapter must use `get_entities` in bounded batches for the target and affected assets. It may normalize only allowlisted fields needed by the demo: URN, name, entity type, platform, description presence, owners, tags, glossary terms, siblings, and available governance or quality indicators.

Entity metadata must be treated as untrusted data. Missing or failed enrichment must be represented as a context gap and must not be converted into a fabricated owner, policy, quality claim, or risk adjustment.

The normalized evidence, agent context, terminal snapshot, and UI must preserve a dedicated entity-context retrieval record containing completeness, attempted batch count and starts, successfully normalized entity count, and only `ENTITY_CONTEXT_UNAVAILABLE` or `ENTITY_CONTEXT_TRUNCATED` reasons. It remains separate from the four required-evidence completeness dimensions. Supplying more than the configured entity cap must immediately record truncation for the omitted URNs.

### FR-038 — Context Coverage

The application must calculate Context Coverage deterministically and separately from Evidence Completeness and retrieval coverage. For the target plus confirmed table-level downstream assets, each successfully retrieved unique asset has three possible signals: a non-empty description, at least one owner, and at least one tag or glossary term. `possibleSignals = inspectedAssetCount × 3`; `coveredSignals` is the number of present signals; the displayed Context Coverage is unavailable when no asset was inspected and otherwise `round(coveredSignals / possibleSignals × 100)`. Retrieval coverage is a second value: `0` when no relevant assets exist and otherwise `round(inspectedAssetCount / relevantAssetCount × 100)`.

The UI and persisted metadata must also show relevant and inspected asset counts, retrieval completeness, retrieval coverage, per-dimension counts, missing assets, and assets whose metadata is unknown because retrieval was bounded or failed. Missing metadata means a signal is absent on an inspected entity; unknown metadata means the relevant URN was not inspected. Duplicate URNs must not affect either denominator. Quality and usage indicators are shown separately and are not part of either percentage.

Context Coverage is explanatory only in this slice. It must not modify the existing impact formula, advisory decision, or evidence completeness.

### FR-039 — MCP Capability and Read-Only Drift Check

After the MCP handshake, live mode must verify that `search`, `list_schema_fields`, `get_lineage`, and `get_entities` are advertised with `readOnlyHint=true`. MCP annotations are compatibility metadata rather than a security boundary; the application allowlist and explicit disabled-tool environment remain authoritative.

The subprocess environment must explicitly disable mutation, user, document, save-document, data-quality, and semantic-search surfaces supported by the pinned server. Additional advertised tools must be ignored.

### FR-040 — Hackathon Submission Package

The repository must contain English submission materials for the `Metadata-Aware Code Generation & Development` category: official-resource attribution, license and third-party disclosure, new-project and AI-tool disclosure, judging-criteria mapping, sample-output guide, live/replay explanation, submission checklist, and a timed video script shorter than three minutes.

Manual checklist items must include public-repository visibility, Apache-2.0 license detection, a free replay/test-build Project URL through the judging period, Devpost dates, final repository-wide secret scanning, and the immutable submission commit or tag. DataHub Community Slack outreach and the Devpost feedback survey are optional manual actions; neither may be represented as a submission requirement or completed contribution before it happens.

### FR-041 — Read-Only DataHub Skill Candidate

After the core browser demo passes its offline gate, the repository must include one English, Apache-2.0-compatible LineageGuard schema-change impact skill patterned after the official DataHub Skills format. It must preserve the same read-only, completeness-first, no-SQL-execution boundaries and must use actual pinned MCP parameter names.

The skill is a development and open-source contribution artifact, not a runtime dependency or a third agent tool. Publishing it upstream is deferred until separately approved.

## Artifact Execution Classifications

Every generated package must have exactly one classification:

| Classification            | Meaning                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `EXECUTABLE_WITH_REVIEW`  | Platform and semantics are confirmed; deterministic validators passed.      |
| `ADVISORY_ONLY`           | The package is grounded but risk policy requires manual coordination.       |
| `NON_EXECUTABLE_TEMPLATE` | Platform, semantics, or required facts are insufficient for executable SQL. |

No classification implies autonomous approval or execution.

`EXECUTABLE_WITH_REVIEW` additionally requires complete search, schema, table-lineage, and column-lineage evidence. Search or schema incompleteness forces `NON_EXECUTABLE_TEMPLATE`; lineage-only incompleteness permits at most `ADVISORY_ONLY`. Context Coverage may be partial because optional business metadata does not determine execution safety.

## Failure and Recovery Requirements

| Condition                                        | Required status                | Required behavior                                                                                                                   |
| ------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| DataHub is unavailable                           | `DATAHUB_UNAVAILABLE`          | Show local setup guidance; do not call generation without a validated context.                                                      |
| Deterministic analysis fails                     | `ANALYSIS_FAILED`              | Preserve sanitized diagnostics; do not generate a definitive package.                                                               |
| Dataset is ambiguous                             | `NEEDS_USER_CLARIFICATION`     | Show candidates and wait for explicit selection.                                                                                    |
| OpenAI is unavailable or times out               | `GENERATION_FAILED`            | Preserve the deterministic impact report and allow a bounded retry.                                                                 |
| Structured output is invalid                     | `GENERATION_FAILED`            | Apply bounded repair; fail without publishing final artifacts if repair is exhausted.                                               |
| Artifact validation fails                        | `VALIDATION_FAILED`            | Preserve draft and findings as debugging material, clearly marked unvalidated.                                                      |
| Artifact persistence fails                       | `ARTIFACT_WRITE_FAILED`        | Preserve the in-memory result and report only the sanitized run ID; never expose an absolute path.                                  |
| Platform is unknown or unsupported               | completed template result      | Produce `NON_EXECUTABLE_TEMPLATE`; do not emit unqualified executable SQL.                                                          |
| Browser connection is interrupted                | cancelled or recoverable run   | Avoid false completion and allow the user to retry or reopen a persisted terminal run.                                              |
| Required evidence is capped or truncated         | `INCOMPLETE_EVIDENCE` analysis | Preserve partial evidence and reasons; search/schema gaps force a template, while lineage-only gaps permit at most advisory output. |
| Incomplete search/schema prevents identity proof | `DATAHUB_UNAVAILABLE`          | Do not emit `TARGET_NOT_FOUND` or `COLUMN_NOT_FOUND`; request a complete retry before generation.                                   |
| Entity enrichment is partial                     | completed with context gaps    | Preserve required evidence; show bounded Context Coverage without changing risk.                                                    |
| DataHub deadline expires                         | `DATAHUB_UNAVAILABLE`          | Close MCP, retain sanitized timeout metadata, and publish no final package.                                                         |
| Required MCP tool or read-only hint drifts       | `MCP_UNAVAILABLE`              | Fail live startup or analysis before the first tool call; ignore all extra tools.                                                   |

## Security and Privacy Requirements

- `OPENAI_API_KEY` and DataHub credentials must remain server-side and untracked.
- The client must never receive provider credentials, MCP credentials, or unrestricted filesystem paths.
- Secrets must be redacted from logs, errors, traces, artifacts, fixtures, and metadata.
- Raw MCP responses must not be sent to the model when the normalized context is sufficient.
- Model input must be minimized to the supported request and normalized evidence needed for the migration decision.
- Agent and application tools must follow least privilege.
- The official DataHub MCP Server must remain read-only.
- The application must enforce its own four-name MCP allowlist; MCP `readOnlyHint` annotations must not be treated as authorization.
- Mutation, user, document, save-document, data-quality, and semantic-search MCP surfaces must be explicitly disabled when supported by the pinned server.
- All output paths must pass the existing safe-path boundary.
- Downloads must use a fixed allowlist of artifact filenames and a validated run identifier.
- Model output must be treated as untrusted input until schema and deterministic validation pass.
- Prompt-injection text present in metadata must be treated as data, not instructions.
- Entity descriptions, owner names, tags, glossary terms, related-document text, and quality messages must be length-bounded before model input and must never be interpolated into system or developer instructions.
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
- aggregate and per-operation evidence completeness;
- deterministic Context Coverage calculations;
- incomplete-evidence execution-classification blocking;
- bounded entity-context normalization.

### Contract Tests

Contract tests must cover:

- a fake agent provider returning valid structured output;
- malformed structured output;
- hallucinated identifiers and evidence references;
- bounded validation repair;
- conversion of existing analysis output into minimal `ChangeContext`;
- regeneration without repeated DataHub analysis;
- provider errors, timeouts, and cancellation.
- multi-page search and a second-page exact-name ambiguity;
- lineage `hasMore=true`, token-budget truncation, zero progress, repeated pages, and the configured result ceiling;
- `get_entities` batching, missing entities, unexpected fields, and partial enrichment;
- MCP tool-list drift and missing `readOnlyHint`;
- DataHub deadline expiry during connect and during a tool call;
- MCP close after abort or timeout.

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

The committed replay fixture must include deterministic completeness, context-coverage, and entity-context data sufficient to exercise the same browser contracts as live mode without claiming that replay performed live retrieval.

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
- visible separation of Evidence Completeness from Context Coverage;
- incomplete evidence never exposing a validated executable artifact;
- browser cancellation during a simulated DataHub call without later completion.

### Live Smoke Tests

Live DataHub and OpenAI checks must be opt-in, environment-gated, separately documented, and excluded from the required offline CI gate. Their output must be sanitized before it is retained.

The required golden live DataHub check must exercise the pinned MCP tool-list contract, normal bounded pagination metadata, and a real `AbortSignal.timeout` without relying only on a test-runner timeout. The pinned 100-result lineage ceiling is required in a source-backed deterministic contract test and is an additional opt-in live probe only when a separately configured dataset with more than 100 lineage edges is available.

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

### AC-016 — Fail-Closed Collection

Automated tests prove that continuation, token truncation, repeated or zero-progress pages, inconsistent pagination, and configured caps cannot be presented as complete search, schema, table-lineage, or column-lineage evidence.

### AC-017 — Completeness Authority

An `INCOMPLETE_EVIDENCE` analysis visibly labels collected counts as lower bounds and cannot produce `EXECUTABLE_WITH_REVIEW` or a direct breaking rename. Search or schema incompleteness produces only `NON_EXECUTABLE_TEMPLATE`.

### AC-018 — Deterministic Context Coverage

The golden replay produces the same Context Coverage percentage and per-dimension counts on repeated runs. Entity-context retrieval state, batch/item counts, and bounded reason codes are persisted and displayed separately. Missing metadata and unknown metadata retrieval are shown separately, and neither changes the verified 24/11/90 impact result.

### AC-019 — MCP Least Privilege

Live contract tests accept only the four application-owned read operations, reject a missing required tool or missing/false `readOnlyHint`, ignore extra advertised tools, and prove that the manager agent still receives exactly two high-level tools.

### AC-020 — Cancellation and Deadline Cleanup

Tests prove that browser cancellation before atomic rename, MCP connection timeout, DataHub-read timeout, nested generation/agent timeout, overall workflow timeout, and an injected mid-package write failure reach the correct sanitized terminal path, close owned resources, cannot later publish `COMPLETED`, remove staging data, and leave no committed manifest or downloadable finalized migration package. A separate race test proves that cancellation immediately after rename cannot relabel or delete the already committed completed package.

### AC-021 — Submission Readiness

The repository contains the complete English hackathon submission package, sanitized sample outputs, current dated checklist, and a contribution-ready local read-only LineageGuard DataHub Skill candidate without prohibited operations, false bonus claims, or unapproved external publication.

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
- A hardened MCP capability, pagination, deadline, and cleanup boundary.
- Versioned Evidence Completeness, normalized entity-context, and deterministic Context Coverage schemas.
- A replay case demonstrating incomplete evidence without executable output.
- An English Devpost submission pack with attribution, disclosures, judging map, checklist, sample-output guide, and sub-three-minute script.
- One repository-owned, read-only LineageGuard schema-change impact skill prepared for separate upstream review.

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
- no secret, private trace, or sensitive environment value is present in tracked files or reachable repository history;
- every required collection dimension is either proven complete or represented with an allowlisted incomplete reason;
- incomplete evidence cannot produce `EXECUTABLE_WITH_REVIEW`, and search or schema incompleteness cannot produce executable SQL;
- the pinned live MCP handshake proves all four required tools are read-only while all extra tools remain unreachable;
- Context Coverage is deterministic, distinguishes absent from unknown metadata, and does not change risk;
- cancellation before the atomic package rename, every configured pre-commit deadline, and injected persistence failure close owned resources and leave no finalized package or committed manifest; cancellation after the rename preserves the manifest-gated completed package as authoritative;
- submission documents pass their dated Devpost, license, attribution, disclosure, and secret-scan checklist;
- the repository-owned skill passes review for exact pinned parameters, read-only behavior, English content, and absence of SQL execution or autonomous approval.

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
- exact positive finite MCP connection, DataHub-analysis, and generation deadlines within the approved 90-second agent execution envelope, plus a 95-second outer workflow/persistence grace deadline;
- exact positive search, schema, lineage, and entity-enrichment page, item, batch, and response-size limits;
- the bounded allowlist of entity-context fields and maximum text lengths;
- whether reported MCP server identity/version is available through the pinned SDK handshake in addition to the configured package pin;
- the final repository path and validation command for the local contribution-candidate LineageGuard DataHub Skill.

These are technical-plan decisions. They must not broaden the approved product scope or weaken the safety boundaries in this specification.

## Traceability

This specification extends `001-datahub-impact-slice` and is derived from the approved design discussion and `PROJECT_BRIEF.md`, especially its requirements for a browser demo, agentic workflow, DataHub grounding, migration artifacts, Snowflake-aware safety, error handling, testing, and preservation of deterministic facts.

The 2026-07-22 amendment was validated against the official DataHub Quickstart, pinned MCP Server `0.6.0` source and release, Agent Context Kit guidance, DataHub Skills repository, Analytics Agent repository, official sample datasets, and the Build with DataHub Devpost rules and resources. Those sources are implementation references and attribution targets; none is added as a new runtime dependency by this amendment.
