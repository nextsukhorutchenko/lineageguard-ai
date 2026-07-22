# DataHub Impact Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved

**Specification:** `docs/specs/001-datahub-impact-slice/spec.md`

**Goal:** Build a deterministic TypeScript CLI that validates one column-rename request, retrieves real schema and downstream lineage through the official DataHub MCP Server, calculates an explainable impact score, and writes a grounded Markdown report beneath `runs/<run-id>/`.

**Architecture:** Use one pnpm package with a thin CLI, an application orchestrator, pure domain modules, a typed DataHub catalog port, and an MCP stdio adapter that launches the pinned Python server through `uvx`. Keep DataHub response shapes, subprocess lifecycle, redaction, report rendering, and filesystem writes outside deterministic domain logic so the same modules can later be reused by Next.js.

**Tech Stack:** Node.js 22.23.1, pnpm 10.10.0, TypeScript 6.0.3, Zod 4.4.3, Vitest 4.1.10, MCP TypeScript SDK 1.29.0, DataHub MCP Server 0.6.0, DataHub CLI 1.6.0.15, DataHub Core v1.6.0.

## Global Constraints

- Use one TypeScript codebase managed by pnpm; do not create a monorepo.
- The first entrypoint is CLI-only. Do not add Next.js or browser UI in this slice.
- Support exactly one change kind: `rename_column`.
- Do not add OpenAI or any other LLM dependency.
- Use only `search`, `list_schema_fields`, and `get_lineage` from the official DataHub MCP Server.
- Launch `uvx mcp-server-datahub@0.6.0 --transport stdio` as a child process.
- Keep `TOOLS_IS_MUTATION_ENABLED=false`, `DATAHUB_MCP_DOCUMENT_TOOLS_DISABLED=true`, and `SAVE_DOCUMENT_TOOL_ENABLED=false` in the child environment.
- Use DataHub Core v1.6.0 and `acryl-datahub==1.6.0.15` from a Python 3.11 virtual environment.
- Never commit `DATAHUB_GMS_TOKEN`, `.env`, `.datahubenv`, raw private metadata, or unsanitized MCP payloads.
- Write generated files only beneath the configured runs directory.
- Keep repository code, documentation, CLI output, report text, test names, and commit messages in English.
- Use TDD for request validation, resolution, normalization, impact scoring, redaction, and path safety.
- Do not start the Next.js transition until this slice passes all acceptance criteria and its live integration test.

## Resolved Technical Decisions

| Decision           | Resolution                                                                                                     | Reason                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo dataset       | `urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)`            | The committed sanitized capture of the official `showcase-ecommerce` datapack records 24 downstream asset URNs within two hops and 11 exact-URN column-lineage confirmations for `customer_id`. |
| Demo change        | Rename `customer_id` to `customer_key`                                                                         | The source field exists as `NUMBER(38,0)` and has visible downstream column evidence.                                                                                                           |
| Demo request       | `Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details` | The platform-qualified dataset identity supports deterministic resolution.                                                                                                                      |
| Lineage bound      | Two hops                                                                                                       | It captures the complete observed demo blast radius without invoking DataHub's `3+` full-graph behavior.                                                                                        |
| MCP client         | `@modelcontextprotocol/sdk@1.29.0` v1                                                                          | The official SDK still recommends v1 until the v2 line becomes stable.                                                                                                                          |
| Runtime validation | Zod 4.4.3                                                                                                      | One dependency covers CLI input, configuration, MCP response boundaries, and fixtures.                                                                                                          |
| Test runner        | Vitest 4.1.10                                                                                                  | It supports Node 22 and TypeScript ESM with fast focused test execution.                                                                                                                        |
| Impact formula     | `25 + downstream + depth + confirmed-column + gap`, capped at 100                                              | It is deterministic, explainable, and separately exposes every factor.                                                                                                                          |
| Next.js transition | After AC-001 through AC-010 pass for the CLI slice                                                             | This preserves the CLI as the proof boundary and prevents premature UI work.                                                                                                                    |

## Verified Primary References

- DataHub MCP Server configuration and self-hosted `uvx` launch: https://docs.datahub.com/docs/features/feature-guides/mcp
- DataHub MCP Server v0.6.0 source and tool contracts: https://github.com/acryldata/mcp-server-datahub/tree/v0.6.0
- MCP TypeScript SDK v1 client and stdio transport: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x
- DataHub Core v1.6.0 release: https://github.com/datahub-project/datahub/releases/tag/v1.6.0
- Official `showcase-ecommerce` datapack index: https://github.com/datahub-project/static-assets/blob/main/datapacks/showcase-ecommerce/index.json

## Target File Map

```text
/
├── .env.example
├── .nvmrc
├── LICENSE
├── README.md
├── eslint.config.mjs
├── package.json
├── pnpm-lock.yaml
├── prettier.config.mjs
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── docs/
│   └── demo-scenario.md
├── examples/
│   └── 001-customer-id-rename/
│       └── impact-report.md
├── scripts/
│   └── capture-datahub-fixtures.ts
├── src/
│   ├── cli.ts
│   ├── app/
│   │   └── run-impact-analysis.ts
│   ├── artifacts/
│   │   ├── render-impact-report.ts
│   │   └── write-run-artifacts.ts
│   ├── config/
│   │   └── runtime-config.ts
│   ├── datahub/
│   │   ├── catalog.ts
│   │   └── mcp/
│   │       ├── datahub-mcp-catalog.ts
│   │       ├── decode-tool-result.ts
│   │       ├── mcp-client.ts
│   │       └── schemas.ts
│   ├── domain/
│   │   ├── change-intent.ts
│   │   ├── evidence.ts
│   │   ├── impact-assessment.ts
│   │   ├── resolve-dataset.ts
│   │   └── run-result.ts
│   ├── errors/
│   │   └── app-error.ts
│   └── security/
│       └── redact.ts
└── tests/
    ├── fixtures/datahub/
    │   ├── search-order-details.json
    │   ├── schema-order-details.json
    │   ├── lineage-order-details-table.json
    │   └── lineage-order-details-customer-id.json
    ├── integration/datahub-mcp.integration.test.ts
    └── smoke/toolchain.test.ts
```

Each production module has one responsibility. Unit tests are colocated as `*.test.ts` beside their production module; only smoke, integration, and reusable fixtures live under `tests/`.

---

### Task 1: Pin the Runtime and Create the TypeScript Package

**Files:**

