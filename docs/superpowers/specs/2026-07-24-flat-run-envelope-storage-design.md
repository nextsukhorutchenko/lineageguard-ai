# Flat Run Envelope Storage Design

**Status:** Proposed — design approved by the owner; written-spec review pending

**Date:** 2026-07-24

**Applies to:** `docs/specs/002-nextjs-openai-agent-demo/spec.md`, Task 6 and its downstream storage consumers
**Supersedes:** The nested `<runsRoot>/<runId>/package/manifest.json` persistence layout and directory-rename completion point

## Decision

LineageGuard AI will persist each terminal run as one immutable, versioned JSON envelope stored
directly beneath a trusted application-owned `LINEAGEGUARD_RUNS_DIR`.

The envelope replaces nested run directories, diagnostic files, package directories, and their
manifest file as the durable storage representation. Artifact filenames remain part of the public
application contract, but they are virtual keys inside the envelope rather than native paths.

This design uses only the approved Node.js toolchain. It does not add a native filesystem helper,
native package, database, or second persistence runtime.

## Reason for the Amendment

The original Task 6 design checked directory paths and then performed later path-based filesystem
operations. A deterministic Windows junction-swap reproduction proved that a checked run directory
could be replaced before `readFile` or `writeFile`, redirecting the operation outside the configured
root.

Node.js 22 does not expose the handle-relative and no-replace primitives needed to close this race
portably:

- no `openat`, `openat2`, `unlinkat`, `renameat`, or `renameat2`;
- no Windows handle-relative reparse-point-safe filesystem API;
- no portable `RENAME_NOREPLACE` directory rename.

The storage layout therefore changes instead of claiming a race guarantee that the runtime cannot
provide.

## Trust Boundary

`LINEAGEGUARD_RUNS_DIR` is a deployment boundary, not untrusted input.

Before use, the application must require that it:

- already exists as a real directory;
- is not a symbolic link or junction;
- resolves to the configured absolute location;
- is writable by the application; and
- is protected by operating-system permissions from untrusted writers.

The application does not attempt to defend against an attacker who can rename or replace the
configured root itself. It does defend against untrusted run IDs, filenames, envelope contents,
corruption, partial writes, concurrent application requests, and pre-existing final filenames.

Operator documentation must state this ownership and permission requirement.

## Flat Namespace

All durable application files are direct children of the trusted root.

- Terminal run: `run-<validated-run-id>.json`
- Temporary run: `.tmp-run-<random-nonce>.json`
- Retry reservation: `retry-<validated-parent-run-id>.json`
- Temporary reservation: `.tmp-retry-<random-nonce>.json`

Run IDs remain bounded by the existing safe run-ID grammar. Application responses, logs, events,
downloads, and CLI output expose run IDs and virtual artifact filenames only, never these native
paths.

No nested run, package, blob, staging, or lock directories are created.

## Terminal Envelope

The envelope uses a strict, versioned schema with no unknown keys. It contains:

- schema version;
- run ID, mode, optional parent run ID, and generation attempt;
- one terminal workflow snapshot;
- optional sanitized impact report;
- optional validated `ChangeContext`;
- optional validated `MigrationPackageDraft`;
- bounded sanitized validation findings;
- optional completed package;
- SHA-256 values for every stored serialized section and artifact.

The completed package is a strict map containing exactly:

- `migration-up.sql`;
- `migration-down.sql`;
- `validation.sql`;
- `rollout-plan.md`.

A `COMPLETED` envelope must contain the validated context, draft, all four artifacts, their hashes,
and a snapshot whose artifact entries match those hashes. A failed envelope must not contain a
public completed package. Cancelled, timed-out, or incomplete work is not persisted as completed.

Artifact bodies are stored directly in the envelope. Their SHA-256 values provide corruption and
contract checks; they are not an authorization mechanism.

## Atomic Create-Only Publication

Publication follows this sequence:

1. Validate and fully serialize the terminal envelope in memory within configured byte limits.
2. Create a random temporary file directly under the trusted root using exclusive creation.
3. Write through the returned file handle, verify the byte count, and synchronize the file.
4. Atomically create a hard link from the temporary file to the final run filename.
5. Treat successful hard-link creation as the only completion linearization point.
6. Close handles and remove only the temporary filename created by this call.

Hard-link creation fails when the final filename already exists, providing create-only concurrency
semantics without replacing another run. A crash before step 4 leaves only an ignored temporary
file. A crash after step 4 leaves the complete immutable final envelope, even if temporary cleanup
did not run.

Cleanup is conservative. It may unlink only the unique temporary filename created by the same
operation. It never removes a final run or reservation filename during rollback.

## Reads and Downloads

Readers operate only on validated final filenames directly beneath the trusted root.

For every read they must:

1. reject unexpected names before filesystem access;
2. reject non-regular final entries;
3. inspect the file size and reject it above the configured envelope limit;
4. read through one file handle without path fallback;
5. parse the strict envelope schema;
6. validate run ID, mode, parent, status, hashes, and cross-field invariants;
7. return only the requested bounded application value.

Completed artifact downloads resolve an allowlisted virtual filename from the verified package map.
There is no filesystem-path download API and no fallback to diagnostic data after envelope
validation fails.

Regeneration loads only an eligible terminal envelope, verifies its stored and recomputed context
hash, and requires the expected mode and parent relationship.

## Retry Reservation

A generation retry is reserved by publishing one immutable reservation envelope with the same
temporary-file and hard-link protocol.

The reservation contains only:

- schema version;
- parent run ID;
- child run ID;
- required child mode;
- generation attempt.

Exactly one concurrent reservation for a parent can win. Every child workflow and child terminal
writer must receive the branded reservation returned after successful publication. Rollback removes
only the caller's unique temporary file; it never removes a final reservation or child run.

## Error and Cancellation Semantics

Filesystem, parsing, hashing, abort, and integrity failures cross the storage boundary only as fixed
typed application errors. Custom `AbortSignal` reasons, dependency messages, native paths, raw
envelope fragments, and causes are not copied into public errors.

Cancellation before the final hard link leaves no visible terminal run. Cancellation after the
link cannot relabel, remove, or invalidate the published terminal envelope.

## Compatibility

This branch has not published a supported run-storage format, so no data migration is required.
The current nested-directory implementation may be replaced directly.

Downstream application, API, UI, and tests continue to use run IDs and virtual artifact filenames.
They must not depend on native directory structure.

## Verification

The implementation must include deterministic offline tests for:

- exclusive publication with two concurrent writers, proving exactly one winner;
- crash or injected failure before hard-link publication;
- cancellation immediately before and immediately after publication;
- pre-existing regular file, symlink, junction, and unknown final entry;
- oversized, truncated, malformed, extra-key, and hash-tampered envelopes;
- exact completed and failed envelope invariants;
- four-file allowlist and virtual downloads;
- run ID, mode, parent, attempt, and context-hash mismatches;
- retry-reservation races and mandatory branded child authorization;
- conservative temporary cleanup that cannot delete final or competitor-owned entries;
- bounded reads and writes at exact maximum and maximum-plus-one;
- fixed public errors for secret-bearing dependency and abort reasons;
- absence of native root paths from stdout, stderr, NDJSON, metadata, logs, and thrown public errors;
- normal formatting, lint, typecheck, CLI build, full offline tests, diff checks, and credential scan.

Live DataHub and OpenAI services are not required for this storage boundary.

## Rejected Alternatives

### Native filesystem helper

A Rust or native addon could expose Linux `openat2`/`renameat2` and Windows handle-relative APIs,
but it would add a second compiled runtime, platform packaging, and CI complexity that is
disproportionate for the local hackathon demo.

### Retain the nested layout and trust check-then-act validation

This preserves the original file layout but knowingly retains a demonstrated junction/symlink
TOCTOU vulnerability. It does not satisfy the approved engineering baseline.
