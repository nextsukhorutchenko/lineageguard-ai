# Repository Codex Skills Design

**Date:** 2026-07-23

**Decision:** Three thin, implicitly invocable repository skills

**Status:** Proposed — conversational design approved; written specification pending review

## Context

LineageGuard AI has an approved product specification and implementation plan for a local, read-only DataHub and OpenAI agent demo. The repository also has durable guidance in `AGENTS.md`, while general engineering workflows such as brainstorming, planning, test-driven development, systematic debugging, GitHub operations, and verification are already available as installed Codex skills.

What is missing is a small repository-owned routing layer that teaches Codex when and how to apply those general workflows to LineageGuard-specific work. Without that layer, a new Codex session must rediscover the active specification, the current plan task, the four-operation DataHub boundary, the two-agent-tool boundary, live-demo safety requirements, and submission truthfulness rules.

Current Codex documentation defines `.agents/skills` as the repository-local discovery path. Skill descriptions drive implicit invocation, and an optional `agents/openai.yaml` file can make the implicit-invocation policy explicit. The repository currently has no skills in that path.

This design adds three narrowly scoped development-workflow skills. It does not implement or relocate the separate product-facing DataHub Skill candidate planned for Task 14A.

## Goals

- Make LineageGuard-specific implementation, live verification, and submission workflows discoverable in fresh Codex sessions.
- Trigger the correct repository skill automatically from natural-language requests.
- Keep the approved specification and plan authoritative.
- Reuse installed general-purpose skills instead of copying their instructions.
- Preserve the read-only DataHub boundary, deterministic decision authority, truthful replay behavior, and human approval gates.
- Validate every repository skill structurally and behaviorally.
- Keep ordinary CI offline and secret-free.

## Non-Goals

- Replacing installed brainstorming, planning, TDD, debugging, security, GitHub, or verification skills.
- Adding a plugin, MCP server, runtime dependency, package, or external service.
- Exposing repository skills as OpenAI agent tools.
- Changing the application runtime, DataHub MCP contract, OpenAI provider, UI, or approved plan scope.
- Implementing `skills/lineageguard-schema-change-impact/` before its approved Task 14A gate.
- Making Devpost submissions, publishing releases, opening upstream pull requests, or contacting external services without explicit authorization.
- Running live DataHub or OpenAI checks in ordinary CI.

## Considered Approaches

### A. Three thin repository skills

Create one skill for approved-plan implementation, one for live-demo verification, and one for submission preparation. Each skill owns only LineageGuard-specific routing, invariants, stop conditions, and evidence requirements. It delegates generic process mechanics to installed skills.

**Advantages**

- Precise implicit matching.
- Independent authoring and behavioral validation.
- Small context footprint for each task.
- Clear ownership of implementation, operations, and submission concerns.
- Easy to extend or remove without changing the other workflows.

**Disadvantages**

- Three small skill directories and three metadata files must be maintained.

### B. One universal LineageGuard workflow skill

Create one skill that selects an implementation, live-demo, or submission mode internally.

**Advantages**

- Fewer files.
- One entry point to document.

**Disadvantages**

- A broad description makes implicit invocation less precise.
- Every use loads unrelated instructions.
- Mode selection becomes another untested decision layer.
- Changes to one workflow can regress all three.

### C. Three skills backed by a shared programmatic orchestrator

Create three skill frontends plus scripts that resolve repository state, enforce gates, and run checks.

**Advantages**

- Strong mechanical enforcement.
- Potential reuse across repositories.

**Disadvantages**

- Adds infrastructure before repeated mechanical work has been demonstrated.
- Increases maintenance and testing cost.
- Risks duplicating the existing plan, CI, and installed skill framework.

## Decision

Use Approach A: three thin repository skills.

The skills provide domain-specific routing and safety constraints. Existing installed skills continue to provide the general engineering methods. No common script or framework is introduced unless later evidence shows repeated error-prone work that cannot be expressed or tested reliably as instructions.

## Repository Layout

```text
.agents/
└── skills/
    ├── implement-lineageguard-approved-plan/
    │   ├── SKILL.md
    │   └── agents/
    │       └── openai.yaml
    ├── verify-lineageguard-live-demo/
    │   ├── SKILL.md
    │   └── agents/
    │       └── openai.yaml
    └── prepare-lineageguard-submission/
        ├── SKILL.md
        └── agents/
            └── openai.yaml
```