- Create: `.nvmrc`
- Create: `.env.example`
- Create: `LICENSE`
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `vitest.config.ts`
- Create: `tests/smoke/toolchain.test.ts`
- Modify: `README.md` if it exists; otherwise create it

**Interfaces:**

- Consumes: Node.js 22.23.1 and pnpm 10.10.0 installed locally.
- Produces: Stable `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` commands used by every later task.

- [ ] **Step 1: Create the pinned package manifest and configuration**

Use this exact dependency set in `package.json`:

```json
{
  "name": "lineageguard-ai",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.10.0",
  "engines": { "node": "22.23.1" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "demo": "tsx src/cli.ts --request \"Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details\"",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "start": "node dist/cli.js",
    "test": "vitest run --exclude tests/integration/**",
    "test:integration": "vitest run tests/integration/datahub-mcp.integration.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "22.20.1",
    "eslint": "10.7.0",
    "prettier": "3.9.6",
    "tsx": "4.23.1",
    "typescript": "6.0.3",
    "typescript-eslint": "8.65.0",
    "vitest": "4.1.10"
  }
}
```

Set `.nvmrc` to `22.23.1`. Set `.env.example` to:

```dotenv
DATAHUB_GMS_URL=http://localhost:8080
DATAHUB_GMS_TOKEN=
DATAHUB_MCP_UVX_PATH=uvx
LINEAGEGUARD_RUNS_DIR=runs
```

Use NodeNext modules, `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`. Configure the build to emit `src/**/*.ts` into `dist/` without test files. Add the canonical Apache License 2.0 text to `LICENSE`.

- [ ] **Step 2: Add the toolchain smoke test**

```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs on the pinned Node major version", () => {
    expect(Number.parseInt(process.versions.node, 10)).toBe(22);
  });
});
```

- [ ] **Step 3: Install and verify the package foundation**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is created with exact resolved versions and the command exits 0.

Run: `pnpm test tests/smoke/toolchain.test.ts`

Expected: one test passes.

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm format:check`

Expected: all commands exit 0.

- [ ] **Step 4: Commit the foundation**

```bash
git add .nvmrc .env.example LICENSE README.md package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json eslint.config.mjs prettier.config.mjs vitest.config.ts tests/smoke/toolchain.test.ts
git commit -m "build: bootstrap the TypeScript CLI package"
```

---

### Task 2: Parse and Resolve the Supported Rename Request

**Files:**

- Create: `src/errors/app-error.ts`
- Create: `src/domain/change-intent.ts`
- Create: `src/domain/change-intent.test.ts`
- Create: `src/domain/resolve-dataset.ts`
- Create: `src/domain/resolve-dataset.test.ts`

**Interfaces:**

- Consumes: Raw request string and normalized `DatasetCandidate[]`.
- Produces: `ChangeIntent`, `parseChangeIntent(request)`, `DatasetCandidate`, and `resolveDataset(intent, candidates)`.

- [ ] **Step 1: Write failing request-parser tests**

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseChangeIntent } from "./change-intent.js";

describe("parseChangeIntent", () => {
  it("parses the single supported rename grammar", () => {
    expect(
      parseChangeIntent(
        "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details",
      ),
    ).toEqual({
      kind: "rename_column",
      datasetHint: "snowflake:b2fd91.order_entry_db.analytics.order_details",
      sourceColumn: "customer_id",
      targetColumn: "customer_key",
    });
  });

  it.each([
    "Drop column customer_id in dataset snowflake:orders",
    "Rename customer_id in dataset snowflake:orders",
    "Rename column customer_id to customer_key and drop email in dataset snowflake:orders",
  ])("rejects unsupported or incomplete input: %s", (request) => {
    expect(() => parseChangeIntent(request)).toThrowError(
      expect.objectContaining<AppError>({ code: "INVALID_REQUEST" }),
    );
  });
});
```

- [ ] **Step 2: Run the parser test to verify RED**

Run: `pnpm vitest run src/domain/change-intent.test.ts`

Expected: FAIL because `change-intent.ts` and `app-error.ts` do not exist.

- [ ] **Step 3: Implement the constrained parser and typed application error**

```ts
export type AppErrorCode =
  | "INVALID_REQUEST"
  | "TARGET_NOT_FOUND"
  | "NEEDS_USER_CLARIFICATION"
  | "COLUMN_NOT_FOUND"
  | "DATAHUB_UNAVAILABLE"
  | "MCP_UNAVAILABLE"
  | "ARTIFACT_WRITE_FAILED";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}
```

```ts
import { z } from "zod";
import { AppError } from "../errors/app-error.js";

const identifier = "[A-Za-z_][A-Za-z0-9_$]*";
const renamePattern = new RegExp(
  `^rename\\s+(?:the\\s+)?column\\s+(${identifier})\\s+to\\s+(${identifier})\\s+in\\s+(?:the\\s+)?dataset\\s+(.+?)\\.?$`,
  "i",
);
const secondChangePattern = /\b(and|also|then)\s+(rename|drop|add|change)\b/i;

export const changeIntentSchema = z.object({
  kind: z.literal("rename_column"),
  datasetHint: z.string().trim().min(1),
  sourceColumn: z.string().regex(new RegExp(`^${identifier}$`)),
  targetColumn: z.string().regex(new RegExp(`^${identifier}$`)),
});
export type ChangeIntent = z.infer<typeof changeIntentSchema>;

export function parseChangeIntent(request: string): ChangeIntent {
  const match = request.trim().match(renamePattern);
  if (!match || secondChangePattern.test(request)) {
    throw new AppError(
      "INVALID_REQUEST",
      "Supported format: Rename column <source> to <target> in dataset <dataset hint>.",
    );
  }
  return changeIntentSchema.parse({
    kind: "rename_column",
    sourceColumn: match[1],
    targetColumn: match[2],
    datasetHint: match[3],
  });
}
```

- [ ] **Step 4: Write failing deterministic-resolution tests**

Cover an exact URN, exact `platform:name`, no candidates, and two exact candidates. The successful assertion must resolve only this identity:

```ts
expect(
  resolveDataset(intent, [
    {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)",
      name: "b2fd91.order_entry_db.analytics.order_details",
      platform: "snowflake",
    },
    {
      urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,b2fd91.ORDER_ENTRY_DB.analytics.order_details,PROD)",
      name: "b2fd91.ORDER_ENTRY_DB.analytics.order_details",
      platform: "dbt",
    },
  ]),
).toMatchObject({ platform: "snowflake" });
```

No-match must throw `TARGET_NOT_FOUND`; multiple exact matches must throw `NEEDS_USER_CLARIFICATION` with sorted candidate URNs in `details.candidates`.

