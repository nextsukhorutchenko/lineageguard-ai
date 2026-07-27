# Public Replay Deployment Design

**Status:** Approved

**Date:** 2026-07-26

**Authority:** This design is a narrow hosted-deployment amendment to approved specification
`002-nextjs-openai-agent-demo`. It supersedes only the statement that hosted deployment and a
public hosted demo are out of scope. The approved local `LIVE` and `REPLAY` contracts, deterministic
impact authority, read-only DataHub boundary, artifact validation, storage integrity rules, and
human-approval requirements remain authoritative.

## Problem

The implemented browser demo and its certified fixture replay are available only from a local
checkout. The hackathon submission checklist requires a free, judge-accessible Project URL that
does not require DataHub, OpenAI, credentials, or a paid account. A hosted `LIVE` service would
unnecessarily expose credentials and external dependencies, while a static imitation would weaken
the evidence that judges are using the real application workflow.

LineageGuard AI therefore needs one narrowly scoped public deployment of the existing deterministic
replay path.

## Goals

- Publish the real Next.js application as one free Render Native Node Web Service.
- Give judges an HTTPS URL that runs the certified golden replay without authentication or secrets.
- Preserve the existing deterministic `24 / 11 / 90` result, `BLOCK_DIRECT_RENAME` decision, and
  four validated artifacts.
- Keep the public deployment fail-closed, resource-bounded, single-instance, and explicitly labeled
  as replay.
- Keep mandatory repository and CI checks offline, deterministic, and credential-free.
- Freeze the accepted submission deployment to a reviewed commit through the judging-access period.

## Non-Goals

- Hosted `LIVE` mode.
- OpenAI, DataHub, MCP, database, GitHub, or other external-service credentials.
- Authentication, user accounts, per-user history, or authorization.
- Durable or multi-user storage.
- Custom domains, Docker images, external databases, persistent disks, or multi-instance scaling.
- New schema-change types, impact rules, risk thresholds, agent behavior, or artifact formats.
- SQL execution, DataHub mutation, automated approval, or repository automation.
- General-purpose public API access or arbitrary replay requests.

## Chosen Approach

Use one Render Native Node Web Service on the free instance type. Render builds the existing
application from the repository and starts the standard production server with `next start`.

The deployment uses the existing `REPLAY` runtime mode plus a new
`LINEAGEGUARD_DEPLOYMENT_PROFILE=PUBLIC_REPLAY` operational profile. `PUBLIC_REPLAY` does not add a
third evidence mode. It restricts the existing replay path for unauthenticated public use.

The accepted free-tier limitations are:

- the service may spin down after inactivity;
- the first request after spin-down may take approximately one minute;
- the local filesystem is ephemeral;
- runs can disappear after a restart, redeploy, or spin-down; and
- a judge may need to rerun the deterministic scenario.

The public copy and operator documentation must state these limitations without implying durable
history or always-on production service.

## Architecture

```text
Judge browser
  -> Render-managed HTTPS
  -> Next.js production server
  -> PUBLIC_REPLAY admission boundary
  -> existing REPLAY route and workflow
  -> certified fixture catalog
  -> deterministic fake agent provider
  -> deterministic validation and rendering
  -> ephemeral immutable run envelope
  -> four allowlisted virtual artifacts
```

The deployment contains one application instance and one deployment-owned runs root. It never
launches the DataHub MCP subprocess, calls OpenAI, connects to a database, or performs repository
operations.

## Components

### Render Blueprint

A repository-owned Render Blueprint declares:

- one Native Node Web Service on the free instance type;
- the exact build and start commands;
- the `/api/health` health-check path;
- non-secret `PUBLIC_REPLAY` and `REPLAY` environment configuration;
- automatic deploys disabled; and
- no disk, database, worker, cron job, private service, or secret environment values.

The Blueprint must not contain account identifiers, tokens, private paths, or generated service
URLs.

### Deployment Bootstrap

A small repository-owned deployment bootstrap is the operator boundary that runs before the
application server. It:

1. validates `PUBLIC_REPLAY`, `REPLAY`, the configured absolute runs-root path, and Render's port;
2. rejects `LIVE` mode and non-empty OpenAI or DataHub credential variables;
3. creates only the exact deployment-owned runs root with private permissions when it is absent;
4. rejects a root that is a file, symbolic link, or a path that does not resolve to itself;
5. verifies that the resulting directory is writable;
6. starts the existing Next.js production server on `0.0.0.0` and the supplied port; and
7. forwards shutdown signals and returns the child server's terminal status.

