# Flat Storage Cumulative Gate Remediation Design

**Status:** Approved by the project owner on 2026-07-24

## Context

The cumulative review of the approved flat run-envelope storage amendment found three blockers that
were not visible in the isolated task reviews:

1. nested objects inside `ChangeContextSchema` silently strip unknown keys before envelope hash
   verification;
2. the CLI runtime configuration still defaults the runs root to relative `runs` and reaches the
   DataHub boundary before discovering an unusable storage root; and
3. later sections of the active Next.js and OpenAI implementation plan still prescribe the
   superseded relative-root and nested package-manifest model.

This remediation closes those blockers without adding product behavior or changing the approved
flat-envelope threat model.

## Authority and Scope

This design supplements:

- `docs/specs/002-nextjs-openai-agent-demo/spec.md`;
- `docs/superpowers/specs/2026-07-24-flat-run-envelope-storage-design.md`; and
- `docs/superpowers/plans/2026-07-24-flat-run-envelope-storage.md`.

It does not authorize root creation by application runtime code, nested run directories, package
manifests, migration fallback, filesystem-path disclosure, or a broader storage threat model.

The remediation has three independently reviewable units:

1. deep `ChangeContext` schema strictness;
2. explicit absolute CLI storage configuration and trusted-root preflight; and
3. downstream implementation-plan and architecture coherence.

## Deep-Strict Change Context

`ChangeContextSchema` must reject unknown keys at every object layer used by a persisted envelope.
The currently non-strict `intent`, `target`, `sourceField`, `assessment`, and assessment-factor
objects become strict. Existing strict nested objects remain unchanged.

Strictness is a validation rule, not a normalization rule. A raw envelope containing a nested
unknown key must fail before canonical hashing. The parser must not silently remove the key and then
accept the normalized value under the stored hash.

Tests inject an unknown key into each affected nested object independently. They prove both direct
`ChangeContextSchema` rejection and fail-closed run-envelope parsing with the fixed storage error.
Valid contexts and their canonical hashes remain unchanged.

## CLI Runs-Root Selection and Preflight

The effective CLI runs-root precedence is:

1. explicit `--runs-dir`;
2. `LINEAGEGUARD_RUNS_DIR`;
3. fixed configuration failure when neither exists.

The relative `runs` default is removed. Either source must supply a native absolute path. The CLI
merges the selected value into runtime configuration before parsing the complete configuration, so
an explicit CLI flag remains a supported alternative to the environment variable.

After request syntax and configuration validation but before catalog creation, the CLI calls the
existing `assertTrustedRunsRoot` boundary. The root must:

- be absolute;
- already exist;
- be a real directory;
- not be a symbolic link or Windows junction; and
- satisfy the existing canonical-path checks.

The application never creates this root. Deployment ownership and ACL protection remain operator
responsibilities, and replacement of the trusted root itself remains outside the approved threat
model.

Missing, relative, nonexistent, non-directory, symlink, or junction roots produce a fixed
`ARTIFACT_WRITE_FAILED` response with exit code `4` and existing storage guidance. Native paths and
filesystem errors are not returned. Catalog construction, DataHub calls, and impact analysis must
all remain uncalled after a root-preflight failure.

Configuration tests cover missing and relative roots, absolute-root acceptance, and CLI-flag
precedence. CLI tests use real temporary directories for positive preflight and assert zero external
calls for every negative case.

## Web, Test, and CI Root Contract

The active downstream plan must apply the same storage contract to web execution:

- web configuration requires an explicit absolute `LINEAGEGUARD_RUNS_DIR`;
- application routes validate the trusted root before provider or DataHub work;
- production and application code never create the root; and
- errors remain fixed and path-free.

Test harnesses may create isolated absolute temporary roots before starting the application because
they are deployment harnesses, not application runtime code. Playwright setup owns creation and
cleanup of its temporary root. CI creates an absolute job-temporary root before the offline gate and
passes it through the environment.

## Flat-Envelope Downstream Plan

The active `docs/specs/002-nextjs-openai-agent-demo/plan.md` must no longer instruct future agents to
reintroduce the superseded storage model.

The correction replaces:

- replay and live web defaults that use relative `runs`;
- API tests and routes that require `package/manifest.json`;
- Playwright and CI roots that are relative or not pre-created; and
- architecture text that describes `<runsRoot>/<runId>/package/`.

The replacement plan uses:

- `loadRunSnapshot` for validated public run metadata;
- `loadRegenerationContext` and `reserveGenerationRetry` for server-owned retry lineage;
- `readCompletedPackageFile` for the four allowlisted virtual downloads;
- one immutable `run-<run-id>.json` envelope per terminal run; and
- explicit absolute, pre-created trusted roots in web, Playwright, and CI flows.

No route may inspect envelope-native paths, fall back to a different file after integrity failure,
or expose private context, draft, findings, hashes, temporary names, or final-envelope paths.

## Error and Disclosure Contract

All new configuration and preflight failures use existing typed application errors and fixed public
messages. They must not include:

- the configured native root;
- raw Zod or filesystem details;
- custom abort reasons;
- credentials or credential-shaped values; or
- provider, MCP, or model trace envelopes.

The existing virtual artifact names and CLI output remain unchanged.

## Verification

Each remediation unit follows red-green-refactor TDD and receives an independent task review.
Required evidence includes:

- direct and envelope-level deep unknown-key rejection;
- valid context/hash regression coverage;
- root-source precedence and absolute-path configuration tests;
- real missing/file/symlink/junction preflight tests;
- zero catalog, DataHub, and analysis calls after preflight failure;
- fixed, path-free CLI error output;
- active-plan searches showing the superseded relative-root and nested-manifest instructions have
  been removed or replaced;
- cumulative flat-storage and compatibility suites;
- the full deterministic offline suite;
- typecheck, formatting, lint, CLI and web builds, and `git diff --check`; and
- the repository secret scanner when available, otherwise a targeted credential and native-path
  scan over changed files.

After all three task reviews pass, a fresh cumulative reviewer must approve the complete storage
boundary before the main Next.js and OpenAI plan resumes at Task 7.

## Non-Goals

- Creating production runs roots automatically.
- Expanding the trusted-root threat model.
- Migrating a shipped nested format.
- Reintroducing generic filesystem artifact APIs.
- Changing the DataHub, OpenAI, risk, migration-generation, or UI product behavior.