- [ ] **Step 5: Implement deterministic resolution**

```ts
export interface DatasetCandidate {
  readonly urn: string;
  readonly name: string;
  readonly platform?: string;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

export function resolveDataset(
  intent: ChangeIntent,
  candidates: readonly DatasetCandidate[],
): DatasetCandidate {
  const hint = normalize(intent.datasetHint);
  const exact = candidates.filter((candidate) => {
    const keys = [candidate.urn, candidate.name];
    if (candidate.platform) keys.push(`${candidate.platform}:${candidate.name}`);
    return keys.some((key) => normalize(key) === hint);
  });

  if (exact.length === 0) {
    throw new AppError("TARGET_NOT_FOUND", `No dataset exactly matches ${intent.datasetHint}.`, {
      searchHint: intent.datasetHint,
    });
  }
  if (exact.length > 1) {
    throw new AppError("NEEDS_USER_CLARIFICATION", "Several datasets match exactly.", {
      candidates: exact.map(({ urn }) => urn).sort(),
    });
  }
  return exact[0]!;
}
```

- [ ] **Step 6: Verify and commit the request boundary**

Run: `pnpm vitest run src/domain/change-intent.test.ts src/domain/resolve-dataset.test.ts`

Expected: all parser and resolution tests pass.

```bash
git add src/errors/app-error.ts src/domain/change-intent.ts src/domain/change-intent.test.ts src/domain/resolve-dataset.ts src/domain/resolve-dataset.test.ts
git commit -m "feat: validate rename requests and dataset resolution"
```

---

### Task 3: Define Stable Evidence and Run Result Contracts

**Files:**

- Create: `src/domain/evidence.ts`
- Create: `src/domain/evidence.test.ts`
- Create: `src/domain/run-result.ts`
- Create: `src/datahub/catalog.ts`

**Interfaces:**

- Consumes: DataHub-independent candidates, schema fields, and lineage items.
- Produces: `DataHubCatalog`, `NormalizedEvidence`, `EvidenceLevel`, `RunStatus`, and stable sorting/column validation helpers.

- [ ] **Step 1: Write failing evidence tests**

```ts
it("sorts assets and fields deterministically", () => {
  const result = normalizeEvidence({
    target: candidate,
    fields: [field("z_col"), field("customer_id"), field("a_col")],
    tableLineage: [lineage("urn:z", 2), lineage("urn:a", 1)],
    columnLineage: [lineage("urn:z", 2, ["customer_id"])],
    trace: [],
  });
  expect(result.schemaFields.map((item) => item.fieldPath)).toEqual([
    "a_col",
    "customer_id",
    "z_col",
  ]);
  expect(result.downstreamAssets.map((item) => item.urn)).toEqual(["urn:a", "urn:z"]);
});

it("rejects a missing source column with actual field names", () => {
  expect(() => requireSourceColumn([field("order_id")], "customer_id")).toThrowError(
    expect.objectContaining<AppError>({
      code: "COLUMN_NOT_FOUND",
      details: { knownFields: ["order_id"] },
    }),
  );
});
```

- [ ] **Step 2: Run the evidence test to verify RED**

Run: `pnpm vitest run src/domain/evidence.test.ts`

Expected: FAIL because the evidence contracts do not exist.

- [ ] **Step 3: Implement the stable evidence contracts**

```ts
export interface SchemaField {
  readonly fieldPath: string;
  readonly nativeDataType?: string;
  readonly nullable?: boolean;
  readonly description?: string;
}

export interface LineageAsset {
  readonly urn: string;
  readonly name?: string;
  readonly platform?: string;
  readonly hop: number;
  readonly lineageColumns: readonly string[];
}

export interface ToolTraceEntry {
  readonly callId: string;
  readonly tool: "search" | "list_schema_fields" | "get_lineage";
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly status: "ok" | "error";
}

export type EvidenceLevel = "column" | "table" | "none";

export interface NormalizedEvidence {
  readonly targetDataset: DatasetCandidate;
  readonly schemaFields: readonly SchemaField[];
  readonly sourceColumn: SchemaField;
  readonly downstreamAssets: readonly LineageAsset[];
  readonly columnAffectedAssets: readonly LineageAsset[];
  readonly evidenceLevel: EvidenceLevel;
  readonly metadataGaps: readonly string[];
  readonly trace: readonly ToolTraceEntry[];
}
```

`normalizeEvidence` must deduplicate assets by URN, retain the lowest hop, sort every URN and field path with `localeCompare(..., "en-US")`, and set:

```ts
const evidenceLevel: EvidenceLevel =
  columnAffectedAssets.length > 0 ? "column" : downstreamAssets.length > 0 ? "table" : "none";
```

`requireSourceColumn` must compare `fieldPath.normalize("NFKC").toLocaleLowerCase("en-US")` exactly and throw `COLUMN_NOT_FOUND` with sorted real field names.

- [ ] **Step 4: Define the catalog port and run statuses**

```ts
export interface DataHubCatalog {
  searchDatasets(hint: string): Promise<readonly DatasetCandidate[]>;
  listSchemaFields(datasetUrn: string): Promise<readonly SchemaField[]>;
  getDownstreamLineage(
    datasetUrn: string,
    options: { readonly column?: string; readonly maxHops: 2 },
  ): Promise<readonly LineageAsset[]>;
  getTrace(): readonly ToolTraceEntry[];
  close(): Promise<void>;
}
```

```ts
export type RunStatus =
  | "COMPLETED"
  | "COMPLETED_WITH_LIMITATIONS"
  | "INSUFFICIENT_METADATA"
  | "TARGET_NOT_FOUND"
  | "NEEDS_USER_CLARIFICATION"
  | "COLUMN_NOT_FOUND"
  | "DATAHUB_UNAVAILABLE"
  | "MCP_UNAVAILABLE"
  | "ARTIFACT_WRITE_FAILED";
```

- [ ] **Step 5: Verify and commit the domain contracts**

Run: `pnpm vitest run src/domain/evidence.test.ts`

Expected: stable ordering and missing-column tests pass.

```bash
git add src/domain/evidence.ts src/domain/evidence.test.ts src/domain/run-result.ts src/datahub/catalog.ts
git commit -m "feat: define normalized DataHub evidence contracts"
```

---

### Task 4: Calculate the Deterministic Impact Assessment

**Files:**

- Create: `src/domain/impact-assessment.ts`
- Create: `src/domain/impact-assessment.test.ts`

