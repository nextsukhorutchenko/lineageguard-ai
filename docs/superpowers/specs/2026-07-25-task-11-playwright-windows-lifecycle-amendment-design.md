# Task 11 Playwright Windows Lifecycle Amendment Design

**Status:** Approved
**Date:** 2026-07-25
**Authority:** Owner-approved amendment A for Task 11

## Problem

Task 11's four Chromium scenarios pass, but the prescribed Playwright `webServer` configuration
does not complete on Windows. After the tests finish, Playwright logs `Terminating the WebServer`,
invokes its Windows process-tree termination path, and waits indefinitely for the spawned shell
process to close. The runner never reaches `globalTeardown`, the command has to be terminated by an
external timeout, and the harness-owned runs root remains on disk.

Changing `pnpm dev` to a direct Next.js command does not correct the failure because Playwright
still launches the configured web server through its own shell-managed process. Playwright's
documented `gracefulShutdown` option cannot solve this platform defect because `SIGTERM` and
`SIGINT` shutdown configuration is ignored on Windows.

## Goal

Make `pnpm test:e2e --project=chromium` terminate with a truthful exit code after the existing
golden, cancellation, regeneration, and phone-viewport scenarios while preserving isolated
server-owned replay data and guarded cleanup.

## Non-Goals

- Do not change application runtime behavior, routes, UI acceptance criteria, ports, or timeouts.
- Do not upgrade, patch, or replace Playwright, Next.js, or any other dependency.
- Do not reuse an independently running server.
- Do not add forced `process.exit`, hide a timeout, weaken an assertion, or describe an externally
  terminated run as passing.
- Do not enable live DataHub, OpenAI, mutation, SQL execution, or credentials.

## Selected Architecture

Replace Playwright's `webServer` process ownership with a harness-owned lifecycle started by
Playwright `globalSetup`.

### Configuration

`playwright.config.ts` retains:

- `baseURL: "http://127.0.0.1:3107"`;
- the Chromium project and existing retry, reporter, screenshot, and trace behavior;
- `reuseExistingServer: false` semantics, enforced by the lifecycle refusing to start when the
  fixed endpoint is already serving.

The configuration removes `webServer` and points `globalSetup` to
`tests/e2e/global-setup.ts`. The setup function returns the teardown closure supported by
Playwright, so server ownership and cleanup remain in one lifecycle.

### Server Lifecycle

Create `tests/e2e/server-lifecycle.ts` with one focused responsibility: own a single bounded Next.js
test-server process.

Startup:

1. Refuse to start if `127.0.0.1:3107` is already accepting requests.
2. Create an absolute runs root with `mkdtemp` directly beneath the operating-system temporary
   directory using the `lineageguard-playwright-runs-` prefix.
3. Resolve the installed, lockfile-pinned Next.js CLI from the current package and spawn it through
   `process.execPath` with `shell: false` and the explicit `--webpack` flag. This preserves the
   repository toolchain's established `.js`-to-TypeScript extension alias behavior and prevents
   the direct CLI invocation from silently selecting incompatible Turbopack defaults.
4. Pass only the inherited non-secret environment plus:
   `LINEAGEGUARD_DEMO_MODE=REPLAY` and the owned `LINEAGEGUARD_RUNS_DIR`.
5. Drain stdout and stderr while retaining only a bounded diagnostic tail.
6. Poll `/` until it returns HTTP 200 or the existing 120-second startup deadline expires. Each
   probe is individually bounded.
7. If startup fails, terminate the owned process tree, clean the owned root after termination is
   confirmed, and throw a bounded fixed harness error.

Shutdown:

1. The returned teardown is idempotent.
2. On Windows, terminate only the recorded direct child PID and descendants using a bounded
   `taskkill /PID <pid> /T /F` execution without a shell.
3. On non-Windows systems, terminate the owned process group with a bounded graceful-to-forceful
   fallback.
4. Wait for the recorded child to close and verify that the fixed endpoint is no longer accepting
   requests.
5. Only after server termination is confirmed, canonicalize and remove the harness-owned runs
   root.
6. If the process or endpoint remains live, fail teardown and retain the root rather than deleting
   data that a live process may still use.

No application route can select, configure, or bypass this test-only lifecycle.

### Root Cleanup

Refactor `tests/e2e/global-teardown.ts` into a reusable guarded cleanup helper. It accepts the
specific root created by setup and removes it only when:

- it is absolute;
- its canonical parent equals the canonical operating-system temporary directory; and
- its basename begins with `lineageguard-playwright-runs-`.

The helper confirms removal before returning. Native paths and raw process errors are not emitted
to browser output or application responses.

## Error Handling

- Startup, readiness, termination, port-release, and cleanup operations are individually bounded.
- Setup failure invokes the same idempotent teardown path before rethrowing a fixed harness error.
- Bounded diagnostic tails may be included only in local test-runner diagnostics after control and
  escape characters are sanitized; they are never rendered or persisted as application data.
- A failed teardown remains a failed Playwright command. No cleanup failure is swallowed.

## Verification

Follow strict RED-GREEN evidence:

1. Preserve the existing RED evidence: all four tests report success, then the command is
   externally timed out while Playwright waits in Windows `webServer` termination.
2. Add focused integration coverage for the guarded root cleanup:
   - an owned temporary root is removed;
   - a root outside the exact owned boundary is rejected and remains untouched.
3. Run the amended `pnpm test:e2e --project=chromium` without an external success override and
   require:
   - four of four scenarios pass;
   - the command exits with code 0;
   - port 3107 is no longer listening;
   - the owned temporary root is absent.
4. Run Task 11's build, runtime-mode, unit, lint, typecheck, formatting, and diff checks.
5. Keep live DataHub and OpenAI checks explicitly separate and unexecuted for this amendment.

## References

- [Playwright web server configuration](https://playwright.dev/docs/test-webserver)
- [Playwright global setup and teardown](https://playwright.dev/docs/test-global-setup-teardown)
