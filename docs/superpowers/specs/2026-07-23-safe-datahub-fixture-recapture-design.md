# Safe DataHub Fixture Recapture Design

**Date:** 2026-07-23

**Decision:** Capture live fixture candidates in a fresh repository-ignored
directory without modifying committed fixtures

**Status:** Approved

## Context

LineageGuard AI keeps five deterministic, sanitized DataHub replay fixtures
under `tests/fixtures/datahub/`. The fixture capture script validates those
committed fixtures, collects current data through the pinned read-only DataHub
MCP boundary, canonicalizes and validates the five resulting payloads, and
writes every file with create-only semantics.

The current command-line entrypoint passes the committed fixture directory back
to that create-only writer. A normal clean checkout therefore reaches
`EEXIST` on the first committed file. The documented recapture command cannot
complete even though the lower-level create-only behavior is correct.

The approved Task 1A authority intentionally separates two operations:

1. committed fixture migration is deterministic repository work that must not
   depend on live capture; and
2. live capture produces validated evidence that can be reviewed without
   automatically replacing repository fixtures.

Automatic overwrite, delete-first replacement, or direct publication into the
committed fixture directory would violate that boundary. The safe correction
is to make the command produce a new review candidate on every run.

The same branch review also identified two documentation discrepancies:

- the README describes four fixtures although the current contract contains
  five; and
- the report-status table omits the report-producing
  `INCOMPLETE_EVIDENCE` state.

## Goals

- Make the documented fixture capture command work on a normal clean checkout.
- Preserve create-only fixture writes.
- Keep committed fixtures unchanged during live capture.
- Produce exactly five canonical, strictly validated, sanitized candidate
  fixture files.
- Keep candidate output beneath a fixed repository-ignored root.
- Prevent a failed capture from appearing to be a completed candidate.
- Keep mandatory tests offline, deterministic, and credential-free.
- Make README and demo documentation match the current five-fixture and
  report-status contracts.

## Non-Goals

- Automatically replacing, deleting, or modifying committed fixtures.
- Adding a `--replace` mode or any other overwrite path.
- Treating a live capture as an approved fixture migration.
- Changing DataHub collection behavior, the impact formula, risk thresholds, or
  report-status derivation.
- Changing the meaning of Evidence Completeness or Context Coverage.
- Adding dependencies, changing the lockfile, or changing CI.
- Adding a platform-specific native no-replace directory-rename mechanism.
- Claiming that replay evidence proves current live DataHub state.

## Considered Approaches

### A. Fresh repository-ignored candidate directory

Create a unique `tmp/datahub-fixture-captures/capture-*` directory for every
command invocation, write all five fixture files there with create-only
semantics, and create a `.complete` marker only after the complete on-disk set
passes strict validation.

**Advantages**

- Compatible with the approved committed-fixture migration boundary.
- Works on a normal checkout without deleting existing files.
- Keeps review candidates near the repository but out of version control.
- Makes each capture isolated and inspectable.
- Supports deterministic offline orchestration tests.

**Disadvantages**

- Promotion remains a separate reviewed repository operation.
- Abandoned successful candidates require occasional manual cleanup.

### B. Operating-system temporary directory

Write each capture under the host operating system's temporary root.

**Advantages**

- Naturally untracked.
- Simple isolation.

**Disadvantages**

- Harder for an operator to locate and compare with repository fixtures.
- Host cleanup policy can remove a candidate before review.
- The output is less portable in documentation and demo instructions.

### C. Required explicit destination

Require the operator to supply a destination on every command invocation.

**Advantages**

- The operator controls storage and lifecycle.
- No default-path policy is needed.

**Disadvantages**

- Adds avoidable operator friction.
- Makes the documented command incomplete without another argument.
- Increases the risk of accidentally selecting the committed fixture
  directory.

## Completion Publication Options

### A1. Unique directory plus create-only completion marker

Use `mkdtemp` to create the final unique `capture-*` directory without reusing
an existing path. Write the five fixture files with `wx`, validate the exact
on-disk set, and atomically create an empty `.complete` marker with `wx` as the
final completion operation.

**Advantages**

- Uses only portable Node.js filesystem APIs.
- Does not rename over or replace another directory.
- A partial directory has no marker and is unambiguously incomplete.
- Keeps exactly five fixture payloads while making completion machine-checkable.

