## Engineering baseline

### Authority and scope

- **MUST** read the applicable approved specification, relevant accepted ADRs and architecture decisions, approved implementation-plan section, and domain guidance before changing behavior.
- **MUST** treat the applicable approved specification as product authority. An accepted ADR governs its architectural concern unless a later approved specification or ADR explicitly supersedes it. An approved implementation plan governs execution order but cannot broaden its specification. `PROJECT_BRIEF.md` provides context, while `AGENTS.md` governs process and does not create product scope.
- **MUST** stop and ask the project owner when applicable authority conflicts or leaves a permission-sensitive decision ambiguous.
- **MUST** implement the smallest safe change that satisfies approved acceptance criteria. Do not add unrelated refactors or broaden scope, behavior, dependencies, permissions, or external actions without an owner-approved amendment to the applicable authority.
- **MUST** preserve unrelated user changes. Do not perform destructive filesystem or Git operations without explicit authorization.

### Toolchain and architecture

- **MUST** treat `package.json`, the lockfile, TypeScript configuration, and CI workflow as toolchain authority. Use exact dependency versions, never introduce `@latest`, and update the manifest and lockfile together through the repository package manager.
- **MUST** preserve strict TypeScript, ESM, established relative-import conventions, and existing compiler, lint, test, and build gates. Do not weaken a gate to make a change pass.
- **SHOULD** prefer small cohesive modules, deterministic pure domain logic, and explicit adapters at external boundaries. Deviations require approved authority and a documented reason.

### Testing and verification

- **MUST** add or update tests for every behavior change and regression fix. Run the smallest relevant test first, then the affected suite and required repository gates.
- **MUST** colocate focused unit tests as `*.test.ts`; keep cross-module, fixture, integration, and browser flows under `tests/`. Use isolated temporary paths and clean up resources. Tests and runtime code must not mutate committed fixtures in place; intentional fixture migrations require approved authority and deterministic validation.
- **MUST** keep mandatory tests and ordinary CI deterministic, offline, credential-free, and independent of live DataHub or OpenAI services. Live checks must be explicit, environment-gated, bounded, and reported separately.
- **MUST** prove what a broad test filter selected before trusting its result.

### Trust, AI, and secrets

- **MUST** treat user input, model output, MCP and provider responses, metadata, persisted external content, and dependency errors as untrusted.
- **MUST** normalize, size-bound, strictly validate, and sanitize untrusted values before model input, decision use, persistence, rendering, download, or browser exposure. Use strict structured schemas at AI and tool boundaries, with deterministic application validation authoritative for critical decisions and published artifacts.
- **MUST** keep credentials server-only and untracked. Never place secrets in client bundles, logs, fixtures, screenshots, generated artifacts, repository content, or tool or command arguments; example environment files may contain only documented non-secret placeholders.
- **MUST NOT** expose or persist hidden system or developer instructions, chain-of-thought, raw MCP, provider, or model trace envelopes, unsafe terminal or escape control sequences, or unrestricted native paths in application responses, browser or UI output, public CLI output, logs, persisted runs, downloads, or submission artifacts. Validated user-authored domain input required by an approved contract, committed versioned agent instructions, and allowlisted sanitized version metadata are permitted.
- **MUST** replace external dependency failures with bounded typed errors before they cross application boundaries.

### External effects and persistence

- **MUST** default external integrations to read-only and least privilege. Do not enable mutation, SQL execution, unrestricted tools, repository automation, publication, or other external-state changes unless approved authority requires them and the current action is explicitly authorized.
- **MUST** enforce allowlists, timeouts, cancellation, and bounded retry behavior at external boundaries.
- **MUST** constrain runtime-generated or externally derived filesystem writes to validated roots and fixed or validated file names. Use create-only or atomic final publication when partial output could mislead, and never mark failed, incomplete, timed-out, or cancelled work as completed.

### CI and supply chain

- **MUST** keep GitHub Actions least-privileged, pin third-party actions to full commit SHAs, disable persisted checkout credentials unless approved authority requires them, and use the frozen lockfile.
- **MUST** keep required CI free of secrets, live external services, and hidden mutable dependencies.
- **MUST** provide executable positive and negative tests when adding a new enforcement gate.

### Language

- **MUST** keep code, tests, comments, documentation, UI text, commits, and repository artifacts in English.
- **MUST** communicate with the project owner in Ukrainian unless the owner requests another language.

## Definition of done

A change is complete only when:

- it is traceable to approved acceptance criteria and does not broaden authority;
- positive, negative, boundary, and regression tests relevant to changed behavior exist and pass, while documentation-only changes avoid artificial behavior tests;
- current repository and CI-mandated checks relevant to the changed surface pass, with every command's exit status verified;
- `git diff --check`, the focused diff, and repository status have been inspected;
- repository-provided secret scanning passes when available and no credentials or sensitive raw traces were introduced;
- documentation and authority artifacts are updated when contracts, behavior, architecture, or operator steps change; and
- skipped, unavailable, stale, replay-only, or unexecuted checks are reported truthfully and never described as passing.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the repository's five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
