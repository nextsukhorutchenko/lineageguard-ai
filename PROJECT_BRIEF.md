# LineageGuard AI — Codex Project Brief

> **Supersession note — 2026-07-23:** This brief preserves the original exploratory product
> discussion. Approved specification `002-nextjs-openai-agent-demo` and its implementation plan
> are the implementation authority. Their four-operation read-only DataHub boundary supersedes
> every exploratory write-back, mutation, automatic owner assignment, usage-query, and
> saved-document suggestion below. Do not enable those capabilities unless a later approved
> specification explicitly replaces `002`.

## 1. How to work with me

- Communicate with me in Ukrainian.
- Keep source code, filenames, commits, README, UI text, technical documentation, Devpost materials, and demo script in English.
- This is a hackathon project with a fixed deadline. Prioritize a small, reliable, polished end-to-end demo over broad unfinished scope.
- Do not start implementing blindly.
- First inspect the current repository, including files, package manager, configuration, Git status, existing documentation, tests, and recent commits.
- Then report:
  1. what already exists;
  2. what is missing;
  3. current risks or blockers;
  4. two or three realistic architecture options;
  5. your recommended option and why.
- Wait for my approval of the design before major implementation.
- After approval, create a detailed implementation plan with small verifiable steps.
- Use test-driven development for core domain logic.
- Before claiming anything is complete, run and report the actual verification commands and results.
- Never invent DataHub APIs, MCP tools, environment variables, or SDK behavior. Verify them against current official documentation or the installed package version.
- Pin important dependency versions and document them.
- Do not expose secrets in code, commits, logs, screenshots, examples, or videos.
- Never use code, schemas, names, documentation, or data from my employers or clients. Use only newly created code, official hackathon sample data, or clearly licensed open data.
- Do not claim a feature works until it is implemented and verified.
- Avoid unrelated refactoring and unnecessary abstraction.

---

# 2. Official hackathon context

## Hackathon

**Build with DataHub: The Agent Hackathon**

Official site:

https://datahub.devpost.com/

Official rules:

https://datahub.devpost.com/rules

Official resources:

https://datahub.devpost.com/resources

Official schedule:

https://datahub.devpost.com/details/dates

DataHub documentation:

https://docs.datahub.com/

DataHub Quickstart:

https://docs.datahub.com/docs/quickstart

Official DataHub MCP Server:

https://github.com/acryldata/mcp-server-datahub

## Dates

- Submission period began: July 6, 2026, 09:00 EDT.
- Official submission deadline: August 10, 2026, 17:00 EDT.
- In Kyiv/Lviv summer time, this is August 11, 2026, 00:00 GMT+3.
- Treat August 8 as the internal feature freeze.
- Treat August 9 as the documentation, video, and submission rehearsal day.
- Submit well before the final hour.
- Judging: August 17–31, 2026.
- Winners announced on or around September 8, 2026.

## Eligibility and project ownership

- Participation is allowed for eligible adults, teams, and organizations, subject to territorial exclusions in the official rules.
- The project must be newly created during the submission period.
- Standard frameworks, libraries, starter templates, and AI coding assistants are allowed.
- Any incorporated pre-existing work must be disclosed.
- The project must be original and must not violate third-party intellectual-property, privacy, trademark, contract, or licensing rights.
- Third-party APIs, SDKs, datasets, and assets may be used only under compatible licenses and terms.
- All submission materials must be in English, or include an English translation.

## Required DataHub usage

The application must use the DataHub open-source platform together with at least one of:

- DataHub MCP Server;
- Agent Context Kit;
- DataHub Skills;
- Analytics Agent.

The selected primary category is:

**Metadata-Aware Code Generation & Development**

The category focuses on agents that read real schemas, lineage, rules, and metadata through DataHub before generating production-oriented artifacts such as:

- migration code;
- transformation models;
- pipeline DAGs;
- ingestion scripts;
- helper scripts;
- configuration;
- pull-request-ready code.

The generated artifact should be useful enough that a real data team could review and merge it.

## Other official categories

- Agents That Do Real Work
- Metadata-Aware Code Generation & Development
- Production ML Agents
- Open / Wildcard

The project may combine categories, but the implementation should remain focused.

## Required submission materials

The final submission must include:

1. A working software application.
2. A URL that gives judges easy access to a functioning demo or test build.
3. A public source-code repository.
4. An Apache License 2.0 `LICENSE` file that Devpost/GitHub can detect.
5. All source code, assets, and complete setup instructions required to run the project.
6. An English project description.
7. A public demo video on YouTube, Vimeo, or Youku.
8. The video must be under three minutes; judges are not required to watch beyond three minutes.
9. The video must show the real functioning application.
10. Testing access must remain free and available through the judging period.
11. Sample generated outputs should be included in an `examples/` directory so judges can evaluate quality without running the project.
12. Avoid copyrighted music and unlicensed third-party trademarks or media in the video.

After the deadline, the official submission normally cannot be materially changed.

## Judging stages

Stage 1 is pass/fail:

- Does the project fit the hackathon theme?
- Does it meaningfully use the required DataHub technology?

Stage 2 uses equally weighted criteria:

1. **Use of DataHub**
   - Meaningful use of schemas, lineage, ownership, governance, ML metadata, the context graph, MCP Server, Agent Context Kit, Skills, or Analytics Agent.
   - Strong projects go beyond merely displaying metadata.
   - Writing useful results back to DataHub is favorable where appropriate.

2. **Technical Execution**
   - End-to-end functionality.
   - Reliability and robustness.
   - Code does what the submission claims.

3. **Originality**
   - The solution should extend or compose DataHub capabilities rather than rebuild existing DataHub functionality.

4. **Real-World Usefulness**
   - A real data, ML, or AI platform team should see practical value.

5. **Submission Quality**
   - Clear video, project story, README, screenshots, and setup instructions.

6. **Optional bonus**
   - A meaningful contribution to DataHub, such as a connector, skill, bug fix, RFC, or documentation improvement.

## Prizes

- Grand Prize: $6,000, one winner.
- Four Challenge Winners: $3,000 each, one per challenge category.
- Two Honourable Mentions: $1,000 each.
- Ten Most Valuable Feedback awards: $50 each.
- A project can win only one main project prize.
- Feedback prizes are separate individual awards subject to the official rules.

---

# 3. Proposed project

## Project name

**LineageGuard AI**

## Elevator pitch

**An AI agent that uses DataHub metadata and lineage to assess schema changes, identify downstream risks, and generate safe migration plans, validation queries, rollback code, and review-ready engineering artifacts.**

## Important status note

This is the proposed product concept, not an already completed product.

Treat every feature below as planned until repository inspection and verification prove otherwise.

---

# 4. Problem statement

Database schema changes often appear local but affect many downstream assets:

- tables and columns;
- views;
- dbt models and transformations;
- ETL/ELT pipelines;
- dashboards;
- reports;
- applications;
- ML features and models;
- scheduled jobs;
- data contracts;
- data owners and business processes.

Teams often discover these dependencies manually or only after deployment.

Generic AI coding assistants may generate plausible migration SQL without knowing:

- the real schema;
- column types;
- downstream lineage;
- query patterns;
- owners;
- governance tags;
- criticality;
- the database platform;
- whether the proposed change is breaking.

LineageGuard AI should use DataHub as the source of factual context before generating migration artifacts.

---

# 5. Target users

Primary users:

- data engineers;
- analytics engineers;
- backend engineers;
- platform engineers;
- database engineers;
- technical leads;
- reviewers responsible for safe schema evolution.

Primary workflow:

> “I want to make this schema change. Tell me what will break, who is affected, how risky it is, and generate a safe rollout package.”

---

# 6. Core demo scenario

The application receives a proposed schema change, for example:

> Rename a customer identifier column and change another identifier from an integer type to UUID.

Do not hardcode this exact scenario until the actual loaded DataHub sample assets have been inspected.

After loading the official sample data:

1. Find a real dataset represented in DataHub.
2. Prefer a PostgreSQL dataset with useful downstream lineage.
3. Select a column and change scenario that produces a clear impact graph.
4. Record the selected URNs and rationale in documentation.
5. Ensure the final demo is deterministic and repeatable.

The agent should:

1. Parse the natural-language request into a structured change intent.
2. Search DataHub for the target dataset.
3. Resolve the exact dataset and column URNs.
4. Read the actual schema.
5. Retrieve upstream and downstream lineage.
6. Retrieve related entity details, ownership, tags, domains, glossary terms, descriptions, usage/query information, and governance signals where available.
7. Build a normalized impact graph.
8. Calculate a deterministic, explainable risk score.
9. Generate a staged migration plan grounded only in the retrieved facts.
10. Generate review-ready artifacts.
11. Validate the generated artifacts as far as practical.
12. Save a concise impact-analysis document back to DataHub if the supported mutation/document tools are available and safe.
13. Display all evidence, assumptions, unknowns, and generated files in the UI.
14. Optionally prepare or create a GitHub pull request.

---

# 7. Required generated artifacts

For each analysis run, generate a directory such as:

```text
runs/<run-id>/
```

Minimum artifacts:

```text
impact-report.json
impact-report.md
migration-up.sql
migration-down.sql
validation.sql
rollout-plan.md
assumptions.json
evidence.json
```

Recommended artifact content:

## `impact-report.json`

- run ID;
- timestamp;
- user request;
- normalized change intent;
- target dataset URN;
- target column URN if applicable;
- source platform;
- original schema;
- proposed schema change;
- directly affected assets;
- indirectly affected assets;
- lineage paths;
- owners;
- tags/domains/glossary/governance signals;
- query evidence when available;
- risk score;
- risk level;
- risk factors;
- unresolved unknowns;
- DataHub tool calls used;
- generation status;
- validation status.

## `impact-report.md`

Human-readable executive and engineering summary.

## `migration-up.sql`

Forward migration or a safe staged migration template appropriate to the confirmed database platform.

## `migration-down.sql`

Rollback migration or an explicit explanation when a safe rollback cannot be guaranteed.

## `validation.sql`

Pre-migration and post-migration checks, such as:

- row counts;
- null counts;
- uniqueness checks;
- referential integrity checks;
- type/cast validation;
- dual-write comparison;
- backfill completion;
- sampled data comparisons.

## `rollout-plan.md`

A staged, backward-compatible plan where appropriate:

1. preparation;
2. additive schema change;
3. dual-read or dual-write;
4. backfill;
5. downstream migration;
6. validation;
7. cutover;
8. observation;
9. cleanup;
10. rollback trigger and rollback process.

## `assumptions.json`

Every assumption the generator made, with confidence and reason.

## `evidence.json`

The exact DataHub facts supporting the conclusions, without requiring judges to inspect internal logs.

---

# 8. DataHub integration requirements

Use the official DataHub MCP Server unless repository inspection reveals a compelling compatibility blocker.

Relevant official MCP tools currently include:

Read-oriented tools:

- `search`
- `get_lineage`
- `get_dataset_queries`
- `get_entities`
- `list_schema_fields`
- `get_lineage_paths_between`
- `search_documents`
- `grep_documents`

Mutation/document tools may include:

- `save_document`
- `update_description`
- `add_structured_properties`
- tag, glossary-term, owner, and domain mutation tools.

Mutation tools must be explicitly enabled and verified against the installed server version.

Prefer a safe write-back:

- save an impact-analysis document to DataHub;
- or attach a structured property identifying the latest LineageGuard analysis;
- do not destructively modify production-like metadata.

The final demo must make DataHub usage visible:

- show selected assets in DataHub;
- show the lineage graph;
- show the actual MCP/tool calls or an auditable trace;
- show how the retrieved context changes the generated output;
- show the write-back document or metadata result if implemented.

Do not use DataHub merely as a decorative catalog screen.

---

# 9. DataHub local setup

Official baseline:

```bash
python3 --version
docker --version
docker compose version

python3 -m pip install --upgrade pip wheel setuptools
python3 -m pip install --upgrade acryl-datahub

datahub version
datahub docker quickstart
```

Local UI:

```text
http://localhost:9002
```

Default quickstart credentials:

```text
username: datahub
password: datahub
```

Configure the CLI and load the rich official sample datapack:

```bash
datahub init --username datahub --password datahub
datahub datapack load showcase-ecommerce
```

The `showcase-ecommerce` datapack contains roughly 1,050 entities across multiple platforms, with lineage, governance, glossary terms, domains, and data products.

The datapack command is documented as experimental, so handle failures clearly and pin/report the tested CLI version.

Useful management commands:

```bash
datahub docker quickstart --stop
datahub docker nuke
```

Never run destructive reset commands without explicit approval if useful local state already exists.

---