**Interfaces:**

- Consumes: `NormalizedEvidence` for a `rename_column` intent.
- Produces: `ImpactAssessment` with a capped score, risk level, confidence, and named factors.

- [ ] **Step 1: Write failing score tests**

Test these exact cases:

```ts
expect(assessImpact(evidence({ downstream: 0, columnAffected: 0, maxHop: 0 }))).toMatchObject({
  score: 35,
  level: "medium",
  confidence: "low",
});

expect(assessImpact(evidence({ downstream: 2, columnAffected: 2, maxHop: 1 }))).toMatchObject({
  score: 44,
  level: "medium",
  confidence: "high",
});

expect(assessImpact(evidence({ downstream: 19, columnAffected: 8, maxHop: 2 }))).toMatchObject({
  score: 90,
  level: "critical",
  confidence: "medium",
});
```

Call the function twice with the same fixture and assert deep equality.

- [ ] **Step 2: Run the score test to verify RED**

Run: `pnpm vitest run src/domain/impact-assessment.test.ts`

Expected: FAIL because `assessImpact` does not exist.

- [ ] **Step 3: Implement the exact scoring formula**

```ts
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";

export interface RiskFactor {
  readonly name:
    "renameSeverity" | "downstreamAssets" | "lineageDepth" | "confirmedColumns" | "metadataGap";
  readonly points: number;
  readonly explanation: string;
}

export interface ImpactAssessment {
  readonly score: number;
  readonly level: RiskLevel;
  readonly confidence: Confidence;
  readonly factors: readonly RiskFactor[];
}

export function assessImpact(evidence: NormalizedEvidence): ImpactAssessment {
  const downstreamCount = evidence.downstreamAssets.length;
  const columnCount = evidence.columnAffectedAssets.length;
  const maxHop = Math.max(0, ...evidence.downstreamAssets.map(({ hop }) => hop));
  const factors: RiskFactor[] = [
    {
      name: "renameSeverity",
      points: 25,
      explanation: "A column rename is a breaking schema change.",
    },
    {
      name: "downstreamAssets",
      points: Math.min(30, downstreamCount * 3),
      explanation: `${downstreamCount} downstream assets are visible.`,
    },
    {
      name: "lineageDepth",
      points: Math.min(15, maxHop * 5),
      explanation: `The deepest visible dependency is ${maxHop} hops away.`,
    },
    {
      name: "confirmedColumns",
      points: Math.min(20, columnCount * 4),
      explanation: `${columnCount} downstream assets have column-level evidence.`,
    },
    {
      name: "metadataGap",
      points:
        columnCount === downstreamCount && downstreamCount > 0 ? 0 : columnCount === 0 ? 10 : 5,
      explanation:
        columnCount === downstreamCount && downstreamCount > 0
          ? "All visible assets have column-level evidence."
          : "Some downstream column relationships remain unknown.",
    },
  ];
  const score = Math.min(
    100,
    factors.reduce((sum, factor) => sum + factor.points, 0),
  );
  const level: RiskLevel =
    score < 30 ? "low" : score < 60 ? "medium" : score < 80 ? "high" : "critical";
  const confidence: Confidence =
    columnCount === 0 ? "low" : columnCount === downstreamCount ? "high" : "medium";
  return { score, level, confidence, factors };
}
```

- [ ] **Step 4: Verify and commit deterministic impact scoring**

Run: `pnpm vitest run src/domain/impact-assessment.test.ts`

Expected: all exact-score and repeatability assertions pass.

```bash
git add src/domain/impact-assessment.ts src/domain/impact-assessment.test.ts
git commit -m "feat: add deterministic impact scoring"
```

---

### Task 5: Redact Secrets and Enforce the Runs Directory Boundary

**Files:**

- Create: `src/security/redact.ts`
- Create: `src/security/redact.test.ts`
- Create: `src/artifacts/write-run-artifacts.ts`
- Create: `src/artifacts/write-run-artifacts.test.ts`

**Interfaces:**

- Consumes: Arbitrary trace values, known secret values, configured runs root, run ID, and filename.
- Produces: `redact(value, secrets)` and `writeRunArtifact(options)` that cannot leak secrets or escape the runs root.

- [ ] **Step 1: Write failing redaction tests**

```ts
it("removes secret keys and literal secret values recursively", () => {
  const secret = "dhp_example_secret_123";
  expect(
    redact(
      {
        authorization: `Bearer ${secret}`,
        nested: { password: "datahub", note: `token=${secret}` },
      },
      [secret, "datahub"],
    ),
  ).toEqual({
    authorization: "[REDACTED]",
    nested: { password: "[REDACTED]", note: "token=[REDACTED]" },
  });
});
```

Test the key pattern against `token`, `password`, `secret`, `authorization`, `apiKey`, and `privateKey` in mixed casing.

- [ ] **Step 2: Run the redaction test to verify RED**

Run: `pnpm vitest run src/security/redact.test.ts`

Expected: FAIL because `redact` does not exist.

- [ ] **Step 3: Implement recursive redaction without mutating the input**

```ts
const secretKey = /(token|password|secret|authorization|api[_-]?key|private[_-]?key)/i;

export function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return secrets
      .filter((secret) => secret.length > 0)
      .reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKey.test(key) ? "[REDACTED]" : redact(item, secrets),
      ]),
    );
  }
  return value;
}
```

- [ ] **Step 4: Write failing output-path tests**

Use a fresh `mkdtemp` root for every case. Assert that `run-001/impact-report.md` is written, while these values are rejected with `ARTIFACT_WRITE_FAILED`:

```ts
const unsafe = ["../outside", "..\\outside", "C:\\outside", "/outside", "run-001/../../outside"];
```