**Disadvantages**

- A completed candidate contains one additional non-fixture marker file.
- Operators and future promotion tooling must check the marker and strict
  fixture set together.

### A2. Preflight followed by ordinary directory rename

Check that the final path is absent and then rename a staging directory.

**Rejected because:** Node.js exposes ordinary rename semantics rather than a
portable no-replace directory rename. On POSIX systems, an existing empty
destination directory can be replaced between the preflight and rename. This
would contradict the no-overwrite contract.

### A3. Platform-specific native no-replace rename

Use a native binding or platform command that exposes no-replace rename
semantics.

**Rejected because:** it would add a dependency or platform branch, expand the
security and portability surface, and exceed the smallest safe remediation.

## Decision

Use Approach A with completion refinement A1.

The command-line entrypoint will create a fresh child beneath
`tmp/datahub-fixture-captures/` through collision-safe temporary-directory
creation and pass only that owned `capture-*` directory to the existing live
capture boundary. It will create a `.complete` marker only after all five
fixture files have been re-read and strictly validated. The current
`.gitignore` already excludes `tmp/`, so no ignore-rule change is required.

Committed fixtures remain read-only inputs to strict replay-schema validation.
Moving a reviewed candidate into `tests/fixtures/datahub/` remains a separate
owner-approved deterministic fixture migration.

## Architecture

### 1. Separate serialization and create-only writing

Extract a focused `writeFixturePayloads` boundary from the current write loop.
It will:

1. accept the five canonical payloads, the redaction token, and an explicit
   destination;
2. strictly validate all five payloads before writing any file;
3. serialize all five payloads in memory through the existing credential-safe
   serializer before writing the first file;
4. use the fixed `fixtureFileNames` tuple as the complete filename allowlist;
5. create files with `wx` semantics; and
6. return the five `CapturedFixture` records only after all writes succeed.

It will not delete, truncate, rename over, or replace an existing file.

`captureDataHubFixtures` will retain responsibility for validating the five
committed fixtures, connecting to the pinned DataHub MCP server, collecting
live evidence, canonicalizing it, and closing the catalog. It will delegate
only final candidate serialization and writing to `writeFixturePayloads`.

### 2. Add a testable CLI orchestration boundary

Add a thin exported `runFixtureCaptureCli` boundary around the live capture
operation. Production defaults will:

1. derive the repository root from the script module location rather than the
   caller's current working directory;
2. resolve the fixed capture root
   `tmp/datahub-fixture-captures`;
3. create that root if necessary and validate its lexical and physical
   containment beneath the repository;
4. reject a symbolic link or Windows junction in any path segment from the
   repository root through the capture root;
5. use collision-safe temporary-directory creation to create one unique owned
   `capture-*` child;
6. pass only that candidate child to `captureDataHubFixtures`;
7. wait for all five files to complete;
8. re-read the directory, require exactly the five allowlisted fixture
   filenames as regular non-link files, and parse every file through its strict
   replay schema;
9. atomically create an empty `.complete` marker by opening it with `wx` and
   treat the successful open as the irreversible completion point;
10. make a best-effort close of the marker handle without downgrading the
    already completed candidate if close fails; and
11. print one success message containing the count and repository-relative
    candidate path.

The orchestration boundary will accept narrow dependency overrides needed by
offline tests, including an isolated repository root, capture root, candidate
directory factory, capture function, marker opener, cleanup function, and
logger. Production behavior will continue to use the module-anchored repository
root, real filesystem, runtime configuration, and live capture function.

The command will never use `tests/fixtures/datahub/` as its destination.
An existing `capture-*` path must never be reused, overwritten, traversed, or
removed.

### 3. Own and clean failed candidates

The orchestrator owns only the unique candidate child it created. If capture,
on-disk validation, or marker open fails before the completion point, it will:

1. verify lexical and physical containment beneath the validated capture root;
2. reject cleanup when the child or an intervening segment is a symbolic link
   or Windows junction;
3. make a best-effort recursive removal of only that unmarked candidate child;
4. emit no success message; and
5. rethrow the original failure to the programmatic caller.

Cleanup failure must not convert the capture into success. A candidate directory
that cannot be removed remains without `.complete` and therefore cannot be
treated as a completed candidate. Cleanup must never traverse a link or
junction or target the capture root, committed fixtures, a previously completed
candidate, or any caller-selected unrelated path.