The bootstrap is allowed to create this one hosted deployment root. Application request handlers,
the CLI, and all other runtime paths continue to require a pre-created trusted root and do not gain
directory-creation authority.

### Public Replay Profile

The public profile:

- requires the existing `REPLAY` mode;
- uses only the certified fixture catalog and deterministic fake provider;
- accepts exactly the golden request:
  `Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details`;
- renders the input fields as fixed evidence for the public demo;
- keeps Analyze, Regenerate, preview, copy, and download interactions available;
- displays `Public fixture replay` as the visible mode label; and
- rejects any attempt to select `LIVE`, provide a provider key, or submit another request.

The ordinary local `REPLAY` label and behavior remain unchanged when the public profile is absent.

### Admission Boundary

One process-local admission controller protects the free instance:

- at most two root or regeneration workflows may execute concurrently;
- a slot is released after success, typed failure, cancellation, or timeout;
- at most 64 immutable run envelopes may be published during one process lifetime;
- the envelope limit includes parent and regeneration runs;
- admission and capacity accounting are deterministic and reentrancy-safe; and
- accounting or storage-inspection uncertainty fails closed.

The admission controller is intentionally not an authentication or distributed rate-limiting
system. The service remains single-instance. A restart clears the ephemeral root and process-local
accounting. No runtime garbage collector deletes published envelopes.

## Data and Trust Boundaries

The certified fixtures, fake provider, deterministic decision logic, and validators remain product
authority. The browser, public requests, Render headers, filesystem contents, and deployment
environment remain untrusted.

The hosted runs root remains:

- absolute;
- deployment-owned;
- a real writable directory;
- non-symbolic;
- ephemeral; and
- private to the application account.

Every terminal run remains a bounded, immutable, create-only envelope. Only the four allowlisted
virtual artifacts may be returned. Native paths, private envelope fields, hashes, model/provider
objects, raw payloads, and environment values remain non-public.

## HTTP and Browser Security

The public deployment must:

- return `Cache-Control: no-store` for run, regeneration, artifact, and health responses;
- return `X-Content-Type-Options: nosniff`;
- return `Referrer-Policy: no-referrer`;
- prevent framing with `X-Frame-Options: DENY`;
- preserve strict request, NDJSON, envelope, and artifact byte limits;
- preserve workflow, provider, persistence, cancellation, and overall deadlines; and
- never trust client IP addresses or forwarding headers as an authorization boundary.

No response, page, log, health result, or public artifact may contain credentials, private native
paths, raw stack traces, unrestricted diagnostics, or hidden instructions.

## Health and Error Handling

`GET /api/health` validates the public profile and trusted runs-root boundary. A healthy response is
HTTP 200 with only:

```json
{ "status": "ok", "mode": "PUBLIC_REPLAY" }
```

An unhealthy response is HTTP 503 with a fixed sanitized body and no diagnostics.

Public workflow errors use bounded typed application responses:

- no admission slot: `429 DEMO_BUSY`;
- envelope capacity reached: `503 DEMO_CAPACITY_REACHED`;
- unsupported public request: `400 INVALID_REQUEST`;
- expired ephemeral run or artifact: the existing safe not-found response plus the UI recovery
  instruction `Run expired; analyze again.`;
- unsafe or incomplete deployment configuration: startup failure before the new version becomes
  healthy.

The UI keeps controls recoverable after transient failures and never marks a failed, cancelled,
expired, or capacity-rejected run as completed.

## Build, Release, and Rollback

The build uses:

- Node.js `22.23.1`;
- pnpm `10.10.0` through Corepack;
- `pnpm install --frozen-lockfile`; and
- the existing production build.

The hosted build does not install DataHub CLI, MCP Server, Playwright browsers, or live-provider
credentials.

Automatic deploys remain disabled. The owner deploys only a commit SHA that has passed GitHub CI,
the local production preflight, submission validation, and secret scanning. Before final Devpost
submission, the Project URL is bound to the immutable submission commit or tag and remains
available through the documented judging-access end.

Rollback redeploys the preceding verified commit. No storage migration or recovery is required
because hosted runs are ephemeral. A failed new deploy must not replace the last healthy version.

## Documentation and Submission Evidence

The implementation updates:

- `README.md` with the public URL, mode boundary, cold-start note, ephemeral-run recovery, and
  no-credential statement;
