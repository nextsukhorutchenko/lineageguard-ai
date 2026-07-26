# Task 10 Bounded Transport and Route Safety Remediation Design

**Status:** Approved

**Date:** 2026-07-25

## Context

Task 10 introduced the streamed Next.js run, reload, regeneration, and virtual-artifact routes.
Its independent review found that the route architecture and strict run-store boundaries were
present, but the plan-mandated `request.json()`, `request.text()`, and unbounded NDJSON buffering
conflicted with the repository requirement to size-bound all untrusted input before parsing or
decision use. The same review found that the required cancellation, persistence, regeneration,
secret-safety, and storage-tampering regression matrix was incomplete.

The project owner approved correcting the plan snippets so the specification and repository trust
rules govern. The owner selected the balanced transport profile defined below.

## Goals

- Bound untrusted HTTP request bodies before JSON or text parsing.
- Bound NDJSON lines, total response bytes, and event count before event parsing or callback use.
- Preserve the existing strict schemas, fixed public errors, cancellation model, immutable
  publication boundary, and virtual-artifact policy.
- Add executable coverage for every Task 10 safety and race requirement identified by review.
- Keep ordinary verification deterministic, offline, and credential-free.

## Non-Goals

- No Task 11 UI or browser-layout work.
- No live DataHub or OpenAI calls.
- No rate limiter, authentication layer, proxy, middleware stack, or second runtime.
- No changes to the workflow, impact, deadline, storage-envelope, or artifact policies.
- No rewrite of the repository-wide NodeNext `.js` relative-import convention.

## Selected Approach

Use one shared bounded HTTP-body module and keep NDJSON limits in the existing NDJSON boundary.

This is preferred over route-local parsing because it gives both public POST handlers one audited
byte-counting implementation and prevents their failure behavior from drifting. Framework-only
limits are insufficient because they do not protect the client-side NDJSON decoder and do not
provide the required deterministic tests at the application boundary.

## Components

### Bounded HTTP Body Reader

Add `src/http/bounded-body.ts` and focused colocated tests.

The module:

- checks a valid non-negative `Content-Length` as an early rejection hint;
- treats the streamed byte count as authoritative;
- reads raw `Uint8Array` chunks without first materializing an unbounded string;
- rejects as soon as the configured byte limit is exceeded;
- decodes accepted content with a fatal UTF-8 decoder;
- cancels or releases the reader on every success and failure path; and
- returns bounded text or a fixed typed internal result without preserving raw content in errors.

The initial run route uses a limit of **8,192 bytes**. Only after the byte and UTF-8 checks pass
does it parse JSON and apply `RunRequestSchema`.

The regeneration route requires **exactly zero body bytes**. A positive `Content-Length` rejects
before reading. Without a usable length header, the handler reads only until the first byte,
cancels immediately, and rejects. Whitespace is a body and is therefore rejected.

### Bounded NDJSON Decoder

Update `src/ui/read-ndjson.ts` and its focused tests.

The decoder enforces all three limits against raw bytes before parsing:

- **4,194,304 bytes per event line**;
- **16,777,216 bytes for the complete response stream**; and
- **128 non-empty events**.

The decoder must handle JSON lines and multi-byte UTF-8 sequences split across chunks. It rejects
an over-limit unterminated line before its buffer can grow past the event cap. It validates every
decoded value with `WorkflowEventSchema` before invoking the callback. The reader is cancelled or
released on all terminal paths.

## Data Flow

### Initial Run

1. Read at most 8 KiB of raw request bytes.
2. Decode strict UTF-8.
3. Parse JSON and validate the strict `RunRequestSchema`.
4. Load server configuration and preflight the trusted runs root.
5. Construct workflow dependencies and stream schema-valid events.

Any failure in steps 1-3 returns HTTP 400 with only `Invalid rename request.`

### Regeneration

1. Prove that the request body contains zero bytes.
2. Load server configuration and preflight the trusted runs root.
3. Allocate the server-owned run ID and construct regeneration dependencies.
4. Invoke the existing regeneration application boundary and stream schema-valid events.

Any body byte returns HTTP 400 with only `Invalid regeneration request.`

### NDJSON Consumption

1. Reject an unavailable response or missing body.
2. Count raw response bytes and current line bytes.
3. Decode one bounded UTF-8 line.
4. Parse JSON and validate `WorkflowEventSchema`.
5. Count the validated event and invoke the callback.

Transport, UTF-8, JSON, schema, or count failures produce only
`Workflow stream is invalid.` No raw line, exception, secret, or path is included.

## Cleanup and Failure Contracts

- Body and NDJSON readers do not remain locked after success, rejection, cancellation, or callback
  failure.
- An early `Content-Length` rejection never starts provider, catalog, DataHub, workflow, or
  persistence work.
- A lying or missing `Content-Length` cannot bypass streamed byte accounting.
- Public route errors remain fixed and path-free.
- The implementation never logs or serializes raw request bodies, NDJSON lines, exception
  messages, abort reasons, credentials, or native paths.
- Existing terminal snapshot and immutable hard-link publication semantics remain authoritative.

## Required TDD Coverage

### Transport Boundaries

- exact 8 KiB run body and one byte over;
- zero-byte regeneration and any single byte, including whitespace;
- missing, malformed, negative, truthful, and understated `Content-Length`;
- chunk-split input and split multi-byte UTF-8;
- invalid UTF-8;
- exact 4 MiB NDJSON event and one byte over;
- exact 16 MiB response total and one byte over;
- 128 events and event 129;
- oversized unterminated NDJSON line;
- reader cleanup on success and every rejection path.

### Stream and Persistence Behavior

- pre-abort and abort after stream creation use the same cancellation path;
- a connected client receives exactly one terminal cancellation or deadline snapshot;
- a disconnected controller does not prevent required persistence;
- an unclassified workflow failure persists and reloads the same closed fallback;
- persistence failure still streams only the closed fallback; and
- an abort after final-envelope hard-link publication reloads authoritative `COMPLETED`, not
  `CANCELLED`.

### Regeneration

- both REPLAY and LIVE server modes;
- empty-body enforcement;
- configuration and storage-preflight failures;
- pre-abort;
- persisted-parent/server-mode mismatch;
- server-owned secret propagation to the sanitizer boundary;
- a fresh run retaining the parent context hash; and
- an explicit assertion that no DataHub catalog or call is constructed.

### Secret and Storage Safety

- the Task 9 adversarial secret sentinel is absent from the provider request/context, route body,
  NDJSON events, validated internal envelope, reload response, all four virtual downloads,
  captured logs, and error text;
- sanitized markers and bounded diagnostics remain;
- missing, hash-tampered, invariant-tampered, malformed, linked, and traversal final entries return
  the fixed 404 response without native paths;
- missing, relative, nonexistent, regular-file, directory-symlink, and Windows-junction roots fail
  preflight; and
- SQL and Markdown downloads have the exact required content type, disposition, no-store, and
  nosniff headers.

## Scope

The corrective implementation may modify the existing Task 10 route, dependency, NDJSON, and API
test files and add:

- `src/http/bounded-body.ts`
- `src/http/bounded-body.test.ts`

The approved Task 10 plan must be amended with these files, limits, fixed error contracts, cleanup
rules, and complete test matrix before implementation resumes.

## Acceptance

The remediation is complete only when:

- every review finding is covered by a RED test and corrected;
- the focused transport and route suites pass;
- the affected Task 10 selection and full offline suite pass;
- clean-copy typecheck, format, lint, CLI build, and Webpack production build pass;
- diff, status, and credential scans are clean; and
- an independent scoped re-review marks all four findings addressed with no new Critical or
  Important breakage.