A `capture-*` directory is complete only when its `.complete` marker is a
zero-byte regular non-link file and the directory contains exactly the five
strict regular non-link fixture files plus that marker. The marker is never
copied into committed fixtures.

Successful creation of the marker through `open("wx")` is the irreversible
completion point. A later marker-handle close failure is suppressed as a
resource-cleanup failure: it cannot remove the marker, trigger candidate
cleanup, change the completed result to failure, or expose a raw diagnostic.

### 4. Keep programmatic failures and public CLI errors separate

`runFixtureCaptureCli` will preserve and rethrow the original pre-completion
capture, validation, or marker-open failure so tests and programmatic callers
retain the authoritative cause.

The executable entrypoint will catch that failure, emit only the fixed public
message `DataHub fixture capture failed.`, and set a non-zero process exit code.
It will not render the raw error, stack, token, native path, MCP diagnostic, or
cleanup failure.

The exact success message will be:

```text
Captured 5 sanitized DataHub fixture candidates at tmp/datahub-fixture-captures/capture-<id>.
```

The displayed path will always use `/` separators and remain repository
relative.

## Fixture Contract

Every completed candidate directory contains exactly these files:

1. `search-order-details.json`;
2. `schema-order-details.json`;
3. `lineage-order-details-table.json`;
4. `lineage-order-details-customer-id.json`; and
5. `entity-context-order-details-impact.json`.

It also contains an empty non-fixture `.complete` marker. The marker is created
atomically and last, and it is not part of the five-fixture replay contract.

The current canonical ordering, normalized `{ items, completeness }` envelopes,
strict replay schemas, redaction, forbidden-field rules, and entity-context
URN ordering remain unchanged.

The candidate is replay-compatible evidence for review. It is not automatically
the repository's new golden fixture and is not proof of current live state
after the capture time.

## Error and Security Behavior

- Existing destination files cause create-only failure and remain unchanged.
- Invalid committed fixtures stop capture before a live candidate is
  published.
- Invalid or unsafe collected payloads stop capture before any payload write.
- All five payloads are validated and serialized before the first filesystem
  write.
- The fixed filename tuple prevents externally derived filenames.
- Candidate output stays under a physically validated
  repository-ignored root without links or junctions.
- Collision-safe directory creation prevents candidate-path reuse.
- The create-only `.complete` marker makes successful publication explicit
  without relying on overwrite-capable directory rename.
- Successful exclusive marker open is authoritative; a subsequent handle-close
  failure cannot make completed output appear failed.
- The success message uses a repository-relative path, not an unrestricted
  native absolute path.
- No token, raw MCP response, email/profile data, raw SQL, or diagnostics are
  added to fixture output or CLI messages.
- The programmatic runner preserves the original failure, while the executable
  entrypoint exposes only a fixed bounded public error.

## Test Strategy

Implementation will follow test-driven development. Focused tests will be
added to `scripts/capture-datahub-fixtures.test.ts` before production changes.

The offline suite will prove that:

1. `writeFixturePayloads` writes exactly the five allowlisted files into a
   fresh isolated destination;
2. a pre-existing target produces an `EEXIST` failure and its bytes remain
   unchanged;
3. every forbidden entity-context field—`email`, `profile`,
   `relatedDocuments`, `rawSql`, `token`, and `diagnostics`—plus a description
   longer than 2,000 characters is rejected before any output file is written;
4. the CLI orchestrator creates a unique `capture-*` child beneath the supplied
   capture root and never targets the committed fixture directory;
5. an existing `capture-*` directory is not reused, overwritten, traversed, or
   removed;
6. a root or child symbolic link or Windows junction is rejected without
   writing through it or traversing it during cleanup;
7. `.complete` is absent until the exact five-file on-disk set passes strict
   replay validation, then exists as a zero-byte regular file;
8. a missing, extra, malformed, or linked fixture prevents marker creation and
   success output;
9. a simulated marker-handle close failure is suppressed after successful
   exclusive marker open, retains the completed candidate, and still produces
   normal success output without a raw diagnostic;
10. the success log exactly contains the five-fixture count and portable
    repository-relative candidate path;
