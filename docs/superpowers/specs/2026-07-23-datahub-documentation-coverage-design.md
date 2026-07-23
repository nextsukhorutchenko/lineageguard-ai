# DataHub Documentation Coverage Design

**Date:** 2026-07-23

**Decision:** Approach A — evidence-based documentation delta

**Status:** Approved approach; awaiting written-design review

## Context

LineageGuard AI already has an approved local-demo architecture: a deterministic replay path and an opt-in live path that reads a pinned DataHub Core instance through a pinned DataHub MCP Server. The application owns a four-operation read-only allowlist (`search`, `list_schema_fields`, `get_lineage`, and `get_entities`), does not execute SQL, does not mutate DataHub, and requires human approval for migration decisions.

Twelve unique official DataHub resources were audited against the current repository: the nine documentation resources in the original review, plus the MCP guide, the Agent Context Kit guide, and the pinned DataHub Skills repository. They expose useful operator and agent-workflow guidance, but several also describe moving tool surfaces, production administration, Python framework integrations, SQL execution, or write-capable workflows that must not become LineageGuard runtime requirements.

This design records the smallest documentation and planning delta that incorporates the resources without broadening product authority or hackathon scope.

## Goals

- Make the pinned local DataHub demo reproducible and diagnosable.
- Distinguish frontend login, GMS authentication, and the shell-local MCP token.
- Warn clearly that default Quickstart credentials and directly exposed ports are local-only.
- Explain why UI ingestion, general connector ingestion, multi-user onboarding, OIDC, and custom JAAS are not LineageGuard runtime dependencies.
- Preserve the existing read-only MCP boundary and deterministic replay fallback.
- Distinguish the moving MCP guide from the pinned MCP Server `0.6.0` contract.
- Reuse safe agent-context and skill-authoring patterns without adding another framework or tool surface.
- Attribute every reviewed official resource and classify how it affects the project.
- Keep production hardening visible as deferred guidance without implementing it.

## Non-Goals

- Implementing DataHub UI ingestion, scheduled ingestion, Actions, or connector recipes.
- Adding DataHub Secrets, ingestion credentials, Python/Java ingestion SDKs, or metadata mutation.
- Provisioning users, invite links, custom `user.props`, custom JAAS modules, OIDC, or SSO.
- Hosting DataHub or LineageGuard publicly.
- Supporting an arbitrary remapped-port matrix in the certified hackathon demo.
- Installing the official DataHub Skills registry as a product runtime dependency.
- Adding `datahub-agent-context`, LangChain, Google ADK, direct raw MCP discovery, or another model provider.
- Adopting `mcp-server-datahub@latest`, managed remote HTTP/OAuth, SQL/query tools, or any MCP operation outside the four-name application allowlist.
- Automating destructive recovery such as `datahub docker nuke`, Docker pruning, database repair, or index repair.

## Source Classification