The initial versions do not need `scripts/`, `references/`, or `assets/`. They must link to repository authority files directly and avoid copying long-lived project facts that are already maintained elsewhere.

The exact repository authority paths are:

- `PROJECT_BRIEF.md`;
- `docs/specs/002-nextjs-openai-agent-demo/spec.md`;
- `docs/specs/002-nextjs-openai-agent-demo/plan.md`;
- Task 1A in that plan for the pinned DataHub boundary, sanitizer, fixture capture, and committed fixture rules;
- Task 14 in that plan for live smoke testing and live-verification evidence; and
- Task 14A in that plan for submission assets and the separate product-facing DataHub Skill candidate.

## Skill Contracts

### 1. `implement-lineageguard-approved-plan`

**Purpose:** Route implementation, fix, refactor, review, and continuation requests to the correct approved task without expanding product authority.

**Positive triggers**

- Implement or continue a task from the approved LineageGuard plan.
- Fix or review code governed by specification 002.
- Ask what should be implemented next in the current feature branch.
- Modify DataHub, evidence, workflow, agent, migration-package, UI, or persistence behavior covered by the approved plan.
- Create or update committed DataHub fixtures after the live source has been verified.

**Negative triggers**

- Pure repository discovery or explanation with no requested change.
- Live-environment setup or live evidence capture.
- Devpost copy, video planning, release packaging, or submission review.
- Work in an unrelated repository.

**Required behavior**

1. Locate and read `PROJECT_BRIEF.md`, `docs/specs/002-nextjs-openai-agent-demo/spec.md`, `docs/specs/002-nextjs-openai-agent-demo/plan.md`, and the current task section before changing code.
2. Inspect current branch and worktree state and preserve unrelated user changes.
3. Refuse silent scope expansion and identify a missing or unapproved task as a design or planning gate.
4. Preserve the following non-negotiable boundaries:
   - one TypeScript `pnpm` package;
   - exactly one supported change kind, `rename_column`;
   - exactly four internal read-only DataHub operations;
   - exactly two application-owned OpenAI agent tools;
   - deterministic application authority over risk, completeness, context coverage, identifiers, rendering, validation, persistence, and safety;
   - explicit `REPLAY` labeling and no fabricated live claims;
   - English repository content.
5. Invoke the installed plan-execution, subagent-driven development, TDD, debugging, and verification skills when their trigger conditions apply.
6. Complete only the approved task, update its evidence truthfully, and stop at the next required approval gate.

### 2. `verify-lineageguard-live-demo`

**Purpose:** Route live DataHub, MCP, OpenAI, transient fixture-source inspection, and live-demo readiness requests through the approved safe preflight.

**Positive triggers**

- Prepare, run, diagnose, or verify the live DataHub demo.
- Configure or test the pinned MCP subprocess.
- Inspect live DataHub context or collect transient evidence for a proposed fixture update.
- Check PAT, GMS, UI, Docker resources, ports, `uvx`, live OpenAI, or live evidence.
- Decide whether a run may be described as `LIVE`.

**Negative triggers**

- Ordinary offline unit tests or replay-only development.
- Product feature implementation unrelated to live dependencies.
- Submission prose that does not require new live evidence.
- Production hosting, SSO, ingestion, or mutation enablement.

**Required behavior**

1. Read Task 14 in `docs/specs/002-nextjs-openai-agent-demo/plan.md` and the repository's operator documentation before acting.
2. Run bounded checks in the approved order:
   - pinned versions and local configuration;
   - Docker resources and certified ports;
   - `datahub docker check`;
   - GMS health;
   - DataHub UI inspection of the golden asset, schema, lineage, and ownership;
   - absolute pinned `uvx` resolution;
   - four-operation read-only MCP integration check;
   - OpenAI verification only after DataHub and MCP pass.
3. Keep `DATAHUB_GMS_TOKEN` and `OPENAI_API_KEY` shell-local, redacted, and absent from repository artifacts and logs.
4. Never enable mutations, bypass authorization, expose unrestricted MCP tools, disable authentication, or automate destructive recovery.
5. Require explicit authorization before a destructive recovery step or external-state change.
6. Fall back to deterministic replay when a live dependency is unavailable and report the run mode truthfully.
7. Mark live gates passed only from current evidence; stale screenshots, replay data, or configuration alone are not live proof.
8. Keep verification read-only with respect to repository content. Creating or updating a committed fixture is a compound `verify → implement` request: after live verification, `$implement-lineageguard-approved-plan` must read Task 1A and enforce its strict replay schemas and prohibitions on email or profile data, overlong descriptions, related documents, raw SQL, tokens, and MCP diagnostics.

