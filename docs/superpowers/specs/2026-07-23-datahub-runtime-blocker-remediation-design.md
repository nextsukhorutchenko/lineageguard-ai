# DataHub Runtime Blocker Remediation Design

**Date:** 2026-07-23

**Status:** Approved

**Decision:** Harden the existing DataHub application boundaries with canonical-URN resolution for
incomplete search, application-owned MCP deadlines and response budgets, bounded idempotent
cleanup, and close-before-publication terminal ordering.

## Authority

This document is a narrow corrective specification for the implemented deterministic DataHub
impact-analysis slice and the shared modules that specification
`002-nextjs-openai-agent-demo` will reuse.

It supersedes only the following conflicting or incomplete implementation-plan behavior:

- the write-before-close ordering described in
  `docs/specs/001-datahub-impact-slice/plan.md`;
- any interpretation of "one exact URN" in
  `docs/specs/002-nextjs-openai-agent-demo/plan.md` that permits a name or
  `platform:name` match to establish uniqueness from incomplete search;
- reliance on dependency defaults instead of application-owned deadlines for DataHub MCP calls or
  cleanup; and
- unbounded application-level decoding and validation of MCP tool results.

The approved product scope in specifications 001 and 002 remains unchanged. The existing
read-only DataHub boundary, deterministic impact formula, evidence statuses, and future atomic
four-file package protocol remain authoritative.

## Context

The completed branch review found four merge-blocking runtime defects outside the safe fixture
recapture work.

### 1. Incomplete search can produce false uniqueness

`runImpactAnalysis` resolves collected search candidates through the generic `resolveDataset`
function. That resolver intentionally supports exact URN, name, and platform-qualified name
matches for a complete candidate set.

When search is incomplete, however, one collected name or `platform:name` match is not evidence
of uniqueness. A later uncollected page may contain another exact alias. The current behavior can
therefore analyze the wrong dataset while labeling only the evidence collection, rather than the
selected identity, as incomplete.

### 2. MCP calls and cleanup lack application-owned finite deadlines

Connection and capability discovery already use a 15-second signal. Normal MCP tool calls forward
only an optional caller signal, while the CLI normally aborts that signal only on `SIGINT`.
Startup cleanup and normal catalog close also await the dependency without a LineageGuard-owned
outer deadline.

The pinned MCP SDK currently supplies its own request timeout and the pinned stdio transport has
internal termination waits. Those dependency behaviors are not an application contract and are
not sufficient evidence that every LineageGuard entrypoint settles within a tested bound.

### 3. Cleanup can contradict a published terminal report

The application currently writes `impact-report.md` with a successful final status before closing
the catalog. If close then fails, the CLI reports `MCP_UNAVAILABLE`, while the completed report
remains visible on disk.

The final filesystem artifact and the process exit status therefore disagree about the same run.

### 4. MCP tool results are unbounded before application parsing and validation

The decoder joins all text blocks and calls `JSON.parse` without a byte ceiling. Structured
content, search results, schema fields, lineage results, and many response strings or nested arrays
also reach application validation without finite raw bounds.

Later pagination and normalized entity-context caps do not protect the earlier decode and schema
boundary.

## Goals

- Preserve deterministic and read-only DataHub behavior.
- Prevent incomplete search from establishing dataset uniqueness through an alias.
- Guarantee finite application-level settlement for every MCP tool call and close path.
- Preserve caller cancellation provenance while classifying owned MCP expiry with fixed safe
  errors.
- Reject oversized or structurally hostile MCP results before LineageGuard joins text, parses JSON,
  validates a tool schema, normalizes evidence, or persists output.
- Ensure no final successful impact report is visible until required MCP cleanup succeeds.
- Preserve the existing primary-failure and sanitized suppressed-cleanup behavior.
- Keep the change reusable by the CLI, fixture capture, opt-in integration checks, and the future
  Next.js agent workflow.
- Keep mandatory verification deterministic, offline, credential-free, and fast under fake timers.

## Non-Goals

- Implementing the Next.js or OpenAI agent demo.
- Replacing or forking the MCP SDK.
- Building a custom stdio transport or enforcing a pre-wire JSON-RPC frame limit.
- Changing the impact formula, risk thresholds, evidence statuses, or Context Coverage.
- Changing the four-operation DataHub read allowlist or enabling mutation.
- Adding dependencies, environment variables, or a broad CI restructuring.
- Adding atomic staging for the legacy single-file impact report.
- Fixing the separate minor finding about the stale committed example report.
- Requiring live DataHub for deterministic acceptance.

## Considered Approaches

### 1. Targeted hardening at the existing boundaries