# 10. Suggested technical architecture

Do not accept this architecture blindly. Inspect the repository first and propose alternatives.

Recommended starting direction:

```text
Browser UI
   |
Next.js application
   |
Agent orchestration service in TypeScript/Node.js
   |
Official DataHub MCP Server
   |
Local DataHub OSS
   |
Sample metadata/context graph
```

Optional validation path:

```text
Generated SQL
   |
SQL parser / dialect validator
   |
Disposable PostgreSQL test database or controlled test schema
```

Recommended responsibilities:

## Web UI

- accept a natural-language schema-change request;
- optionally let the user choose a target asset;
- show progress;
- show resolved asset and schema;
- visualize affected assets and paths;
- show risk score and explanation;
- display generated artifacts;
- allow artifact download;
- show evidence and assumptions;
- link to the relevant local DataHub asset where possible.

## Agent orchestration

- enforce a state machine;
- prevent generation before required context is collected;
- track every tool call and result;
- normalize DataHub responses;
- separate facts from LLM-generated interpretation;
- handle partial metadata and tool failures;
- persist a run record;
- invoke deterministic risk scoring;
- invoke the artifact generator;
- invoke validators;
- optionally write the result back to DataHub.

## DataHub adapter

- one focused adapter around MCP interactions;
- typed request/response boundaries;
- no DataHub-specific response shapes leaking into the core domain;
- retry only safe transient failures;
- explicit timeouts;
- structured errors;
- tool-call tracing with secrets removed.

## Change-intent parser

Convert user input into a validated structure, for example:

```ts
type ChangeIntent =
  | {
      kind: "rename_column";
      datasetHint: string;
      from: string;
      to: string;
    }
  | {
      kind: "change_column_type";
      datasetHint: string;
      column: string;
      fromType?: string;
      toType: string;
    }
  | {
      kind: "drop_column";
      datasetHint: string;
      column: string;
    }
  | {
      kind: "add_column";
      datasetHint: string;
      column: string;
      dataType: string;
      nullable: boolean;
    };
```

Start with one or two change types for the MVP. Do not implement every possible database change.

## Impact engine

Inputs:

- resolved target asset;
- real schema;
- column or table lineage;
- related entities;
- ownership;
- governance and criticality signals;
- query usage when available;
- change intent.

Outputs:

- affected assets;
- lineage paths;
- evidence;
- unknowns;
- deterministic risk score;
- risk explanation.

## Risk engine

Risk must not be a free-form LLM opinion.

Use explainable deterministic factors, for example:

- change type severity;
- destructive versus additive change;
- number of downstream assets;
- number of lineage hops;
- column-level lineage presence;
- dashboards or reports affected;
- pipelines or transformations affected;
- ML assets affected;
- critical/governed/PII tags;
- production environment;
- owner missing;
- metadata incomplete;
- sample queries referencing the column;
- rollback difficulty.

Return:

```ts
interface RiskAssessment {
  score: number; // 0–100
  level: "low" | "medium" | "high" | "critical";
  factors: Array<{
    code: string;
    weight: number;
    evidence: string[];
  }>;
  unknowns: string[];
}
```

Document the scoring formula and test boundary cases.

## Artifact generator

- Generate only from a structured, validated context object.
- The prompt must clearly separate facts, assumptions, and missing information.
- Never invent asset names, owners, lineage, or schema fields.
- Use platform/dialect information from DataHub.
- If the platform or migration semantics are uncertain, produce a clearly marked template rather than unsafe executable SQL.
- Include comments linking risky steps to evidence.
- Prefer backward-compatible rollout patterns.

## Validator

At minimum:

- SQL parsing or dialect validation;
- file presence;
- no unresolved template variables;
- no references to columns absent from known schema unless they are being created;
- artifact consistency;
- risk report and rollout-plan consistency.

Stronger option:

- apply generated SQL to a disposable PostgreSQL schema;
- run validation queries;
- test rollback where practical.

## LLM provider

- Use a provider interface.
- Keep provider-specific code isolated.
- Read credentials only from environment variables.
- Include a deterministic fake provider for unit and integration tests.
- The system should fail clearly when no real model credentials are configured.
- Do not require a paid hosted service for judges merely to inspect the repository and sample outputs.

## Persistence

For a hackathon MVP, prefer simple local persistence:

- filesystem run directories;
- SQLite;
- or a small PostgreSQL table if already needed.

Do not add a complex event-driven architecture unless the repository already justifies it.

---

# 11. Suggested repository structure

Prefer a small pnpm monorepo only if it reduces complexity:

```text
.
├── apps/
│   └── web/
├── packages/
│   ├── domain/
│   ├── datahub/
│   ├── agent/
│   ├── risk-engine/
│   ├── artifact-generator/
│   └── validator/
├── examples/
│   ├── completed-run/
│   └── sample-inputs/
├── docs/
│   ├── architecture.md
│   ├── demo-script.md
│   ├── devpost-story.md
│   └── decisions/
├── infra/
│   └── docker/
├── scripts/
├── LICENSE
├── README.md
├── CONTRIBUTING.md
├── .env.example
└── package.json
```

If the current repository is simpler, preserve simplicity rather than forcing a monorepo.

---

# 12. MVP scope

The MVP is successful when one carefully selected scenario works end to end.

## Must have

- local DataHub OSS setup documented;
- official sample data loaded;
- official DataHub MCP integration working;
- target asset search and resolution;
- actual schema retrieval;
- downstream lineage retrieval;
- affected-asset report;
- deterministic risk score;
- generated migration, rollback, validation, and rollout artifacts;
- evidence and assumptions separated;
- clear UI or polished CLI;
- sample output committed under `examples/`;
- at least one safe result written back to DataHub, preferably a saved document, if technically supported;
- tests for core domain logic;
- reproducible setup;
- Apache-2.0 license;
- English README;
- end-to-end demo path.

## Should have

- column-level lineage when available;
- query-usage evidence;
- owner and governance metadata;
- SQL validation;
- architecture diagram;
- run history;
- artifact download;
- one-command demo bootstrap;
- a graceful “metadata incomplete” result rather than hallucination.

## Could have

- GitHub branch/PR generation;
- comparison of two migration strategies;
- support for a second change type;
- graph visualization;
- structured properties written back to DataHub;
- a small open-source contribution to DataHub;
- evaluation dataset and quality metrics.

## Explicit non-goals for the MVP

- autonomous production database changes;
- auto-merging GitHub pull requests;
- broad support for every SQL dialect;
- full enterprise authentication and authorization;
- multi-tenant SaaS;
- production deployment of DataHub;
- every schema-change type;
- replacing DataHub’s own lineage or catalog UI;
- using real employer/client data.

---

# 13. Example end-to-end state machine

```text
RECEIVED
  -> PARSED
  -> TARGET_SEARCHED
  -> TARGET_CONFIRMED
  -> SCHEMA_LOADED
  -> LINEAGE_LOADED
  -> CONTEXT_ENRICHED
  -> IMPACT_CALCULATED
  -> RISK_SCORED
  -> ARTIFACTS_GENERATED
  -> ARTIFACTS_VALIDATED
  -> DATAHUB_WRITEBACK_COMPLETED
  -> COMPLETED
```

Failure states must be explicit:

```text
NEEDS_USER_CLARIFICATION
INSUFFICIENT_METADATA
DATAHUB_UNAVAILABLE
GENERATION_FAILED
VALIDATION_FAILED
WRITEBACK_FAILED
```

A write-back failure should not erase a successfully generated local report.

---

# 14. Error handling requirements

- If multiple datasets match, do not guess. Ask the user to select one.
- If a column does not exist, stop and show the actual schema.
- If lineage is empty, say so clearly and lower confidence.
- If only table-level lineage exists, do not claim column-level impact.
- If platform/dialect is unknown, do not emit unqualified executable SQL.
- If DataHub is unavailable, show setup/troubleshooting guidance.
- If the LLM fails, retain the deterministic impact report.
- If SQL validation fails, mark the run failed and preserve artifacts for debugging.
- Redact tokens, passwords, and sensitive environment values from traces.
- All user-visible errors should include a recovery action.

---

# 15. Testing strategy

## Unit tests

- change-intent parsing;
- schema-change validation;
- impact-graph normalization;
- risk scoring;
- risk thresholds;
- unknown/partial metadata behavior;
- artifact consistency;
- SQL identifier quoting;
- assumption collection;
- redaction.

## Contract tests

