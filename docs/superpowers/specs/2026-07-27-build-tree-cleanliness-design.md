# Build Tree Cleanliness Design

**Status:** Approved

**Date:** 2026-07-27

**Last amended:** 2026-07-27 — Amendments A1 and A2 approved: treat `next-env.d.ts` as generated
Next.js output, make type generation an explicit part of strict type checking, and make the CI
cleanliness failure path quiet, fail-closed, and test-environment independent.

**Authority:** This design is a narrow corrective amendment to approved specification
`002-nextjs-openai-agent-demo` and the existing CI contract. It does not change product behavior,
runtime modes, deployment behavior, dependency versions, DataHub or OpenAI boundaries, or
artifact contracts.

## Problem

The pinned Next.js `16.2.11` toolchain owns `next-env.d.ts` and generates mode-specific route-type
imports. `next build` and `next typegen` generate `.next/types/routes.d.ts`, while `next dev`
generates `.next/dev/types/routes.d.ts`. No single tracked file can remain stable across the
repository's production-build and development-server verification paths.

The CI workflow starts from a clean checkout and runs the production build as part of
`pnpm verify:offline`, but it does not verify that the repository remains clean afterward.
Consequently, build-time mutations of tracked files or unexpected non-ignored generated files can
pass CI unnoticed.

## Chosen Approach

1. Remove `next-env.d.ts` from version control and add the root path `/next-env.d.ts` to
   `.gitignore`. Next.js remains the sole writer of this generated bootstrap file.
2. Change the existing `typecheck` script to `next typegen && tsc --noEmit` so a clean checkout
   generates Next.js route declarations before strict TypeScript checking.
3. Replace the obsolete exact-content smoke assertion with a toolchain contract that proves:
   - Git ignores the root `next-env.d.ts`;
   - Git does not track it; and
   - the `typecheck` script runs `next typegen` before `tsc --noEmit`.
4. Keep the focused smoke contract that proves the CI workflow contains a repository-cleanliness
   gate after the offline validation gate.
5. Keep one CI-only step after `pnpm verify:offline` that fails when Git reports:
   - any tracked working-tree mutation;
   - any staged mutation; or
   - any untracked file that is not excluded by `.gitignore`.
     The step must suppress raw Git diff, status, path, and dependency-error output, fail closed when
     a Git observation itself fails, and emit only fixed repository-owned error messages.
6. Keep the ordinary local `pnpm build` and `pnpm verify:offline` entry points unchanged.
   `pnpm typecheck` retains strict checking and now performs the required generated-type bootstrap.
   Developers may continue to build from a working tree containing intentional local changes; the
   absolute clean-checkout requirement applies only to CI.

## Why This Approach

Ignoring the generated file follows the pinned framework's ownership model and accommodates both
production and development generation without restoring, rewriting, or normalizing repository
state after verification. Making `next typegen` part of `typecheck` preserves reliable strict
checking from a clean checkout even though the bootstrap file is not committed.

The full-tree gate protects the repository from the entire class of build and verification
residue, while correctly excluded framework output remains governed by `.gitignore`. Running it in
CI avoids false
failures caused by intentional local edits while relying on the clean checkout already established
by `actions/checkout`.

The gate remains a separate workflow step instead of duplicating the production build or splitting
the established `verify:offline` command. This keeps the implementation small, preserves one
offline verification entry point, and still catches every persistent mutation because the build
occurs inside that command.

## CI Cleanliness Contract

The post-verification step will use Git itself as the authority without printing untrusted
repository content:

```bash
if ! git diff --quiet --no-ext-diff 2>/dev/null; then
  echo "::error::Tracked working-tree mutation or Git diff failure detected after offline verification."
  exit 1
fi
if ! git diff --cached --quiet --no-ext-diff 2>/dev/null; then
  echo "::error::Staged mutation or Git index check failure detected after offline verification."
  exit 1
fi
if ! residue="$(git status --porcelain=v1 --untracked-files=all 2>/dev/null)"; then
  echo "::error::Git status check failed after offline verification."
  exit 1
fi
if [ -n "$residue" ]; then
  echo "::error::Non-ignored repository residue detected after offline verification."
  exit 1
fi
```

Ignored build output such as `.next/`, `dist/`, Playwright output, temporary run data, and local
environment files remains outside the check according to the existing `.gitignore` policy.

The check must not reset, delete, restore, or otherwise modify the checkout. It reports failure and
leaves the mutation available for local diagnosis. CI logs must not contain the mutation's diff,
file names, raw Git errors, or terminal control sequences.

Executable gate tests must run Git with system and global configuration disabled, an allowlisted
process environment, and terminal prompting disabled. The tests must reject an unexpected Git exit
status as an observation failure rather than accepting it as proof of repository residue.

## Testing

Implementation will follow RED-GREEN TDD:

1. Replace the obsolete exact-content assertion with a focused Git-ownership and typecheck-order
   contract, then observe it fail while `next-env.d.ts` remains tracked and `typecheck` omits
   `next typegen`.
2. Stop tracking the generated file, ignore only its root path, and update `typecheck`.
3. Rerun the focused smoke test and observe the amended contract pass.
4. Retain the existing executable positive and negative repository-cleanliness tests.
5. Add RED coverage proving inherited global excludes cannot hide residue and an unexpected Git
   observation failure cannot satisfy a negative residue test.
6. Apply the quiet fail-closed workflow contract and isolate the Git subprocess environment.
7. Run the complete offline gate from a clean checkout and immediately apply the same quiet
   full-tree cleanliness commands used by CI.
8. Run repository-required formatting, diff, and secret-scanning gates.

## Acceptance Criteria

- `next-env.d.ts` is not tracked and the root path is ignored as generated output.
- `pnpm typecheck` runs `next typegen` before strict `tsc --noEmit` checking and succeeds from a
  clean checkout.
- Production-build and development-server verification may generate different
  `next-env.d.ts` contents without creating repository residue.
- CI fails after the offline gate when any tracked, staged, or non-ignored untracked residue exists.
- CI also fails when a Git observation cannot execute successfully.
- CI emits only fixed repository-owned messages on cleanliness failure and never prints raw diff,
  status, file-name, or Git dependency-error content.
- CI remains green when only ignored build and test outputs are generated.
- Executable cleanliness tests ignore system and global Git configuration, inherited Git override
  variables, hooks, signing settings, and global excludes.
- Local `pnpm build` and `pnpm verify:offline` entry points remain unchanged; strict type checking
  remains mandatory.
- The existing CI permission model, immutable action pins, frozen lockfile installation, and
  credential-free offline behavior remain unchanged.
- No dependency, lockfile, runtime, UI, API, deployment, DataHub, OpenAI, or artifact behavior
  changes.