### 3. `prepare-lineageguard-submission`

**Purpose:** Route hackathon submission-facing README, judging, attribution, video, sample-output, release, and final-readiness requests through truthful evidence gates.

**Positive triggers**

- Prepare or review the Devpost submission.
- Write or verify the three-minute demo script.
- Produce the judging map, submission checklist, attribution inventory, submission-facing README content, sample outputs, or release candidate.
- Check public-repository readiness, secret safety, licensing, provenance, or live/replay disclosures.

**Negative triggers**

- Implementing core product behavior.
- Diagnosing the live stack before submission assets exist.
- General marketing content unrelated to the approved hackathon.
- Publishing or submitting without explicit user authorization.

**Required behavior**

1. Read Task 14A in `docs/specs/002-nextjs-openai-agent-demo/plan.md` and require the approved offline browser-demo gate before treating the submission package as ready.
2. Map every material claim to repository evidence and distinguish `LIVE`, `REPLAY`, planned, and unavailable behavior.
3. Verify required challenge, judging, license, attribution, disclosure, repository-access, video-length, and deadline statements against current authoritative sources when they may have changed.
4. Run the repository's submission validator and secret scan when those files exist.
5. If a planned validator or artifact does not yet exist, report the gate as unavailable rather than passing it.
6. Verify that sample outputs are sanitized, deterministic where claimed, and tied to a commit.
7. Preserve the human approval requirement for migration decisions and for all external publication, submission, release, community, or upstream pull-request actions.

## Automatic Routing

Automatic routing has three layers:

1. Each `SKILL.md` frontmatter contains only `name` and a precise, third-person `description` that states both what the skill does and when Codex must use it.
2. Each `agents/openai.yaml` contains:

   ```yaml
   interface:
     display_name: "<human-readable skill name>"
     short_description: "<concise purpose>"
     default_prompt: "Use $<skill-name> to <perform its repository workflow>."

   policy:
     allow_implicit_invocation: true
   ```

3. Root `AGENTS.md` contains a compact mandatory routing table:

   | Request type                                                                                     | Required repository skill               |
   | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
   | Approved-plan implementation, fix, refactor, or code review                                      | `$implement-lineageguard-approved-plan` |
   | DataHub/MCP/OpenAI live setup, diagnosis, transient inspection, or live evidence                 | `$verify-lineageguard-live-demo`        |
   | Devpost, submission-facing README, judging, attribution, video, release, or submission readiness | `$prepare-lineageguard-submission`      |

The descriptions remain the primary implicit-matching mechanism. `AGENTS.md` makes the project policy durable and auditable. `agents/openai.yaml` makes the policy explicit in skill metadata.

Requests may span more than one workflow. In that case, Codex must use every applicable repository skill in this order:

1. diagnose and establish current live evidence with `$verify-lineageguard-live-demo`;
2. make an authorized code or documentation change with `$implement-lineageguard-approved-plan`;
3. evaluate and package the resulting evidence with `$prepare-lineageguard-submission`.

Diagnosis alone does not authorize a fix, and submission preparation does not authorize a new live run, publication, or product change. The routing table identifies the required skill for each part of a request rather than forcing a single skill for a compound request.

A committed fixture capture is specifically `verify → implement`: verification proves the live source and produces only transient evidence, then implementation applies Task 1A's sanitizer, strict schemas, canonicalization, tests, and create-only repository write. A verify-only diagnosis must leave the repository unchanged.

## Relationship to the Product-Facing DataHub Skill

The repository skills in `.agents/skills` guide Codex while developing LineageGuard. They are not part of the LineageGuard runtime and are not hackathon product features.

The separately planned `skills/lineageguard-schema-change-impact/` directory is a product-facing DataHub Skill contribution candidate. It remains governed by Task 14A and may be authored only after the core offline browser-demo gate. It must retain its clean-room DataHub format, pinned MCP contract, contribution checks, and read-only workflow.

The two namespaces must not be merged:

```text
.agents/skills/...                          # Codex development workflows
skills/lineageguard-schema-change-impact/   # Planned DataHub contribution artifact
```