- `docs/submission-checklist.md` only after a person verifies the corresponding manual gates;
- `docs/resources-and-attribution.md` with the official Render deployment and free-tier
  documentation used as references; and
- the Devpost-ready evidence text with the distinction between local `LIVE` proof and hosted
  `PUBLIC_REPLAY`.

The implementation must not automatically modify GitHub About, publish a video, submit Devpost,
post to Slack, or claim durable production availability.

## Test Strategy

Implementation follows test-driven development.

### Focused Unit and Contract Tests

- `PUBLIC_REPLAY + REPLAY` is accepted.
- `PUBLIC_REPLAY + LIVE` is rejected.
- Non-empty OpenAI or DataHub credentials are rejected in the public profile.
- The bootstrap creates only the configured root with private permissions.
- The bootstrap rejects a file, symbolic link, wrong canonical path, unwritable root, invalid port,
  or unsafe configuration.
- Shutdown and startup failure do not leave an unmanaged child server.
- Only the exact golden request is admitted.
- A third concurrent workflow receives `DEMO_BUSY`.
- Completion, typed failure, cancellation, and timeout release a slot.
- Same-turn and reentrant acquisition cannot exceed the concurrency limit.
- The sixty-fifth published envelope receives `DEMO_CAPACITY_REACHED`.
- Parent and regeneration envelopes share one capacity budget.
- Storage or accounting uncertainty fails closed.
- Health responses are fixed, bounded, and contain no paths or environment data.
- Run, regeneration, artifact, and health responses use the required cache and security headers.
- Render Blueprint validation rejects secrets, non-free resources, missing health checks, mutable
  installation commands, and enabled automatic deploys.

### Offline Integration and Browser Tests

A Render-like local production harness must:

- use an isolated absolute temporary runs root;
- start the built application through the deployment bootstrap;
- render the `Public fixture replay` label;
- complete the golden workflow with 24 downstream assets, 11 column-confirmed assets, risk score 90,
  and `BLOCK_DIRECT_RENAME`;
- expose exactly four previewable and downloadable artifacts;
- return the repository-owned favicon;
- emit no browser console errors or warnings;
- make no DataHub or OpenAI network calls;
- prove admission, capacity, expiration, and recovery behavior; and
- terminate the server and remove only its harness-owned temporary root.

All existing offline unit, contract, runtime-mode, browser, submission, and security tests remain
green. Mandatory CI remains offline and does not contact Render.

### Public Acceptance

Before merge:

1. Deploy the reviewed commit manually to the free Render service.
2. Require HTTP 200 from `/api/health`.
3. Open the HTTPS Project URL in a private browser session without credentials.
4. Allow for the documented cold start.
5. Complete the golden workflow and verify `24 / 11 / 90`, `BLOCK_DIRECT_RENAME`, and four artifacts.
6. Verify the visible `Public fixture replay` label.
7. Verify preview, copy, and all four downloads.
8. Verify no browser console errors or warnings and no credential-bearing requests.
9. Run the final repository submission validator, working-tree and history secret scans, focused
   diff review, and whole-branch review.
10. Record only sanitized URL, commit, and outcome evidence in the repository.

The deployment PR may merge only after GitHub CI and public acceptance both pass.

## Acceptance Criteria

- A free Render HTTPS Project URL serves the real LineageGuard Next.js application.
- Access requires no login, API key, DataHub service, OpenAI account, or paid account.
- The page is explicitly labeled `Public fixture replay`.
- The exact golden request completes with 24 downstream assets, 11 column-confirmed assets, score
  90, `BLOCK_DIRECT_RENAME`, and four validated artifacts.
- Hosted execution performs no DataHub, OpenAI, SQL, mutation, or GitHub operation.
- Startup fails closed for LIVE mode, credentials, unsafe storage, or invalid deployment
  configuration.
- The service enforces two concurrent workflows and 64 published envelopes per process lifetime.
- Ephemeral expiration is truthful and recoverable by rerunning the replay.
- Required cache, browser-security, health, bounded-error, and redaction contracts pass.
- No dependency version or lockfile entry changes unless a later owner-approved amendment explicitly
  requires it.
- Existing local `LIVE` and `REPLAY` behavior remains unchanged.
- Required offline CI, public acceptance, submission validation, secret scans, and whole-branch
  review pass.
- The verified deployment is frozen to an immutable submission commit or tag through the judging
  access period.
