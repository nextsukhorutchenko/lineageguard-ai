# DataHub Impact Slice Specification

**Specification ID:** `001-datahub-impact-slice`

**Status:** Approved

**Date:** 2026-07-22

**Project:** LineageGuard AI

## Purpose

Prove that LineageGuard AI can use real DataHub metadata to evaluate one narrowly defined schema-change request and produce a grounded, deterministic impact report.

This slice is intentionally smaller than the hackathon MVP. Its purpose is to validate the most important technical and product assumption before UI work, LLM-based artifact generation, DataHub write-back, or GitHub automation begins.

## User Story

As a data or backend engineer, I want to propose renaming one column in a known dataset so that I can see whether the dataset and column exist, which downstream assets may be affected, what evidence supports the result, and which metadata remains unknown.

## Supported Change Intent

The slice supports exactly one change kind:

```text
rename_column
```

The request must identify:

- a dataset hint;
- the existing column name;
- the proposed column name.

Requests that contain multiple changes or require another change kind must be rejected with a clear explanation of the supported format.

## In Scope

- Accept one constrained natural-language column-rename request.
- Convert the request into a validated structured change intent.
- Search the local DataHub instance for the target dataset.
- Resolve exactly one dataset URN without guessing.
- Retrieve the dataset's real schema through the official DataHub MCP Server.
- Verify that the source column exists in the retrieved schema.
- Retrieve downstream lineage through the official DataHub MCP Server.
- Distinguish table-level evidence from column-level evidence.
- Normalize the retrieved facts into a stable internal evidence model.
- Calculate a basic deterministic impact assessment.
- Record assumptions, unknowns, and DataHub tool calls separately from facts.
- Generate one human-readable Markdown impact report under a run-specific directory.
- Preserve a sanitized trace sufficient to show how DataHub affected the result.
- Provide automated tests for deterministic core behavior and sanitized DataHub fixtures.
- Provide one repeatable local integration scenario using official sample metadata.

## Out of Scope

- A browser UI or Next.js pages.
- Support for schema changes other than `rename_column`.
- Migration, rollback, or validation SQL generation.
- OpenAI or any other LLM dependency.
- DataHub mutation or document write-back.
- GitHub branch, commit, issue, or pull-request automation.
- Autonomous database changes.
- Production deployment or multi-user access.
- Run history, artifact downloads, or graph visualization.
- Support for every SQL platform or dialect.
- Inferring missing schema, lineage, ownership, or governance facts.

## Preconditions

- DataHub CLI and DataHub OSS containers use a verified compatible 1.6.x version set.
- The local DataHub CLI is configured for the local instance.
- The official `showcase-ecommerce` datapack is loaded successfully.
- A demo dataset with a useful downstream lineage graph is selected after the datapack is inspected.
- The official DataHub MCP Server is pinned to a tested version and runs in read-only mode.
- Authentication is provided through local environment configuration and is never committed.
- Recorded test fixtures contain only official sample metadata and are sanitized before commit.

## Functional Requirements

### FR-001 — Request Parsing

The system must convert a supported request into a structured `rename_column` intent containing the dataset hint, source column, and target column.

If the request is incomplete, contains multiple changes, or describes an unsupported change kind, processing must stop before any impact conclusion is produced.

### FR-002 — Dataset Search

The system must search DataHub using the dataset hint and record the search tool call and returned candidate URNs.

### FR-003 — Unambiguous Resolution

The system must continue automatically only when exactly one dataset is selected by an explicit deterministic rule.

If no dataset matches, processing must stop with `TARGET_NOT_FOUND`.

If multiple plausible datasets remain, processing must stop with `NEEDS_USER_CLARIFICATION` and show the candidates. The system must not select the first result silently.

### FR-004 — Schema Retrieval

The system must retrieve the selected dataset's schema from DataHub and record the evidence source.

### FR-005 — Column Validation

The system must verify that the source column exists in the retrieved schema using an exact normalized comparison.

If it does not exist, processing must stop with `COLUMN_NOT_FOUND` and include the actual known field names in the diagnostic result.

### FR-006 — Downstream Lineage Retrieval

The system must retrieve downstream lineage for the selected dataset with a bounded hop count and record each returned asset and lineage relationship.

The exact hop limit is a technical-plan decision, but it must be explicit, deterministic, and visible in the final report.

### FR-007 — Lineage Evidence Level

The system must label impact evidence as either table-level or column-level.

Table-level lineage must never be presented as proof that a specific downstream column uses the renamed column.

### FR-008 — Evidence Normalization

The system must normalize MCP responses into a stable model containing at least:

- target dataset URN;
- target platform and environment when available;
- known schema fields;
- source column details;
- downstream asset URNs;
- lineage hop information;
- evidence level;
- tool-call identifiers;
- metadata gaps.

DataHub-specific response shapes must not appear directly in deterministic domain logic.

### FR-009 — Deterministic Impact Assessment

The impact assessment must be calculated without an LLM.

At minimum, it must consider:

- the severity assigned to a column rename;
- the number of downstream assets;
- lineage depth;
- availability of column-level evidence;
- missing or incomplete metadata.

The same normalized input must always produce the same result.

### FR-010 — Facts, Assumptions, and Unknowns

The output must keep the following categories separate:

- facts retrieved from DataHub;
- deterministic conclusions derived from those facts;
- explicit assumptions;
- unresolved unknowns.