Add one focused MCP boundary policy, preserve the existing domain and adapter interfaces where
possible, add a strict incomplete-search gate, and move required cleanup before final report
publication.

**Advantages**

- Smallest safe change.
- Protects every current MCP consumer through shared code.
- Preserves the established module boundaries.
- Fits beneath the future 55-second DataHub-analysis owner in specification 002.
- Does not duplicate the future agent workflow state machine or package store.

**Disadvantages**

- Application-level result guarding occurs after the SDK has framed and parsed the JSON-RPC
  message.
- Deadline ownership is split intentionally: MCP boundary deadlines here and workflow deadlines in
  the future runtime layer.

### 2. Introduce a stateful `DataHubSession`

Replace the existing catalog boundary with a resource-owning session that combines resolution,
collection, decoding, deadlines, lifecycle state, and publication readiness.

**Advantages**

- One explicit lifecycle abstraction.
- Could centralize more future workflow behavior.

**Disadvantages**

- Broad API and test churn.
- Mixes domain resolution with infrastructure lifecycle.
- Overlaps the approved future workflow state and deadline work.
- Exceeds the smallest remediation for the four blockers.

### 3. Replace the SDK stdio framing boundary

Implement or fork a transport that rejects an oversized line before the SDK parses JSON-RPC.

**Advantages**

- Strongest memory boundary against a hostile or defective MCP subprocess.
- Enforces the byte ceiling before any JSON parsing.

**Disadvantages**

- Adds a significant protocol-maintenance and compatibility surface.
- Requires testing transport details already owned by the pinned SDK.
- Expands the change beyond the reviewed application defects.

## Decision

Use Approach 1.

The application will own explicit MCP call, cleanup, and application-result budgets while retaining
the pinned SDK transport. The residual pre-wire framing limitation will remain documented rather
than hidden.

## Architecture

### 1. Canonical identity gate for incomplete search

Complete search retains the existing deterministic resolution behavior:

- exact candidate URN;
- exact candidate name; or
- exact platform-qualified candidate name.

Incomplete search may continue only when all of the following are true:

1. the user-provided dataset hint passes the existing canonical DataHub dataset-URN parser;
2. exactly one distinct collected candidate has a `candidate.urn` equal to that canonical hint
   under the existing normalization; and
3. no candidate name, explicit platform-qualified name, or URN-derived platform-qualified name is
   used as identity proof.

Every other incomplete-search outcome stops with:

```text
DATAHUB_UNAVAILABLE
Dataset search was incomplete.
```

The stop occurs before schema, lineage, entity-context, impact, rendering, or artifact work. It
must not be converted to `TARGET_NOT_FOUND` or a false `NEEDS_USER_CLARIFICATION`.

If the canonical identity gate succeeds, analysis may continue with
`search.complete=false`. The resulting report remains `INCOMPLETE_EVIDENCE`, and search candidates
remain a collected lower bound.

### 2. MCP boundary policy

Add one application-owned policy for the shared MCP adapter:

```text
toolCallMs: 15,000
closeMs: 5,000
maxToolResultBytes: 1,048,576
maxJsonDepth: 64
maxJsonNodes: 100,000
```

The implementation should keep this policy in a focused MCP module such as
`src/datahub/mcp/mcp-boundary-policy.ts`. It must not add environment overrides. These are
certified application constants, not user input.

The 15-second tool-call limit is below the approved future 55-second complete DataHub-analysis
deadline. The 5-second cleanup limit covers the pinned stdio transport's approximately four-second
graceful/SIGTERM sequence while matching the existing CLI shutdown budget.

### 3. Bounded MCP tool calls

Every call to `search`, `list_schema_fields`, `get_lineage`, or `get_entities` must:

1. check the caller signal;
2. create a first-wins scope combining caller cancellation and the 15-second owned timer;
3. pass the composed signal plus explicit SDK `timeout` and `maxTotalTimeout` values;
4. separately bound the application's await so a dependency that ignores its signal cannot block
   LineageGuard indefinitely;
5. discard any result that settles after cancellation or deadline;
6. clear the timer and remove listeners in `finally`; and
7. record a successful trace entry only after bounded decoding and tool-specific validation
   succeed.

The first observed abort source is immutable:

- caller cancellation preserves the caller's `AbortError` or future classified workflow error;
- owned tool expiry becomes fixed, sanitized `DATAHUB_UNAVAILABLE`;
- a dependency rejection becomes the existing fixed, sanitized `DATAHUB_UNAVAILABLE`.

The implementation must not inspect, persist, or expose `AbortSignal.reason`, SDK timeout payloads,
native exceptions, or raw MCP response content.