## Test-Driven Authoring

Skills are process code and must be authored one at a time with a red-green-refactor loop.

For each skill:

1. **RED:** Run representative pressure scenarios in a fresh context without the new skill and record the specific routing or safety failure.
2. **GREEN:** Scaffold the skill with the installed `skill-creator` initialization tool, write the minimum instructions that address the observed failure, and generate `agents/openai.yaml`.
3. Run the skill-creator structural validator.
4. Add or extend an offline Vitest test that verifies:
   - the exact directory and required files;
   - allowed frontmatter fields;
   - folder/name agreement;
   - a specific trigger-oriented description;
   - a matching `$skill-name` in `default_prompt`;
   - `allow_implicit_invocation: true`;
   - the required `AGENTS.md` routing entry;
   - the exact authority paths and required plan task headings;
   - no duplicate repository skill names.
5. **Forward test:** Run positive and negative prompts in a fresh Codex session and inspect session evidence for whether the exact `SKILL.md` was read. Scenarios must include:
   - one positive and one negative scenario for each individual skill;
   - a committed-fixture request that routes `verify → implement`;
   - a full readiness request that routes `verify → implement → prepare`;
   - a verify-only diagnosis that makes no repository change; and
   - an ordinary technical README update that does not invoke the submission skill.
6. **REFACTOR:** Remove ambiguity, duplication, and loopholes, then rerun structural and behavioral checks.
7. Commit the validated skill before authoring the next one.

Fresh-session behavioral checks are development evidence and must not run in ordinary CI. CI remains deterministic, offline, and secret-free.

## Verification

After all three skills are connected:

1. Run the skill-creator validator for every skill.
2. Run the repository skill-routing Vitest test.
3. Run the full offline quality gate:
   - `pnpm format:check`;
   - `pnpm lint`;
   - `pnpm typecheck`;
   - `pnpm test`;
   - `pnpm build`.
4. Run fresh-session positive and negative routing scenarios for every skill.
5. Inspect `git diff --check`, the final diff, and repository status.
6. Confirm that no secret, runtime dependency, product authority, or product-facing DataHub Skill was added.

## Failure and Stop Conditions

- If the specification or target plan task is not approved, implementation stops at the appropriate design or planning gate.
- If the current worktree contains overlapping user changes, the skill reports the conflict instead of overwriting them.
- If implicit invocation cannot be demonstrated, the skill is not considered connected even when structural validation passes.
- If a skill activates on its negative-control scenarios, its description must be narrowed before proceeding.
- If a required live dependency fails, live verification stops before OpenAI and preserves replay.
- If submission evidence or a planned validator is absent, the corresponding readiness item remains unpassed.
- If a task requires mutation, destructive recovery, publication, submission, release, or upstream contribution, explicit user authorization remains mandatory.

## Acceptance Criteria

1. Exactly three repository-owned Codex skills exist under `.agents/skills`.
2. Every skill has a valid `SKILL.md` and `agents/openai.yaml`.
3. Every skill explicitly permits implicit invocation and has a precise trigger description.
4. `AGENTS.md` maps each relevant request class to its required repository skill and defines the composition order for compound requests.
5. Static tests detect missing files, invalid metadata, routing drift, and duplicate names.
6. Fresh-session positive scenarios invoke the intended skill.
7. Fresh-session negative scenarios do not invoke the unintended skill.
8. Committed fixture capture invokes `verify → implement`, reads Task 1A, and enforces its sanitization boundary.
9. Verify-only diagnosis leaves repository content unchanged.
10. Compound readiness scenarios preserve the `verify → implement → prepare` order.
11. Each skill delegates general methods to installed skills rather than copying them.
12. No runtime dependency, MCP tool, OpenAI agent tool, application behavior, or product authority changes.
13. The Task 14A product-facing DataHub Skill remains separate and unimplemented.
14. All offline quality gates pass.
15. Repository content added by this change is English.

## Decision Rationale

Three thin repository skills are the smallest structure that gives Codex reliable LineageGuard-specific routing without duplicating installed capabilities or adding a new orchestration layer. The separation mirrors the project's actual lifecycle: build against an approved plan, prove the optional live path safely, and package only evidence-backed claims for submission.

## Reference

- [Build skills](https://learn.chatgpt.com/docs/build-skills) — current Codex repository discovery, skill metadata, and implicit invocation guidance.