### FR-011 — Markdown Artifact

Each successful or metadata-limited run must produce:

```text
runs/<run-id>/impact-report.md
```

The report must contain:

- run identifier;
- original request;
- normalized change intent;
- selected dataset and source column;
- evidence summary;
- affected downstream assets;
- evidence level;
- deterministic impact result;
- assumptions;
- unknowns;
- non-secret tool trace summary;
- final status.

### FR-012 — Sanitized Trace

The system must record enough MCP trace information to demonstrate the use of DataHub while excluding tokens, passwords, secret environment values, and unnecessary raw payloads.

### FR-013 — Read-Only Operation

The slice must use only read-oriented DataHub tools. Mutation and document tools must remain disabled.

### FR-014 — Safe Output Boundary

Generated files must be written only beneath the configured local runs directory. User input must not control an absolute path or escape the run directory.

## Failure and Recovery Requirements

| Condition                          | Required status              | Required recovery guidance                                                                 |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| DataHub is unavailable             | `DATAHUB_UNAVAILABLE`        | Explain how to verify the local containers and GMS endpoint.                               |
| MCP Server cannot start or connect | `MCP_UNAVAILABLE`            | Identify the failed integration boundary without exposing credentials.                     |
| No dataset matches                 | `TARGET_NOT_FOUND`           | Show the search hint and suggest a more specific dataset identifier.                       |
| Several datasets remain plausible  | `NEEDS_USER_CLARIFICATION`   | Show deterministic candidate identifiers for selection.                                    |
| Source column is absent            | `COLUMN_NOT_FOUND`           | Show the actual retrieved field names.                                                     |
| Downstream lineage is empty        | `INSUFFICIENT_METADATA`      | Produce a limited report, state that no downstream impact is proven, and lower confidence. |
| Column-level lineage is absent     | `COMPLETED_WITH_LIMITATIONS` | Clearly label downstream impact as table-level only.                                       |
| Artifact writing fails             | `ARTIFACT_WRITE_FAILED`      | Preserve the in-memory result and report the safe output location that failed.             |

## Acceptance Criteria

### AC-001 — Successful Grounded Run

Given a healthy local DataHub instance containing the selected official sample asset and a valid rename request, the system resolves one real dataset URN, verifies the source column, retrieves non-empty downstream lineage, calculates a deterministic impact result, and creates `impact-report.md`.

### AC-002 — No Hallucinated Metadata

Every dataset, column, platform, lineage relationship, and downstream asset named as a fact in the report is present in the normalized DataHub evidence for that run.

### AC-003 — Ambiguous Target Safety

Given multiple plausible dataset matches, the system returns `NEEDS_USER_CLARIFICATION`, lists the candidates, and produces no definitive impact conclusion.

### AC-004 — Missing Column Safety

Given a source column absent from the retrieved schema, the system returns `COLUMN_NOT_FOUND`, displays the known fields, and does not calculate downstream column impact.

### AC-005 — Metadata-Limited Result

Given an exact dataset and valid source column but no downstream lineage, the system creates a limited report with `INSUFFICIENT_METADATA` and does not claim that the change is safe.

### AC-006 — Evidence-Level Honesty

When only table-level lineage is available, the report explicitly states that column-level impact is unknown.

### AC-007 — Determinism

Two executions against the same normalized fixture produce the same intent, affected-asset ordering, impact result, assumptions, and unknowns, excluding run ID and timestamp.

### AC-008 — Secret Safety

Automated tests confirm that representative tokens, passwords, and secret environment values do not appear in generated artifacts or traces.

### AC-009 — Output Path Safety

Automated tests confirm that malicious or malformed input cannot write outside the configured runs directory.

### AC-010 — Repeatable Demo

The documented demo command produces the expected report from a clean project checkout after the documented local prerequisites are satisfied.

## Required Deliverables

- One command-line entrypoint for the slice.
- One selected and documented official sample dataset and column-change scenario.
- One sanitized fixture set for deterministic tests.
- One generated example Markdown impact report committed under `examples/`.
- Unit tests for request validation, evidence normalization, impact determinism, redaction, and output-path safety.
- One local DataHub integration test covering search, schema retrieval, and downstream lineage retrieval.
- English setup and demo instructions sufficient to reproduce the slice.

## Definition of Done

The specification is implemented only when:

- the tested DataHub CLI, OSS, and MCP Server versions are pinned and documented;
- the official sample datapack is loaded and the selected demo URNs are documented;
- all functional requirements are implemented;
- all acceptance criteria are verified by automated tests or an explicitly documented integration check;
- the actual lint, typecheck, test, integration-test, and build commands complete successfully;
- the generated example contains only facts supported by its committed sanitized evidence;
- no DataHub mutation tools are enabled;
- no secret or private data is present in tracked files;
- the result is reproducible from a clean checkout.

## Deferred Decisions

The following decisions belong to the technical plan and must not be guessed during specification review:

- the exact official sample dataset and column;
- the bounded lineage hop count;
- the deterministic impact formula and thresholds;
- the exact internal TypeScript module structure;
- the MCP client library and subprocess lifecycle;
- the test runner and SQL-independent validation libraries;
- the transition point from CLI to Next.js.

## Traceability

This specification is derived from `PROJECT_BRIEF.md`, especially the sections covering the first vertical slice, DataHub integration, error handling, testing, security, and the prohibition against unverified or invented metadata.