### 4. Bounded idempotent cleanup

Both cleanup ownership phases require the same finite guarantee:

- before catalog creation succeeds, the connection factory owns raw SDK-client cleanup; and
- after catalog creation succeeds, `DataHubMcpCatalog` owns normal cleanup.

Each owner must:

1. start underlying close at most once;
2. cache and return the same settlement to repeated callers;
3. bound its await to 5 seconds even though SDK close accepts no signal;
4. translate rejection or owned expiry to fixed `MCP_UNAVAILABLE`; and
5. ignore late settlement for state or publication decisions.

The CLI's existing close-once wrapper may remain as an outer ownership guard, but it must not cause
a second underlying close. Fixture capture and other direct catalog consumers inherit the same
idempotent bounded behavior.

When analysis has already failed, a close failure is secondary. The primary error remains
authoritative, and only the existing fixed suppressed-cleanup record may be attached. Raw cleanup
details remain unavailable.

### 5. Application-level raw result budget

Before choosing `structuredContent`, joining text, calling `JSON.parse`, invoking a tool-specific
Zod schema, or normalizing data, LineageGuard must inspect the complete `CallToolResult`.

The inspection must include:

- every content block, including blocks the JSON decoder would otherwise ignore;
- inserted newline bytes between joined text blocks;
- both `content` and `structuredContent` when both are present;
- UTF-8 bytes for strings and object keys, including JSON escaping;
- JSON container and scalar syntax;
- nested depth and total node count; and
- cyclic or non-JSON values in structured content.

Use an iterative, early-exit traversal rather than recursive descent or an unbounded
`JSON.stringify`. Reject the result when any approved byte, depth, node, or structural bound is
exceeded.

Exactly 1,048,576 accounted bytes may proceed. One additional byte must fail before text joining or
application JSON parsing. Error messages are fixed and value-free.

This is an application-level pre-decode guarantee. The pinned SDK's stdio reader frames and parses
the JSON-RPC message before returning `CallToolResult`; preventing allocation at that earlier
boundary would require the rejected custom-transport approach.

### 6. Tool-specific schema bounds

After the global result budget, the tool schemas must enforce the request-derived page or batch
maximums:

| Tool or collection      | Maximum entries per response |
| ----------------------- | ---------------------------: |
| Dataset search          |                           50 |
| Schema fields           |                          100 |
| Table or column lineage |                          100 |
| Entity context          |                           10 |

Identity-bearing values must have finite strict maximums and must be rejected rather than
truncated. Existing approved normalization caps remain authoritative:

- URNs, names, and field paths: 500 characters;
- platform and entity type: 100 characters;
- descriptions: 2,000 characters;
- quality signals: 100 characters; and
- normalized owners, tags, glossary terms, siblings, and quality arrays: 20 entries each.

The implementation plan must enumerate a finite maximum for every remaining raw string and nested
array before implementation. No `z.string()` or `z.array()` that consumes MCP data may remain
unbounded. A remaining raw maximum may not exceed the global result budget or weaken an established
normalized cap.

Unknown container fields may remain forward-compatible, but they are covered by the global result
budget and must not cross the normalized domain boundary.

### 7. Close-before-publication terminal protocol

An analysis is not completed merely because its report can be rendered. The pre-publication state
is `readyToPublish`.

The successful flow is:

```text
parse and validate request
  -> collect and validate DataHub evidence
  -> calculate deterministic assessment
  -> build report and Markdown in memory
  -> close the owned catalog within five seconds
  -> recheck caller cancellation
  -> publish impact-report.md with create-only semantics
  -> return the successful run
```

If close rejects or expires, the application returns `MCP_UNAVAILABLE`, the CLI exits with code 3,
and no final `impact-report.md` exists. The CLI prints no successful status, run ID, or report path.

If close succeeds and the writer fails, the existing `ImpactReportPersistenceError` preserves the
safe in-memory report and attempted path. Cleanup is not retried.

After `writeRunArtifact` succeeds, no required fallible operation remains that can relabel the
single-file run. The future specification-002 package keeps its separate atomic directory rename
as the completion linearization point.

Do not publish first and then delete on cleanup failure. That would create an observation window
for contradictory state, and compensating deletion can itself fail.

## Stable Error Mapping

