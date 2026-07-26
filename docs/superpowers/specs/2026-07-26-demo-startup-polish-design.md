# Demo Startup Polish Design

**Status:** Approved

**Date:** 2026-07-26

**Authority:** This design is a narrow corrective amendment to approved specification
`002-nextjs-openai-agent-demo`. It does not change the product scope, runtime trust boundaries,
agent behavior, DataHub access, artifact behavior, or hosting decision.

## Problem

The production demo currently builds with `output: "standalone"` but starts with `next start`.
Next.js reports that these modes are incompatible. The browser also requests a favicon that is not
present and records a non-blocking HTTP 404 error.

The approved product is a local browser demo, and hosted deployment remains out of scope. The
production start contract should therefore use the standard local `next start` mode without a
standalone build output.

## Chosen Approach

1. Remove `output: "standalone"` from `next.config.ts`.
2. Keep the existing `start:web` command as `next start`.
3. Add a repository-owned SVG application icon through the Next.js App Router metadata-file
   convention.
4. Preserve all existing build flags, ESM and TypeScript conventions, runtime modes, API routes,
   security boundaries, and dependency versions.

No standalone asset-copying script, secondary production-start mode, image dependency, or hosted
deployment configuration will be added.

## Branding Asset

The favicon will be a small English-free visual mark stored as `app/icon.svg`. It will use the
existing LineageGuard `LG` identity and a simple high-contrast treatment suitable for browser-tab
sizes. The SVG must contain no scripts, external references, embedded data, or dynamic content.

Next.js must publish an icon link in the rendered document, and the referenced icon URL must return
HTTP 200.

## Testing

Implementation will follow TDD:

1. Extend the toolchain smoke contract to require that the Next.js configuration does not request
   standalone output while `start:web` remains `next start`.
2. Run the focused smoke test and observe the expected failure against the current configuration.
3. Extend browser acceptance coverage to require a rendered icon link and HTTP 200 for its target.
4. Run the focused browser test and observe the expected failure while the icon is absent.
5. Apply the smallest production changes and rerun the focused tests to green.

The final preflight must include:

- formatting, linting, strict type checking, offline tests, production build, built-runtime checks,
  and Chromium browser acceptance;
- a production `start:web` smoke proving the prior standalone warning is absent;
- a browser console check proving the prior favicon 404 is absent;
- DataHub GMS and UI health checks;
- the pinned read-only DataHub MCP integration test;
- repository secret scanning and focused Git diff inspection.

The preflight does not repeat the paid live OpenAI generation because the requested verification
concerns startup and static browser behavior, not agent-output behavior.

## Acceptance Criteria

- `pnpm build:web` succeeds.
- `pnpm start:web` serves the built local demo without the standalone-output incompatibility
  warning.
- The rendered page declares the repository-owned favicon.
- The favicon request returns HTTP 200 and produces no browser-console 404.
- Existing replay and live mode behavior remains unchanged.
- No dependencies or lockfile entries change.
- No credentials, generated run data, or unrelated local changes are committed.