| Official resource                                                                                                                                                       | Project classification                                               | Required treatment                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Quickstart Debugging Guide](https://docs.datahub.com/docs/troubleshooting/quickstart)                                                                                  | Live-operator-required                                               | Add bounded startup diagnostics, default-port prerequisites, `datahub docker check`, resource guidance, and safe recovery boundaries.                                       |
| [Metadata Ingestion — UI](https://docs.datahub.com/docs/ui-ingestion)                                                                                                   | Out of scope for runtime; reference only                             | State that UI ingestion permissions, secrets, schedules, and executors are not required by LineageGuard and must not be enabled as an MCP or PAT workaround.                |
| [DataHub SDK and CLI / Metadata Ingestion](https://docs.datahub.com/docs/metadata-ingestion)                                                                            | Bootstrap reference; general ingestion out of scope                  | Distinguish the golden datapack seed from production ingestion. Do not add recipes, SDK emission, `upsert`, or delete operations.                                           |
| [Onboarding Users to DataHub](https://docs.datahub.com/docs/authentication/guides/add-users)                                                                            | Default local login is operator-required; onboarding is out of scope | Add a local-only default-credential warning. Do not add invite or user-provisioning instructions.                                                                           |
| [Configuring OIDC Authentication](https://docs.datahub.com/docs/authentication/guides/sso/configure-oidc-react)                                                         | Production-only, deferred                                            | Record it as the preferred production SSO direction without adding `AUTH_OIDC_*` configuration to the demo.                                                                 |
| [JaaS Authentication](https://docs.datahub.com/docs/authentication/guides/jaas)                                                                                         | Default local frontend behavior; customization out of scope          | Explain that Quickstart uses the default frontend login. Do not prescribe custom mount paths without validating the pinned image.                                           |
| [Metadata Service Authentication](https://docs.datahub.com/docs/authentication/introducing-metadata-service-authentication#configuring-metadata-service-authentication) | Live token is runtime-required; hardening is production-only         | Explain the two-service authentication switch, restart requirement, PAT bearer use, and local-only direct GMS topology as troubleshooting and deferred hardening guidance.  |
| [Changing the Default User Credentials](https://docs.datahub.com/docs/authentication/changing-default-credentials#quickstart)                                           | Local warning is operator-required; remediation is production-only   | Place the warning beside every default-login command and link to the official remediation guide for any non-local deployment.                                               |
| [DataHub Skills](https://docs.datahub.com/docs/dev-guides/agent-context/skills)                                                                                         | Workflow taxonomy reference; runtime out of scope                    | Distinguish skills from MCP tools, reject write-capable enrichment/quality/SQL workflows, and distinguish the registry from LineageGuard's local contribution candidate.    |
| [DataHub MCP Server Guide](https://docs.datahub.com/docs/features/feature-guides/mcp)                                                                                   | Moving deployment/auth reference; not the tool contract              | Use its self-hosted environment, PAT, tool-annotation, `uvx` troubleshooting, and evidence-visibility guidance; derive the executable contract only from pinned `0.6.0`.    |
| [Agent Context Kit](https://docs.datahub.com/docs/dev-guides/agent-context/agent-context)                                                                               | Architecture and workflow reference only                             | Reuse context-first grounding and resource-lifecycle concepts. Do not add its Python SDK, framework adapters, raw tool discovery, SQL execution, assertions, or write-back. |
| [DataHub Skills repository](https://github.com/datahub-project/datahub-skills)                                                                                          | Pinned format and contribution reference only                        | Inspect commit `864ee5800c55eb90628f290bd8e91602b0a3e28e`; use clean-room structure and upstream checks without installing, copying, or importing its runtime permissions.  |

## Design Decisions

### 1. Preserve the Product Runtime

This documentation audit does not add a runtime subsystem. The product continues to use only:

1. the application-owned read-only DataHub adapter;
2. the exact four allowed MCP operations;
3. normalized, bounded metadata evidence;
4. one bounded OpenAI agent over application-owned tools; and
5. deterministic replay when live dependencies are unavailable.

No reviewed ingestion, identity, or Skills workflow is exposed to the OpenAI agent. Extra MCP tools remain unreachable even if the server advertises them.

The Agent Context Kit is used only to name the architecture pattern: DataHub supplies grounded context, deterministic application code turns that context into evidence and decisions, and the bounded OpenAI agent drafts a migration package for validation and human approval. It is not a second DataHub client or runtime framework.

### 2. Define One Certified Local Port Profile

The golden live-demo profile uses the default Quickstart mappings:

- DataHub UI: `http://localhost:9002`
- DataHub GMS: `http://localhost:8080`
- MySQL: `3306`
- Elasticsearch: `9200`
- Kafka: `9092`
- Schema Registry: `8081`
- ZooKeeper: `2181`

The operator guide must detect and explain port conflicts before the live run. It must not silently remap one service while leaving the remaining commands, environment variables, tests, or evidence checks on the default endpoints. `DATAHUB_GMS_URL` remains configurable for development, but a remapped topology is outside the certified three-minute demo unless all checks are deliberately updated and reverified together.

The official port-remapping mechanisms, including service-specific CLI flags and `DATAHUB_MAPPED_GMS_PORT`, may be linked as troubleshooting references but are not part of the golden path. Linux PATH/Python-module fallback and Apple Silicon architecture guidance are likewise platform-specific references rather than requirements for the pinned Windows demo.

### 3. Add a Safe Local Preflight

The documented live path must perform the following checks before OpenAI is called:

1. confirm the pinned Python, DataHub CLI, DataHub Core, and MCP versions;
2. confirm the tested Docker allocation of at least 8 GB RAM and 2 GB swap, plus the already recorded CPU and disk baseline;
3. confirm the default ports are available or already owned by the expected pinned DataHub services;
4. run the pinned CLI's `.\.venv\Scripts\datahub.exe docker check` command;
5. require a healthy GMS response at `http://localhost:8080/health`;
6. open the UI at `http://localhost:9002` and verify the golden asset, schema, lineage, and ownership context;
7. run the pinned live MCP integration check before the agent workflow.

Container listings and targeted container logs are permitted diagnostic steps. Destructive recovery is never automatic. `datahub docker nuke` may appear only as a clearly marked data-loss recovery action after backup and explicit operator choice. The project documentation will not recommend broad `docker system prune` or manual database/index repair as part of the normal path.

### 4. Separate Bootstrap from Ingestion Authority

The official `showcase-ecommerce` datapack remains the golden sample-data bootstrap. Documentation must state that loading this datapack is not a production connector-ingestion architecture.

LineageGuard does not require or request:

- `Manage Metadata Ingestion` or `Manage Secrets`;
- the ingestion UI or its feature flags;
- ingestion schedules, Actions executors, or run management;
- YAML connector recipes;
- Python or Java SDK metadata writes; or
- GraphQL mutations, `upsert`, or delete operations.

The shell-local `DATAHUB_GMS_TOKEN` must not be placed in DataHub UI Secrets. UI ingestion must not be enabled as a workaround for unavailable PAT controls or an MCP connection failure.

### 5. Separate Frontend and Metadata-Service Authentication

The documentation must distinguish three credentials or sessions:

- `datahub/datahub` authenticates the local Quickstart frontend through its default file-based login.
- A personal access token authenticates the live MCP process to GMS.
- `OPENAI_API_KEY` authenticates the server-side OpenAI provider and is unrelated to DataHub authentication.

Every command that uses `datahub/datahub` must be adjacent to a warning that the credentials are allowed only for an isolated localhost Quickstart. The ports and credentials must never be exposed publicly.

If PAT controls are unavailable, the operator guidance may direct the user to verify `METADATA_SERVICE_AUTH_ENABLED=true` consistently for both `datahub-gms` and `datahub-frontend`, restart the affected services, and verify token-generation privileges. It must not recommend disabling authentication or enabling mutation tools.

For a future production deployment, the attribution or architecture documentation may point to changing the default user, supplying private `DATAHUB_TOKEN_SERVICE_SIGNING_KEY` and `DATAHUB_TOKEN_SERVICE_SALT` values, using the frontend `/api/gms` proxy for programmatic traffic, and configuring OIDC. A future OIDC design must separately validate its client ID and secret, discovery URI, base URL, exact callback URI, JaaS fallback policy, and JIT/group-provisioning behavior. Those are deferred operator requirements, not tasks in the approved hackathon implementation.

### 6. Keep DataHub Skills as a Reference and Contribution Path

The official documentation correctly distinguishes MCP tools (discrete capabilities) from Skills (workflow instructions). LineageGuard implements its bounded workflow in application code and does not load the official general-purpose Skills registry at runtime.

The official Codex installation command, `npx skills add datahub-project/datahub-skills -a codex`, may be cited as an optional operator reference but is not a LineageGuard setup step and must not be run by the product or CI.

The planned `skills/lineageguard-schema-change-impact/` artifact remains:

- a repository-owned, read-only contribution candidate;
- authored after the core offline gate;
- validated against the pinned MCP parameter contract;
- separate from an installation of `datahub-project/datahub-skills`; and
- not described as an accepted DataHub contribution until an approved upstream pull request exists and passes upstream checks.

Official enrichment and quality workflows may perform writes and therefore cannot weaken the project's no-mutation policy.

The local candidate may reuse only clean-room structural patterns from the Apache-2.0 repository at commit `864ee5800c55eb90628f290bd8e91602b0a3e28e`:

- a self-contained `SKILL.md`, `references/`, and `templates/` layout;
- explicit routing, safety boundaries, stop conditions, and red flags;
- human-readable evidence that includes entity names and full URNs;
- separate facts, inferences, scope, limitations, unknowns, and human approval gates; and
- a structured impact template that is extended with LineageGuard's completeness and Context Coverage requirements.

The candidate must not copy the upstream broad `allowed-tools: Bash(datahub *)` permission, CLI or GraphQL fallbacks, mutation-capable companion workflows, or the abstract `get_lineage(urn, direction, depth)` example. Its MCP reference must use the exact pinned `0.6.0` parameter names and bounded pagination contract already verified by LineageGuard.

Before a separately approved upstream pull request, the candidate must be checked in a clean fork against the upstream revision's then-current mandatory baseline: `pre-commit run --all-files`, Prettier, markdownlint, basic file checks, Ruff where applicable, CI, and a Conventional Commit pull-request title. At the inspected revision, `tests/run-tests.sh` requires Claude Code and covers connector skills rather than a new lineage skill, so it cannot serve as functional acceptance evidence for this candidate.

### 7. Treat the MCP Guide as Deployment Guidance, Not Authority

The current MCP guide intentionally documents a broader and moving server surface. LineageGuard continues to launch `uvx mcp-server-datahub@0.6.0 --transport stdio`; the pinned release, source tag, runtime tool discovery, and application tests are the executable contract. The guide's `@latest` command, advertised tool inventory, or future examples must never silently change application authority.

The following guide patterns are adopted:

- configure the self-hosted process with `DATAHUB_GMS_URL` and a shell-local `DATAHUB_GMS_TOKEN`;
- use MCP `readOnlyHint` annotations as compatibility evidence, never as authorization;
- follow the guide's `spawn uvx ENOENT` remedy by using an absolute executable path; the certified Windows adaptation locates it with `Get-Command uvx` and supplies it through LineageGuard's own `DATAHUB_MCP_UVX_PATH` configuration;
- record that a service account's Default View scopes MCP searches, while any effect on the other three allowed reads must be established by the pinned live contract test; and
- treat a changed search-visibility scope as changed or potentially incomplete evidence, not as a reason to disable the view or bypass DataHub authorization.

Managed DataHub Cloud HTTP endpoints, OAuth/DCR, PATs in URLs, `mcp-remote`, service-account provisioning, Default View administration, user/profile tools, documents, SQL/query drafting, semantic search, lineage-path tools, proposals, quality actions, and mutations remain outside the certified local demo.

### 8. Apply a Context-First Agent Boundary

The reusable Agent Context Kit concept is a strict sequence:

```text
Rename intent
  -> four read-only DataHub operations
  -> normalized and bounded evidence with URNs
  -> deterministic ChangeContext and decision
  -> two application-owned OpenAI tools
  -> validated migration artifacts
  -> human approval
```

The OpenAI agent never receives DataHub's raw MCP tool inventory, the shell, filesystem, SQL executor, or Python SDK. Resource ownership, cancellation, deadlines, sanitized traces, bounded repair, and deterministic replay remain application policies rather than assumptions inherited from a framework example.

## Operator Flow

```text
Pinned Quickstart bootstrap
  -> safe Docker and port preflight
  -> GMS health and UI evidence check
  -> shell-local PAT configuration
  -> pinned four-operation MCP integration check
  -> LineageGuard live run

Any unavailable live dependency
  -> explicit diagnostic
  -> deterministic replay fallback
  -> no fabricated live claim
```

## Error and Recovery Policy

| Condition                                                                 | Required response                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DataHub command is not found                                              | Use the pinned workspace-local CLI path and verified Python 3.11 environment. Do not fall back to an unknown global CLI.              |
| A default Quickstart port is occupied                                     | Stop the certified live preflight, identify the owner, and resolve the conflict. Do not silently create a partially remapped profile. |
| `datahub docker check` or GMS health fails                                | Inspect the expected containers and targeted logs. Preserve replay availability. Do not call OpenAI.                                  |
| Docker resources are insufficient                                         | Increase the local Docker allocation before retrying.                                                                                 |
| PAT controls are missing                                                  | Verify Metadata Service Authentication and token privileges on the pinned local stack. Do not enable mutations.                       |
| Default credentials would be reachable beyond localhost                   | Reject the setup as unsupported and direct the operator to the official credential-hardening guidance.                                |
| The golden datapack cannot be loaded                                      | Keep the prior sanitized fixture and use replay; do not substitute private or unlicensed data.                                        |
| An official Skill proposes enrichment, quality mutation, or SQL execution | Do not install or invoke it through the product runtime. Preserve the local read-only skill boundary.                                 |

## Repository Delta

After written-design approval, the implementation plan will make the following bounded changes:

- Amend `docs/specs/002-nextjs-openai-agent-demo/spec.md` with the source review, certified local profile, authentication distinctions, ingestion exclusions, and production-only classification.
- Amend `docs/specs/002-nextjs-openai-agent-demo/plan.md` so Task 14A includes all twelve unique official sources, the safe preflight, exact warnings, source-of-contract rules, evidence-visibility scope, and validator coverage.
- Extend the already planned `README.md`, `docs/demo-scenario.md`, `docs/architecture/agent-demo.md`, `docs/live-verification.md`, and `docs/resources-and-attribution.md` work rather than adding a separate operator handbook. The README will state that `@latest` and managed remote MCP modes are not certified and that a changed Default View changes the evidence scope.
- Extend the planned local-skill task with the clean-room patterns, exact pinned parameters, prohibited broad permissions/fallbacks, and upstream contribution checks defined above.
- Extend the planned submission-asset validator and its tests with stable assertions for the required safety statements and source inventory.
- Make no application-runtime, MCP-authority, OpenAI-agent-tool, database, ingestion, identity-provider, or deployment change.

## Verification Design

### Offline verification

- Static validation requires all twelve canonical official URLs in the attribution inventory, the pinned DataHub Skills commit, and the MCP Server `0.6.0` source and release references.
- Every resource must have one unambiguous classification and project-use statement.
- Documentation validation requires `datahub docker check`, the certified UI/GMS endpoints, the resource baseline, the local-only credential warning, the no-UI-ingestion/no-production-auth scope boundary, and the distinction between moving guide content and the pinned executable contract.
- Local-skill validation requires the repository-owned layout, read-only boundary, exact MCP parameter names, evidence/unknowns/approval sections, clean-room attribution, and absence of broad shell, CLI fallback, SQL, mutation, or autonomous approval instructions.
- The existing secret scan continues to reject persisted DataHub tokens, OpenAI keys, bearer credentials, private-key material, and credential-shaped assignments.
- Offline CI must not require Docker, DataHub, an identity provider, or secrets.

### Opt-in live verification

- The live record captures the pinned versions and results of the safe preflight.
- The operator confirms GMS health, UI access, the golden asset, schema, lineage, ownership, and the four-operation MCP contract.
- The live record identifies the intended DataHub account and search-visibility scope when available; a different Default View invalidates search comparison with certified evidence, and any effect on the other allowed reads remains unclaimed until the pinned live contract test establishes it.
- No live check claims to validate OIDC, multi-user onboarding, custom JAAS, UI ingestion, or production topology.
- A failed live check leaves replay usable and leaves the corresponding submission checklist item unpassed.

## Acceptance Criteria

1. All twelve unique official resources are listed, attributed, and classified.
2. The certified local path documents `datahub docker check`, the default-port profile, and the tested resource baseline.
3. Default `datahub/datahub` use is explicitly limited to isolated localhost Quickstart use wherever it appears.
4. Frontend login, the GMS PAT, and the OpenAI API key are explained as separate boundaries.
5. The golden datapack is described as sample-data bootstrap, not production ingestion.
6. UI ingestion, general connector ingestion, onboarding, OIDC, and custom JAAS do not become runtime requirements.
7. Metadata Service Authentication troubleshooting never suggests disabling authentication or enabling mutations.
8. The official DataHub Skills registry, LineageGuard's local candidate, and MCP tools are clearly distinguished.
9. The MCP guide is documented as moving deployment guidance; only the pinned `0.6.0` release, source, runtime discovery, and application tests define the executable contract.
10. Agent Context Kit remains a workflow reference; no Python SDK, framework adapter, raw MCP discovery, SQL execution, assertion creation, or metadata write is added.
11. The local skill candidate uses clean-room structure, exact pinned parameters, bounded evidence, and upstream contribution checks without broad shell permissions or CLI fallbacks.
12. Destructive recovery remains manual, warned, and outside the normal demo path.
13. No application code, runtime dependency, tool authority, or public deployment is added by this delta.

## Decision Rationale

Approach A is the smallest change that improves reproducibility, security communication, and source traceability while protecting the winning hackathon path: a polished, deterministic, read-only local demo. A separate operator handbook would duplicate the planned submission documents, while production ingestion and identity implementation would consume time, introduce credentials and infrastructure, and contradict the approved single-user local-demo scope.