- DataHub MCP adapter with recorded/sanitized fixtures;
- schema and lineage response normalization;
- mutation/document tool behavior behind a feature flag.

## Integration tests

- local official DataHub MCP Server;
- local DataHub OSS;
- loaded sample datapack;
- at least one real search → schema → lineage flow.

## End-to-end test

One deterministic demo input must produce:

- the expected resolved asset;
- a non-empty evidence set;
- a risk assessment;
- all required artifacts;
- a visible UI result;
- a successful or clearly explained write-back result.

## Verification commands

Codex must establish and maintain commands similar to:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm demo:verify
```

Do not claim success unless command output has been checked.

---

# 16. Security and privacy

- No employer/client repositories or data.
- No real secrets in `.env.example`.
- Add `.env` and local state to `.gitignore`.
- Scan the repository before every public push.
- Do not log DataHub access tokens.
- Use least-privilege credentials.
- Keep mutation tools disabled by default.
- Enable write-back only through an explicit environment flag.
- Validate all paths and generated filenames.
- Prevent prompt content from writing arbitrary files outside the run directory.
- Treat DataHub descriptions and documents as untrusted input.
- Clearly label generated code as requiring human review.
- Never execute destructive migration SQL automatically.

---

# 17. README requirements

The README must allow a judge to understand the project quickly.

Recommended order:

1. One-sentence pitch.
2. Demo GIF or screenshot.
3. The problem.
4. Why DataHub is essential.
5. What the project does.
6. Architecture diagram.
7. End-to-end flow.
8. DataHub MCP tools used.
9. Sample output.
10. Local prerequisites.
11. Quickstart.
12. Environment variables.
13. Demo scenario.
14. Tests.
15. Known limitations.
16. Security model.
17. Hackathon disclosure and pre-existing components.
18. Apache-2.0 license.
19. Links to Devpost and video when available.

Include an explicit section:

## How DataHub is used

This must name the exact tools and explain what context each contributes.

Include another section:

## What LineageGuard adds beyond DataHub

This should explain that the project adds:

- structured schema-change intent;
- deterministic impact/risk analysis;
- migration artifact generation;
- validation;
- rollout guidance;
- optional PR workflow;
- write-back of engineering knowledge.

---

# 18. Devpost project story draft

Update this only after implementation. Do not claim unimplemented functionality.

## Inspiration

Database schema changes often look simple but can affect views, pipelines, dashboards, applications, and machine-learning workflows. Engineers frequently discover these dependencies manually or only after a deployment causes failures.

LineageGuard AI was inspired by the need for a safer and more systematic way to plan data changes. Instead of relying on incomplete documentation or repository-wide guessing, it uses DataHub metadata and lineage as the factual context for an AI-assisted migration workflow.

## What it does

LineageGuard AI analyzes a proposed schema change, identifies downstream impact, calculates an explainable risk score, and generates a review-ready migration package.

Depending on the final implementation, the package may include:

- impact reports;
- staged rollout guidance;
- forward migration SQL;
- rollback SQL;
- pre- and post-migration validation queries;
- evidence and assumptions;
- a DataHub knowledge document;
- optional GitHub pull-request artifacts.

## How we built it

This section must be rewritten using the real final architecture and tested versions.

Expected components may include:

- DataHub Open Source;
- official DataHub MCP Server;
- TypeScript and Node.js;
- Next.js;
- a deterministic risk engine;
- an LLM provider;
- Docker;
- PostgreSQL or SQL validation tooling.

## Challenges we ran into

Replace this section with real challenges encountered during development, such as:

- resolving ambiguous assets;
- distinguishing table-level from column-level lineage;
- handling incomplete metadata;
- grounding generated SQL in the real platform and schema;
- validating generated rollback steps;
- making DataHub write-back safe;
- creating a reliable local quickstart.

## Accomplishments that we're proud of

Only list verified final achievements.

## What we learned

Describe real learning about:

- DataHub’s context graph;
- MCP tool orchestration;
- lineage-aware code generation;
- deterministic safeguards around LLM generation;
- safe schema evolution;
- reusable engineering evidence.

## What's next

Keep future work clearly separated from current functionality.

---

# 19. Three-minute demo structure

Target total length: approximately 2:40–2:55.

## 0:00–0:20 — Problem

Explain that a seemingly local schema change may silently break downstream pipelines, dashboards, and models.

## 0:20–0:40 — Product

Introduce LineageGuard AI and explain that it uses DataHub context before generating migration artifacts.

## 0:40–1:05 — DataHub context

Show:

- the selected DataHub asset;
- schema;
- lineage;
- owners/governance context.

## 1:05–1:55 — Live workflow

Enter the prepared change request and show:

- asset resolution;
- MCP/tool trace;
- impacted assets;
- risk score;
- evidence and unknowns.

## 1:55–2:25 — Generated artifacts

Show:

- migration SQL;
- rollback;
- validation queries;
- rollout plan;
- example files in the repository.

## 2:25–2:45 — Write-back and architecture

Show the saved DataHub document or other safe write-back, then briefly show the architecture diagram.

## 2:45–2:55 — Value

Conclude with the practical value for data/platform teams.

Do not spend video time on installation.

---

# 20. Timeline

## July 22–23

- inspect repository;
- finalize architecture;
- run DataHub quickstart;
- load sample datapack;
- verify MCP connectivity;
- select the exact demo asset and change scenario;
- write the approved design and implementation plan.

## July 24–27

- implement DataHub adapter;
- implement search, schema, entity, and lineage retrieval;
- capture auditable tool traces;
- create integration fixtures.

## July 28–31

- implement change-intent parsing;
- impact graph;
- deterministic risk engine;
- evidence/assumption models;
- unit tests.

## August 1–3

- implement artifact generation;
- SQL and consistency validation;
- completed sample run under `examples/`.

## August 4–5

- implement or polish UI;
- implement safe DataHub write-back;
- add run history and artifact downloads if time permits.

## August 6–7

- complete end-to-end tests;
- improve error handling;
- improve README;
- create architecture diagram;
- perform secret and license review.

## August 8

- feature freeze;
- final demo scenario rehearsal;
- capture stable screenshots;
- deploy or prepare judge-accessible test instructions.

## August 9

- record video;
- finalize Devpost project story;
- verify repository from a clean checkout;
- complete submission rehearsal.

## August 10

- final verification only;
- submit early;
- do not introduce risky features.

---

# 21. Definition of done

The project is ready for submission only when:

- [ ] The repository is public.
- [ ] The repository has a detectable Apache-2.0 license.
- [ ] A clean checkout can be installed using the README.
- [ ] DataHub setup and tested versions are documented.
- [ ] The exact demo scenario runs end to end.
- [ ] DataHub is used through the official MCP Server or another allowed official component.
- [ ] The retrieved schema and lineage materially affect the output.
- [ ] Facts, assumptions, and unknowns are clearly separated.
- [ ] Risk scoring is deterministic and tested.
- [ ] Required artifacts are generated.
- [ ] Sample outputs exist under `examples/`.
- [ ] Generated SQL is validated or explicitly marked as a template.
- [ ] No destructive action is executed automatically.
- [ ] A safe DataHub write-back works, or the limitation is honestly documented.
- [ ] Lint passes.
- [ ] Type checking passes.
- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Production build passes.
- [ ] No secrets or private data are committed.
- [ ] README is complete and in English.
- [ ] Devpost description matches actual functionality.
- [ ] The public video is under three minutes.
- [ ] Judges can access the demo for free through the judging period.
- [ ] All third-party licenses and pre-existing components are disclosed.

---

# 22. First task for Codex

Begin with discovery only.

1. Inspect the current repository and Git state.
2. Read existing documentation and configuration.
3. Do not modify code yet.
4. Check whether DataHub, Docker, Python, Node.js, and the package manager are already configured.
5. Identify the operating system and commands that will work in the current environment.
6. Compare the repository against this brief.
7. Report:
   - existing files and architecture;
   - what is already implemented;
   - what is missing;
   - broken or risky areas;
   - external prerequisites;
   - two or three architecture approaches;
   - a recommended MVP architecture;
   - the smallest vertical slice that proves the concept.
8. Ask one focused clarification question only if a decision cannot safely be inferred.
9. Wait for approval before implementing the architecture.

The first vertical slice should ideally prove:

```text
user change request
  -> DataHub asset search
  -> schema retrieval
  -> downstream lineage retrieval
  -> basic deterministic impact report
  -> one generated Markdown artifact
```

Do not build the full UI or GitHub PR integration before this vertical slice works.