11. a capture failure after a partial fixture file removes the owned unmarked
    candidate, preserves the original programmatic failure, and emits no
    success log;
12. a simulated cleanup failure leaves only an unmarked `capture-*` directory
    that cannot qualify as a completed candidate;
13. a raw fake failure containing a native path and token is not present in
    public CLI output, while the programmatic runner preserves the original
    error; and
14. existing canonicalization, deterministic serialization, strict validation,
    and token-redaction tests continue to pass.

Tests will use isolated temporary directories and injected fakes. Mandatory
tests will not connect to live DataHub, start Docker, require credentials, or
call OpenAI.

## Documentation Changes

### README

The README will:

- replace the incorrect four-fixture statement with the five-file contract;
- explain that the command writes a fresh candidate beneath
  `tmp/datahub-fixture-captures/capture-*`;
- explain that only a candidate with an empty `.complete` marker and all five
  strictly valid fixtures is complete;
- state that committed fixtures are never overwritten by live capture;
- state that promotion requires a separate approved deterministic migration
  and review; and
- add `INCOMPLETE_EVIDENCE` to the report-status table.

`INCOMPLETE_EVIDENCE` means at least one required search, schema, table-lineage,
or column-lineage collection is incomplete. When enough evidence exists to
continue, LineageGuard still produces a report, but collected counts are lower
bounds and unknowns remain explicit. This status cannot justify a direct
rename.

Entity-context gaps remain part of Context Coverage. They do not, by
themselves, cause `INCOMPLETE_EVIDENCE`.

### Demo scenario

`docs/demo-scenario.md` will describe the same five-file candidate workflow,
safe destination, replay-only meaning, and separate reviewed-promotion step.
It will not imply that running the capture command updates the golden fixtures.

## Files in Scope

- Add
  `docs/superpowers/specs/2026-07-23-safe-datahub-fixture-recapture-design.md`.
- Modify `scripts/capture-datahub-fixtures.ts`.
- Modify `scripts/capture-datahub-fixtures.test.ts`.
- Modify `README.md`.
- Modify `docs/demo-scenario.md`.

No committed fixture, application status-derivation source, dependency,
lockfile, or CI file is in scope.

## Verification Strategy

After implementation:

1. run the focused capture-script test in RED and GREEN phases;
2. run the complete capture-script test file;
3. run repository formatting and lint checks;
4. run strict TypeScript checking;
5. run the complete offline test suite;
6. run the repository build;
7. run `git diff --check`;
8. inspect the focused diff and repository status; and
9. run repository secret scanning when available.

Live DataHub capture is not required for deterministic acceptance and must not
be reported as passing unless it is separately executed with the documented
environment gate.

## Acceptance Criteria

1. The documented capture command succeeds on a normal clean checkout when its
   live prerequisites are available.
2. Every successful invocation writes exactly five fixture files plus an empty
   `.complete` marker to a new
   `tmp/datahub-fixture-captures/capture-*` directory.
3. The command never writes to or modifies `tests/fixtures/datahub/`.
4. Every fixture and marker write remains create-only.
5. A candidate becomes complete only after the exact five-file set passes
   strict on-disk validation and an empty `.complete` marker is atomically
   created last.
6. A failed capture, validation, or marker open produces no completed candidate
   and emits no success message; a handle-close failure after successful marker
   open is suppressed and cannot downgrade completion.
7. Existing files and candidates are never truncated, overwritten, reused,
   traversed, or removed.
8. Runtime writes and cleanup reject path escape, symbolic links, and Windows
   junctions and never traverse an external target.
9. Output paths and public errors do not expose secrets, raw diagnostics, or
   unrestricted native paths.
10. Every named forbidden entity-context field and an overlong description are
    rejected before filesystem output.
11. Focused tests are deterministic, offline, isolated, and credential-free.
12. README and demo documentation accurately describe five fixtures, candidate
    capture, reviewed promotion, replay limitations, and
    `INCOMPLETE_EVIDENCE`.
13. Entity-context gaps remain separate Context Coverage information.
14. Committed fixtures, impact scoring, status derivation, dependencies,
    lockfile, and CI remain unchanged.
15. All applicable repository verification gates pass.

## References

- [Node.js 22 filesystem API](https://nodejs.org/download/release/v22.18.0/docs/api/fs.html)
- [POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)
