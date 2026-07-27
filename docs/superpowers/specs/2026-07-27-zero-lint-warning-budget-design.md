# Zero Lint Warning Budget Design

**Status:** Approved

**Date:** 2026-07-27

**Authority:** This design is a narrow CI and toolchain hardening amendment. It does not change
product behavior, runtime modes, dependencies, deployment behavior, DataHub or OpenAI boundaries,
or artifact contracts.

## Problem

The repository's pinned ESLint configuration currently reports one
`import/no-anonymous-default-export` warning for `prettier.config.mjs`. The shared `pnpm lint`
command exits successfully because it does not set a warning budget, so GitHub Actions can remain
green when lint warnings are introduced.

A successful lint gate that still permits warnings weakens the repository's engineering baseline
and can allow new quality regressions to accumulate unnoticed.

## Chosen Approach

1. Replace the anonymous default export in `prettier.config.mjs` with a named configuration object
   and export that object as the default.
2. Change the shared `lint` package script to run `eslint . --max-warnings 0`.
3. Keep GitHub Actions on the existing `pnpm verify:offline` path. Because that path invokes
   `pnpm lint`, local verification and CI will enforce the same zero-warning contract.
4. Extend the focused toolchain contract to require the exact zero-warning lint command.
5. Add an executable lint-gate test that proves both paths:
   - a warning-free configuration target exits successfully; and
   - a temporary source file that triggers an ESLint warning exits unsuccessfully under the
     zero-warning budget.
6. Keep the temporary negative fixture outside committed repository content and remove it in test
   cleanup, including after an assertion or subprocess failure.

## Why This Approach

ESLint already provides the required fail-on-warning behavior. Using its native
`--max-warnings 0` option keeps the implementation small and avoids a custom output parser or a
second CI-only lint command.

Placing the policy in the shared package script prevents local and CI behavior from diverging.
Fixing the existing warning at its source keeps output clean without disabling or weakening the
rule. Executable positive and negative coverage proves that the new gate both accepts clean input
and rejects warning-producing input.

## Safety and Determinism

The lint gate remains offline and credential-free. The executable test will invoke the repository's
pinned ESLint binary directly, use fixed arguments including `--no-ignore`, bound the subprocess
duration, capture bounded output, and create its temporary fixture beneath an ignored
repository-local test directory.

The negative fixture will contain no secrets, external content, native paths, or terminal control
sequences. Test assertions will use fixed repository-owned expectations rather than exposing raw
subprocess output.

No ESLint rule severity will be reduced, no file will be excluded from linting, and no existing CI
gate will be removed or weakened.

## Testing

Implementation will follow RED-GREEN TDD:

1. Amend the focused toolchain test to require `eslint . --max-warnings 0` and observe the expected
   failure while the package script still permits warnings.
2. Add executable positive and negative cases that exercise the pinned ESLint binary with the same
   zero-warning option used by the shared command.
3. Update the package script and verify the focused toolchain contract passes.
4. Replace the anonymous Prettier configuration export and verify `pnpm lint` reports zero errors
   and zero warnings.
5. Run formatting, strict type checking, the affected smoke suite, the full offline gate, tree
   cleanliness checks, diff checks, and repository secret scans.

## Acceptance Criteria

- `pnpm lint` exits successfully with zero errors and zero warnings on the repository.
- `pnpm lint` exits unsuccessfully when ESLint observes at least one warning.
- GitHub Actions enforces the same zero-warning lint command through `pnpm verify:offline`.
- `prettier.config.mjs` no longer triggers `import/no-anonymous-default-export`.
- Executable positive and negative tests cover the warning-budget gate.
- Temporary lint fixtures are deterministic, ignored, bounded, and removed after every test path.
- No lint rule, file coverage, CI permission, immutable action pin, frozen-lockfile behavior, or
  existing verification gate is weakened.
- No dependency, lockfile, runtime, UI, API, deployment, DataHub, OpenAI, or artifact behavior
  changes.