- [ ] **Step 5: Implement safe artifact writing**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { AppError } from "../errors/app-error.js";

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
}): Promise<string> {
  const root = resolve(options.runsRoot);
  const output = resolve(root, options.runId, options.filename);
  const fromRoot = relative(root, output);
  if (
    isAbsolute(fromRoot) ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The artifact path escapes the runs directory.");
  }
  try {
    await mkdir(resolve(root, options.runId), { recursive: true });
    await writeFile(output, options.content, { encoding: "utf8", flag: "wx" });
    return output;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("ARTIFACT_WRITE_FAILED", `Unable to write ${output}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
```

Validate `runId` before this function with `/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/` so a user cannot choose a path segment.

- [ ] **Step 6: Verify and commit the security boundary**

Run: `pnpm vitest run src/security/redact.test.ts src/artifacts/write-run-artifacts.test.ts`

Expected: every representative secret is absent and every traversal attempt is rejected.

```bash
git add src/security/redact.ts src/security/redact.test.ts src/artifacts/write-run-artifacts.ts src/artifacts/write-run-artifacts.test.ts
git commit -m "feat: secure traces and run artifact paths"
```

---

### Task 6: Implement the Pinned DataHub MCP Adapter

**Files:**

- Create: `src/config/runtime-config.ts`
- Create: `src/config/runtime-config.test.ts`
- Create: `src/datahub/mcp/decode-tool-result.ts`
- Create: `src/datahub/mcp/decode-tool-result.test.ts`
- Create: `src/datahub/mcp/schemas.ts`
- Create: `src/datahub/mcp/mcp-client.ts`
- Create: `src/datahub/mcp/datahub-mcp-catalog.ts`
- Create: `src/datahub/mcp/datahub-mcp-catalog.test.ts`

**Interfaces:**

- Consumes: `DATAHUB_GMS_URL`, `DATAHUB_GMS_TOKEN`, optional `DATAHUB_MCP_UVX_PATH`, and MCP 0.6.0 tool results.
- Produces: A `DataHubCatalog` implementation that owns one stdio subprocess and exposes only normalized read methods.

- [ ] **Step 1: Write failing runtime-configuration tests**

Assert that URL and token are required, `uvx` and `runs` are defaults, and no parsed configuration object is printable with the raw token:

```ts
expect(() => loadRuntimeConfig({ DATAHUB_GMS_URL: "http://localhost:8080" })).toThrow();
expect(
  loadRuntimeConfig({
    DATAHUB_GMS_URL: "http://localhost:8080",
    DATAHUB_GMS_TOKEN: "local-test-token",
  }),
).toMatchObject({ uvxPath: "uvx", runsRoot: "runs", maxHops: 2 });
```

- [ ] **Step 2: Implement strict runtime configuration**

```ts
const environmentSchema = z.object({
  DATAHUB_GMS_URL: z.url(),
  DATAHUB_GMS_TOKEN: z.string().min(1),
  DATAHUB_MCP_UVX_PATH: z.string().min(1).default("uvx"),
  LINEAGEGUARD_RUNS_DIR: z.string().min(1).default("runs"),
});

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv) {
  const parsed = environmentSchema.parse(environment);
  return {
    datahubGmsUrl: parsed.DATAHUB_GMS_URL,
    datahubGmsToken: parsed.DATAHUB_GMS_TOKEN,
    uvxPath: parsed.DATAHUB_MCP_UVX_PATH,
    runsRoot: parsed.LINEAGEGUARD_RUNS_DIR,
    maxHops: 2 as const,
  };
}
```

- [ ] **Step 3: Write and implement MCP result decoding tests**

Test `structuredContent`, a single JSON text block, `isError: true`, and invalid non-JSON content. Implement this priority:

```ts
export function decodeJsonToolResult(result: CallToolResult): unknown {
  if (result.isError) throw new Error("DataHub MCP tool returned an error result.");
  if (result.structuredContent) return result.structuredContent;
  const text = result.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  if (!text) throw new Error("DataHub MCP tool returned no JSON content.");
  return JSON.parse(text) as unknown;
}
```

- [ ] **Step 4: Define permissive-at-the-edge, strict-at-the-core Zod schemas**

```ts
export const searchResponseSchema = z
  .object({
    searchResults: z
      .array(
        z
          .object({
            entity: z
              .object({
                urn: z.string().startsWith("urn:li:"),
                name: z.string().optional(),
                type: z.string().optional(),
                platform: z.object({ name: z.string().optional() }).passthrough().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export const schemaResponseSchema = z
  .object({
    urn: z.string(),
    fields: z.array(
      z
        .object({
          fieldPath: z.string(),
          nativeDataType: z.string().optional(),
          nullable: z.boolean().optional(),
          description: z.string().optional(),
        })
        .passthrough(),
    ),
    totalFields: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    remainingCount: z.number().int().nonnegative(),
  })
  .passthrough();

const lineageResultSchema = z
  .object({
    entity: z
      .object({
        urn: z.string(),
        name: z.string().optional(),
        platform: z.object({ name: z.string().optional() }).passthrough().optional(),
      })
      .passthrough(),
    degree: z.number().int().nonnegative(),
    lineageColumns: z.array(z.string()).default([]),
  })
  .passthrough();

export const lineageResponseSchema = z
  .object({
    downstreams: z
      .object({ searchResults: z.array(lineageResultSchema).default([]) })
      .passthrough()
      .optional(),
  })
  .passthrough();
```

- [ ] **Step 5: Launch and close the pinned subprocess**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectDataHubMcp(config: RuntimeConfig): Promise<Client> {
  const client = new Client({ name: "lineageguard-ai", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: config.uvxPath,
    args: ["mcp-server-datahub@0.6.0", "--transport", "stdio"],
    env: {
      DATAHUB_GMS_URL: config.datahubGmsUrl,
      DATAHUB_GMS_TOKEN: config.datahubGmsToken,
      TOOLS_IS_MUTATION_ENABLED: "false",
      DATAHUB_MCP_DOCUMENT_TOOLS_DISABLED: "true",
      SAVE_DOCUMENT_TOOL_ENABLED: "false",
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  return client;
}
```

Attach a bounded, redacted stderr collector before `connect`, translate spawn/handshake failures to `MCP_UNAVAILABLE`, translate GMS connectivity failures to `DATAHUB_UNAVAILABLE`, and always call `await client.close()` in `DataHubMcpCatalog.close()`.

- [ ] **Step 6: Write failing adapter tests against a fake MCP client**

The fake must record calls and return fixture-shaped objects. Assert this exact sequence and arguments:

```ts
expect(calls).toEqual([
  {
    name: "search",
    arguments: {
      query: "/q b2fd91+order_entry_db+analytics+order_details",
      filter: "entity_type = dataset",
      num_results: 50,
      offset: 0,
    },
  },
  {
    name: "list_schema_fields",
    arguments: { urn: DATASET_URN, limit: 100, offset: 0 },
  },
  {
    name: "get_lineage",
    arguments: {
      urn: DATASET_URN,
      column: null,
      upstream: false,
      max_hops: 2,
      max_results: 100,
      offset: 0,
    },
  },
  {
    name: "get_lineage",
    arguments: {
      urn: DATASET_URN,
      column: "customer_id",
      upstream: false,
      max_hops: 2,
      max_results: 100,
      offset: 0,
    },
  },
]);
```

Also assert that trace call IDs are `mcp-001` through `mcp-004`, arguments are redacted, and raw response payloads are not stored in the trace.

- [ ] **Step 7: Implement the catalog adapter**

`searchDatasets` must convert non-alphanumeric runs in the dataset name to `+`, prefix `/q `, restrict `entity_type = dataset`, and preserve only URN, name, and platform. `listSchemaFields` must paginate until `remainingCount === 0`. `getDownstreamLineage` must call table and column modes independently, map `degree` to `hop`, and preserve `lineageColumns` only as evidence supplied by DataHub.

The adapter constructor receives a minimal client interface:

```ts
export interface McpToolClient {
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<CallToolResult>;
  close(): Promise<void>;
}
```

This makes all unit tests subprocess-free while the integration test uses the real SDK client.

- [ ] **Step 8: Verify and commit the MCP boundary**

Run: `pnpm vitest run src/config/runtime-config.test.ts src/datahub/mcp/*.test.ts`

Expected: configuration, decoding, tool arguments, trace order, pagination, and close behavior pass.

```bash
git add src/config src/datahub/mcp
git commit -m "feat: add the read-only DataHub MCP adapter"
```

---

### Task 7: Orchestrate Analysis and Render the Markdown Artifact

**Files:**

- Create: `src/app/run-impact-analysis.ts`
- Create: `src/app/run-impact-analysis.test.ts`
- Create: `src/artifacts/render-impact-report.ts`
- Create: `src/artifacts/render-impact-report.test.ts`

**Interfaces:**

- Consumes: Request string, `DataHubCatalog`, injected clock, injected run ID, and runs root.
- Produces: In-memory `AnalysisRun` plus `runs/<run-id>/impact-report.md` for successful and metadata-limited runs.

- [ ] **Step 1: Write failing orchestration tests**

Use an in-memory fake catalog and injected `runId = "20260722T120000Z-0123abcd"`. Cover:

- healthy schema plus downstream table and column lineage -> `COMPLETED`;
- table lineage with no column lineage -> `COMPLETED_WITH_LIMITATIONS`;
- no downstream lineage -> `INSUFFICIENT_METADATA`;
- ambiguous candidates -> no impact assessment and no artifact write;
- missing source column -> no lineage calls;
- catalog close executes once on success and once on failure.

The healthy call order must be:

```ts
expect(fakeCatalog.operations).toEqual([
  "searchDatasets",
  "listSchemaFields",
  "getDownstreamLineage:table",
  "getDownstreamLineage:customer_id",
  "close",
]);
```

- [ ] **Step 2: Run orchestration tests to verify RED**

Run: `pnpm vitest run src/app/run-impact-analysis.test.ts`

Expected: FAIL because the application service does not exist.

- [ ] **Step 3: Implement the explicit application flow**

```ts
export async function runImpactAnalysis(deps: RunImpactAnalysisDependencies): Promise<AnalysisRun> {
  const intent = parseChangeIntent(deps.request);
  try {
    const candidates = await deps.catalog.searchDatasets(intent.datasetHint);
    const target = resolveDataset(intent, candidates);
    const fields = await deps.catalog.listSchemaFields(target.urn);
    const sourceColumn = requireSourceColumn(fields, intent.sourceColumn);
    const tableLineage = await deps.catalog.getDownstreamLineage(target.urn, {
      maxHops: 2,
    });
    const columnLineage = await deps.catalog.getDownstreamLineage(target.urn, {
      column: sourceColumn.fieldPath,
      maxHops: 2,
    });
    const evidence = normalizeEvidence({
      target,
      fields,
      sourceColumn,
      tableLineage,
      columnLineage,
      trace: deps.catalog.getTrace(),
    });
    const assessment = assessImpact(evidence);
    const status =
      evidence.downstreamAssets.length === 0
        ? "INSUFFICIENT_METADATA"
        : evidence.evidenceLevel === "column"
          ? "COMPLETED"
          : "COMPLETED_WITH_LIMITATIONS";
    const run = buildAnalysisRun({
      ...deps,
      intent,
      evidence,
      assessment,
      status,
    });
    const markdown = renderImpactReport(run);
    const artifactPath = await writeRunArtifact({
      runsRoot: deps.runsRoot,
      runId: run.runId,
      filename: "impact-report.md",
      content: markdown,
    });
    return { ...run, artifactPath };
  } finally {
    await deps.catalog.close();
  }
}
```

`buildAnalysisRun` must derive facts only from `NormalizedEvidence`. Its assumptions are fixed statements about the bounded two-hop inspection and exact-name resolution. Its unknowns are derived only from missing column lineage, empty lineage, truncated MCP pagination, or absent optional platform/environment metadata.

- [ ] **Step 4: Write failing Markdown renderer tests**

Snapshot one healthy and one table-only report. Both must contain these headings in this order:

```text
# LineageGuard AI Impact Report
## Request
## Resolved Change Intent
## Selected Dataset
## Evidence Summary
## Affected Downstream Assets
## Deterministic Impact Assessment
## Facts
## Assumptions
## Unknowns
## DataHub Tool Trace
## Final Status
```

Assert every fact URN exists in the normalized evidence fixture. Assert the table-only report includes: `Column-level impact is unknown; only table-level downstream lineage was returned.`

- [ ] **Step 5: Implement deterministic Markdown rendering**

Render arrays in their already-normalized order. Do not include wall-clock durations, raw payloads, environment values, or process stderr. Escape `|`, backticks, carriage returns, and newlines in table cells. End the document with exactly one newline.

Use the factor table shape:

```markdown
| Factor          | Points | Explanation                                  |
| --------------- | -----: | -------------------------------------------- |
| Rename severity |     25 | A column rename is a breaking schema change. |
```

- [ ] **Step 6: Verify determinism and commit the application flow**

Run: `pnpm vitest run src/app/run-impact-analysis.test.ts src/artifacts/render-impact-report.test.ts`

Expected: all flow, status, close, fact-grounding, limitation-copy, and snapshot assertions pass.

```bash
git add src/app src/artifacts/render-impact-report.ts src/artifacts/render-impact-report.test.ts
git commit -m "feat: orchestrate grounded impact reports"
```

---

### Task 8: Add the CLI and Actionable Failure Guidance

**Files:**

- Create: `src/cli.ts`
- Create: `src/cli.test.ts`

**Interfaces:**

- Consumes: `--request <text>`, optional `--runs-dir <path>`, and validated environment variables.
- Produces: Human-readable English terminal output and stable exit codes.

- [ ] **Step 1: Write failing CLI tests with injected dependencies**

Test `--help`, missing `--request`, a successful run, every specified failure status, and teardown after `SIGINT`. Capture stdout/stderr rather than spawning a real MCP process.

Use these exit codes:

| Exit code | Meaning                                                                             |
| --------: | ----------------------------------------------------------------------------------- |
|         0 | `COMPLETED`, `COMPLETED_WITH_LIMITATIONS`, or `INSUFFICIENT_METADATA` with a report |
|         2 | Invalid request, target resolution, or missing column                               |
|         3 | DataHub or MCP unavailable                                                          |
|         4 | Artifact writing failed                                                             |
|       130 | Interrupted by the user                                                             |

- [ ] **Step 2: Run CLI tests to verify RED**

Run: `pnpm vitest run src/cli.test.ts`

Expected: FAIL because the CLI entrypoint does not exist.

- [ ] **Step 3: Implement CLI argument handling with Node `parseArgs`**

```ts
const { values } = parseArgs({
  options: {
    request: { type: "string", short: "r" },
    "runs-dir": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});
```

Do not accept a run ID or output filename from the user. Generate the ID from UTC time plus four cryptographic random bytes:

```ts
export const createRunId = (now: Date): string =>
  `${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}-${randomBytes(4).toString("hex")}`;
```

- [ ] **Step 4: Implement exact recovery guidance**

Map failures to these messages without including secrets:

```ts
const guidance = {
  DATAHUB_UNAVAILABLE:
    "Verify Docker containers with `docker ps` and confirm http://localhost:8080/health responds.",
  MCP_UNAVAILABLE:
    "Verify `uvx mcp-server-datahub@0.6.0 --version` and the DATAHUB_GMS_URL configuration.",
  TARGET_NOT_FOUND: "Use a more specific platform-qualified dataset identifier.",
  NEEDS_USER_CLARIFICATION: "Choose one of the listed dataset URNs and retry with that exact URN.",
  COLUMN_NOT_FOUND: "Choose one of the actual schema fields listed above.",
  ARTIFACT_WRITE_FAILED:
    "Verify that the configured runs directory is writable and has no symbolic-link or junction ancestors.",
} as const;
```

- [ ] **Step 5: Verify, build, and commit the CLI**

Run: `pnpm vitest run src/cli.test.ts`

Expected: all output and exit-code assertions pass.

Run: `pnpm typecheck && pnpm build && node dist/cli.js --help`

Expected: typecheck/build exit 0 and help lists only `--request`, `--runs-dir`, and `--help`.

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: expose the impact analysis CLI"
```

---

### Task 9: Align DataHub, Capture Sanitized Fixtures, and Prove the Live Scenario

**Files:**

- Modify: `.gitignore`
- Create: `scripts/capture-datahub-fixtures.ts`
- Create: `tests/fixtures/datahub/search-order-details.json`
- Create: `tests/fixtures/datahub/schema-order-details.json`
- Create: `tests/fixtures/datahub/lineage-order-details-table.json`
- Create: `tests/fixtures/datahub/lineage-order-details-customer-id.json`
- Create: `tests/integration/datahub-mcp.integration.test.ts`
- Create: `docs/demo-scenario.md`

**Interfaces:**

- Consumes: Local DataHub Core v1.6.0 loaded with the official `showcase-ecommerce` datapack and the real MCP 0.6.0 subprocess.
- Produces: One live integration proof plus sanitized official-sample fixtures for deterministic offline tests.

- [ ] **Step 1: Stop at the environment replacement checkpoint**

The current environment is mismatched: the CLI is 1.6.0.15 on Python 3.12.13, while the running containers are v1.5.0.6. Before replacing `.venv` or changing containers, record `docker ps`, run `datahub docker quickstart --backup`, resolve the `.venv` path, and obtain explicit user approval for deleting only that workspace-local virtual environment if it still exists.

- [ ] **Step 2: Recreate the supported Python and DataHub environment**

Run these PowerShell commands after the checkpoint:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip wheel setuptools
.\.venv\Scripts\python.exe -m pip install acryl-datahub==1.6.0.15
.\.venv\Scripts\datahub.exe version
.\.venv\Scripts\datahub.exe docker quickstart --stop
.\.venv\Scripts\datahub.exe docker quickstart --version v1.6.0 --pull-images
```

Expected: Python reports 3.11.x, CLI reports 1.6.0.15, and DataHub containers use v1.6.0 images and become healthy.

- [ ] **Step 3: Configure local authentication and load the official datapack**

```powershell
.\.venv\Scripts\datahub.exe init --username datahub --password datahub
.\.venv\Scripts\datahub.exe datapack load showcase-ecommerce
Invoke-RestMethod http://localhost:8080/health
```

Expected: datapack load completes, GMS health responds, and no authentication material is written beneath the repository.

- [ ] **Step 4: Write the live integration test**

The test must skip only when `DATAHUB_GMS_TOKEN` is absent. Otherwise it must connect to the real MCP subprocess and assert:

```ts
expect(candidates).toContainEqual(expect.objectContaining({ urn: DATASET_URN }));
expect(fields).toContainEqual(
  expect.objectContaining({
    fieldPath: "customer_id",
    nativeDataType: "NUMBER(38,0)",
  }),
);
expect(tableLineage.length).toBeGreaterThan(0);
expect(columnLineage).toContainEqual(
  expect.objectContaining({
    lineageColumns: expect.arrayContaining(["customer_id"]),
  }),
);
expect(catalog.getTrace().map(({ tool }) => tool)).toEqual([
  "search",
  "list_schema_fields",
  "get_lineage",
  "get_lineage",
]);
```

- [ ] **Step 5: Implement sanitized fixture capture**

The capture script must call the same adapter methods, pass each normalized response through `redact`, reject any serialized output containing the configured token, and write only the four named files. It must never persist raw MCP content or stderr.

```ts
const serialized = `${JSON.stringify(redact(payload, [config.datahubGmsToken]), null, 2)}\n`;
if (serialized.includes(config.datahubGmsToken)) {
  throw new Error("Fixture capture refused to write an unredacted token.");
}
await writeFile(destination, serialized, "utf8");
```

- [ ] **Step 6: Record the fixed demo scenario**

`docs/demo-scenario.md` must document the datapack name, DataHub versions, selected URN, source field/type, request text, two-hop bound, observed downstream count, observed column mappings, the official datapack source URL, and the exact reproduction command. Clearly state that the counts are verified fixture facts for the pinned datapack version and may change if the datapack changes.

- [ ] **Step 7: Run the integration proof and capture fixtures**

Run: `pnpm test:integration`

Expected: search, schema retrieval, table lineage, column lineage, and subprocess close all pass against local DataHub.

Run: `pnpm tsx scripts/capture-datahub-fixtures.ts`

Expected: exactly four formatted JSON files are written and a secret scan returns no matches.

Run: `rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' '(DATAHUB_GMS_TOKEN=.+|Bearer [A-Za-z0-9._-]{12,}|dhp_[A-Za-z0-9_-]+)' .`

Expected: no secret values are reported.

- [ ] **Step 8: Commit the verified integration assets**

```bash
git add .gitignore scripts/capture-datahub-fixtures.ts tests/fixtures/datahub tests/integration/datahub-mcp.integration.test.ts docs/demo-scenario.md
git commit -m "test: prove the pinned DataHub integration"
```

---

### Task 10: Generate the Example, Document Reproduction, and Run the Completion Gate

**Files:**

- Modify: `README.md`
- Create: `examples/001-customer-id-rename/impact-report.md`

**Interfaces:**

- Consumes: The fully verified CLI, pinned local DataHub, and sanitized fixtures.
- Produces: A clean-checkout setup path, a deterministic demo command, and a committed grounded example report.

- [ ] **Step 1: Write the English setup and demo guide**

The README must include:

- the problem and slice scope;
- architecture and read-only DataHub use;
- Windows prerequisites and exact pinned versions;
- Python 3.11/DataHub setup commands;
- local token handling through environment variables;
- `pnpm install --frozen-lockfile`;
- `pnpm demo`;
- expected output path and statuses;
- all verification commands;
- known limitation that only constrained `rename_column` requests are supported;
- explicit statement that no LLM, mutation tool, SQL generation, UI, or GitHub automation is present in this slice.

- [ ] **Step 2: Generate the live example**

Run: `pnpm demo`

Expected: the CLI selects the pinned Snowflake URN, verifies `customer_id`, retrieves non-empty two-hop downstream lineage, reports column-level evidence, and writes `runs/<run-id>/impact-report.md`.

Copy the verified report to `examples/001-customer-id-rename/impact-report.md` only after checking every fact against the normalized evidence. Replace only run ID and timestamp with stable example values; do not edit asset facts, score factors, status, assumptions, or unknowns.

- [ ] **Step 3: Run the complete offline gate**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: each command exits 0 with zero test failures.

- [ ] **Step 4: Run the complete live gate**

```powershell
pnpm test:integration
pnpm demo
```

Expected: integration and demo both exit 0; a new report exists beneath `runs/`; no mutation or document tool appears in the recorded trace.

- [ ] **Step 5: Verify acceptance criteria directly**

Run each targeted test once more and record the result in the implementation handoff:

| Acceptance criterion | Verification                                   |
| -------------------- | ---------------------------------------------- |
| AC-001               | live integration plus `pnpm demo`              |
| AC-002               | renderer fact-grounding test                   |
| AC-003               | ambiguous resolution unit test                 |
| AC-004               | missing-column orchestration unit test         |
| AC-005               | no-lineage orchestration and renderer test     |
| AC-006               | table-only renderer test                       |
| AC-007               | repeated-fixture deep-equality test            |
| AC-008               | recursive redaction and repository secret scan |
| AC-009               | traversal and absolute-path unit tests         |
| AC-010               | clean-checkout README rehearsal                |

- [ ] **Step 6: Commit the documented vertical slice**

```bash
git add README.md examples/001-customer-id-rename/impact-report.md
git commit -m "docs: document the repeatable DataHub impact demo"
```

---

## Specification Traceability

| Requirement                             | Implemented by                               |
| --------------------------------------- | -------------------------------------------- |
| FR-001 Request Parsing                  | Task 2                                       |
| FR-002 Dataset Search                   | Task 6                                       |
| FR-003 Unambiguous Resolution           | Task 2, Task 7                               |
| FR-004 Schema Retrieval                 | Task 6, Task 9                               |
| FR-005 Column Validation                | Task 3, Task 7                               |
| FR-006 Downstream Lineage Retrieval     | Task 6, Task 9                               |
| FR-007 Lineage Evidence Level           | Task 3, Task 6, Task 7                       |
| FR-008 Evidence Normalization           | Task 3                                       |
| FR-009 Deterministic Impact Assessment  | Task 4                                       |
| FR-010 Facts, Assumptions, and Unknowns | Task 7                                       |
| FR-011 Markdown Artifact                | Task 5, Task 7                               |
| FR-012 Sanitized Trace                  | Task 5, Task 6                               |
| FR-013 Read-Only Operation              | Task 6, Task 9                               |
| FR-014 Safe Output Boundary             | Task 5                                       |
| Failure and recovery requirements       | Task 7, Task 8                               |
| AC-001 through AC-010                   | Tasks 2 through 10; direct matrix in Task 10 |
| Required CLI deliverable                | Task 8                                       |
| Selected official sample scenario       | Task 9                                       |
| Sanitized deterministic fixtures        | Task 9                                       |
| Generated example report                | Task 10                                      |
| English setup and demo instructions     | Task 10                                      |

## Plan Self-Review

- **Spec coverage:** Every functional requirement, failure status, acceptance criterion, and required deliverable maps to at least one task above.
- **Scope control:** The plan contains no Next.js, LLM, SQL generation, mutation, write-back, deployment, or GitHub automation work.
- **Type consistency:** `ChangeIntent`, `DatasetCandidate`, `SchemaField`, `LineageAsset`, `ToolTraceEntry`, `NormalizedEvidence`, `ImpactAssessment`, `DataHubCatalog`, and `AnalysisRun` flow in one direction from adapter to domain to artifact.
- **Determinism:** Clock, run ID, filesystem, and MCP client are injected; normalized arrays are sorted; volatile duration data is excluded from artifacts.
- **Safety:** Secrets are redacted at the boundary, raw MCP payloads are not persisted, mutation/document tools are disabled, and output paths are resolved beneath the runs root.
- **Environment risk:** Implementation pauses before replacing the mismatched Python environment or changing the running DataHub version.

## Approval Gate

No application code may be written until this `plan.md` is approved. After approval, choose one execution mode:

1. **Subagent-driven:** execute one task at a time with a fresh worker and review between tasks.
2. **Inline execution:** use `superpowers:executing-plans` in this session with checkpoints after each task.