| Condition                                                              | Required result                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Incomplete search without one explicit canonical-URN match             | `DATAHUB_UNAVAILABLE`                                                   |
| MCP tool-call deadline                                                 | `DATAHUB_UNAVAILABLE`                                                   |
| Oversized, too-deep, cyclic, non-JSON, or schema-invalid tool result   | `DATAHUB_UNAVAILABLE`                                                   |
| MCP startup or capability failure                                      | `MCP_UNAVAILABLE`                                                       |
| Startup cleanup rejection or deadline                                  | `MCP_UNAVAILABLE`, unless a primary failure already owns the outcome    |
| Normal close rejection or deadline after otherwise successful analysis | `MCP_UNAVAILABLE`, with no final report                                 |
| Caller cancellation                                                    | Preserve caller cancellation classification                             |
| Primary analysis failure plus cleanup failure                          | Preserve primary failure; attach only fixed suppressed cleanup metadata |
| Artifact writer failure after successful close                         | `ARTIFACT_WRITE_FAILED`                                                 |

No raw value, native path, dependency exception, secret, abort reason, or MCP payload may be copied
into a public error, trace, fixture, report, or future browser response.

## Data Flow

```text
User request
  -> constrained intent parser
  -> bounded DataHub search
  -> complete-search resolver
     OR incomplete-search canonical-URN gate
  -> bounded schema / lineage / entity-context calls
  -> application raw-result budget
  -> tool-specific schema bounds
  -> normalized evidence
  -> deterministic assessment
  -> in-memory report candidate
  -> bounded idempotent catalog close
  -> cancellation check
  -> create-only final report publication
```

The raw MCP result is never a domain model. Only bounded and validated normalized values may reach
evidence, deterministic decisions, model context, persistence, or UI.

## Test Strategy

Implementation must follow test-driven development. All mandatory tests remain offline,
credential-free, and deterministic.

### Dataset-resolution tests

- Incomplete search with one plain-name match returns `DATAHUB_UNAVAILABLE`.
- Incomplete search with one `platform:name` match returns `DATAHUB_UNAVAILABLE`.
- Incomplete search with one canonical hint and one matching `candidate.urn` continues.
- A canonical hint that is absent, duplicated, or matched only through a candidate name fails.
- Failure occurs before schema, lineage, context, assessment, rendering, or artifact writing.
- Complete search preserves existing URN, name, platform-name, not-found, and sorted ambiguity
  behavior.
- Successful canonical incomplete continuation remains `INCOMPLETE_EVIDENCE`.
- A regression models a first-page alias that would become ambiguous on a later page.

### Deadline and cleanup tests

- Each of the four read tools expires without a caller signal.
- Caller cancellation wins and remains unmodified.
- Same-turn competing aborts use deterministic first-winner behavior.
- Every call passes explicit SDK `timeout` and `maxTotalTimeout`.
- Ignored late resolution cannot mark a trace entry successful or create evidence.
- Timers and listeners are disposed after success, failure, cancellation, and expiry.
- Hung startup cleanup and hung normal close settle within the owned bound under fake timers.
- Every close owner invokes its dependency at most once.
- Primary failure remains authoritative when cleanup also fails.

### Result-budget tests

- Text exactly at the byte limit succeeds; limit plus one fails before join or `JSON.parse`.
- Multiple text blocks account for inserted newlines.
- Multibyte Unicode uses UTF-8 byte length rather than JavaScript string length.
- Structured content exactly at the budget succeeds; oversized strings, nesting, nodes, and arrays
  fail.
- Cycles and non-JSON structured values fail with fixed messages.
- Oversized ignored content fails even when a small `structuredContent` value would otherwise win.
- Search, schema, lineage, and entity arrays reject their page or batch maximum plus one.
- No rejected payload or secret appears in trace or serialized error output.

### Terminal-publication tests

- An otherwise successful analysis whose close rejects writes no report.
- A close deadline has the same no-report terminal behavior.
- The CLI exits 3, emits no success output, and provides only bounded MCP recovery guidance.
- The catalog observes that the final report does not exist when close begins.
- A successful close followed by a real writer failure preserves
  `ImpactReportPersistenceError` and does not retry cleanup.
- A normal successful run closes before publication and produces the same deterministic report.
- A primary analysis failure plus cleanup failure keeps the safe suppressed-failure behavior.

### Regression and integration tests

- Existing pagination, capability, redaction, context, impact, CLI, fixture-capture, and
  create-only artifact suites continue to pass.
- Broad test commands must prove the exact selected file list or count before their result is
  trusted.
- The opt-in live integration test verifies the bounded production path only when explicitly
  configured. It is not required for offline acceptance and must not be reported as passed unless
  executed.
- Future agent-workflow tests must prove that close failure prevents context readiness, agent
  generation, a package manifest, and a completed package.

## Likely Implementation Surface

Expected production files:

- create `src/datahub/mcp/mcp-boundary-policy.ts`;
- modify `src/datahub/mcp/mcp-client.ts`;
- modify `src/datahub/mcp/datahub-mcp-catalog.ts`;
- modify `src/datahub/mcp/decode-tool-result.ts`;
- modify `src/datahub/mcp/schemas.ts`;
- modify `src/app/run-impact-analysis.ts`; and
- modify `src/domain/resolve-dataset.ts` only if a narrow canonical-match helper belongs beside the
  existing parser.

Expected tests:

- create or colocate tests for the MCP policy helper;
- modify `src/datahub/mcp/decode-tool-result.test.ts`;
- modify `src/datahub/mcp/datahub-mcp-catalog.test.ts`;
- modify `src/app/run-impact-analysis.test.ts`;
- modify `src/domain/resolve-dataset.test.ts` if its public helper changes;
- modify `src/cli.test.ts`;
- modify `scripts/capture-datahub-fixtures.test.ts`; and
- modify the opt-in integration contract without making it part of required CI.

Expected authority documentation:

- add this design;
- add a narrow corrective note to the historical specification-001 plan rather than silently
  preserving unsafe executable guidance; and
- update the applicable specification-002 plan sections to reuse this boundary, canonical-URN
  rule, and pre-publication cleanup gate.

The implementation plan will select the exact smallest file set after TDD dependencies and
existing test helpers are reconciled. It may remove an optional file from this list but may not
weaken the approved contracts.

## Acceptance Criteria

1. Complete search retains the existing deterministic URN, name, and platform-name resolution
   behavior.
2. Incomplete search continues only for one exact canonical dataset URN explicitly supplied by the
   user and present as exactly one collected candidate URN.
3. No incomplete alias match can reach schema, lineage, context, assessment, rendering, or
   persistence.
4. Every MCP read has a tested 15-second application-owned deadline even when no caller signal is
   supplied.
5. Caller cancellation remains distinguishable from an owned MCP timeout.
6. Every startup and normal close path has a tested 5-second application-owned deadline and
   close-once behavior.
7. A dependency that ignores cancellation cannot keep the application await pending indefinitely.
8. Late MCP results cannot change trace, evidence, terminal state, or artifacts.
9. Every complete `CallToolResult` is bounded to 1,048,576 accounted bytes, depth 64, and 100,000
   JSON nodes before LineageGuard text joining, JSON parsing, schema validation, normalization, or
   persistence.
10. Search, schema, lineage, entity, string, and nested-array schemas contain finite positive
    limits consistent with outbound requests and approved domain caps.
11. Oversized, cyclic, non-JSON, or schema-invalid responses expose only fixed sanitized
    `DATAHUB_UNAVAILABLE`.
12. An otherwise successful analysis cannot publish a final impact report until catalog close
    succeeds.
13. Close rejection or expiry after analysis produces `MCP_UNAVAILABLE`, CLI exit 3, and no final
    `impact-report.md`.
14. Primary analysis failure remains authoritative when cleanup also fails.
15. Writer failure after successful cleanup remains `ARTIFACT_WRITE_FAILED` and does not repeat
    cleanup.
16. A normal successful run still produces the same deterministic report and status.
17. No raw MCP response, secret, native exception, abort reason, or unrestricted native path is
    added to public output or persisted artifacts.
18. Fixture capture and future Next.js reuse inherit the same shared MCP boundary without exposing
    new tools or mutation.
19. Mandatory tests remain offline, credential-free, isolated, and controlled by fake timers.
20. All applicable formatting, lint, typecheck, offline test, build, diff, and available secret
    scanning gates pass before implementation is described as complete.

## Verification Strategy

After implementation:

1. run each new focused test in RED and GREEN phases;
2. run the complete MCP boundary and application orchestration test files;
3. run the affected CLI and fixture-capture suites;
4. prove the selected file list for every broad regression slice;
5. run repository formatting and lint checks;
6. run strict TypeScript checking;
7. run the complete offline test suite;
8. run the CLI build;
9. run `git diff --check`;
10. inspect the focused diff and repository status; and
11. run repository secret scanning when available.

Live DataHub verification remains separately reported as `NOT RUN`, `PASSED`, or `FAILED`.

## References

- `AGENTS.md`
- `docs/specs/001-datahub-impact-slice/spec.md`
- `docs/specs/001-datahub-impact-slice/plan.md`
- `docs/specs/002-nextjs-openai-agent-demo/spec.md`
- `docs/specs/002-nextjs-openai-agent-demo/plan.md`
- `@modelcontextprotocol/sdk@1.29.0`
- Node.js 22 `AbortController`, timers, buffers, and filesystem APIs
