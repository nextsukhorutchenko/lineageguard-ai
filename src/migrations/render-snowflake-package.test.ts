import { describe, expect, it } from "vitest";
import {
  makeChangeContext,
  makeImpactReportDraft,
  makeMigrationDraft,
} from "../../tests/helpers/factories.js";
import { markdownCodeSpan } from "../security/markdown-output.js";
import { buildChangeContext, type ChangeContext } from "../workflow/change-context.js";
import type { MigrationPackageDraft } from "../workflow/migration-draft.js";
import { renderMigrationPackage } from "./render-snowflake-package.js";

function countHeading(markdown: string, heading: string): number {
  return markdown.split("\n").filter((line) => line === heading).length;
}

function stripWellFormedCodeSpans(markdown: string): string {
  let outside = "";
  let index = 0;
  while (index < markdown.length) {
    if (markdown[index] !== "`") {
      outside += markdown[index];
      index += 1;
      continue;
    }

    let fenceLength = 1;
    while (markdown[index + fenceLength] === "`") fenceLength += 1;
    let cursor = index + fenceLength;
    let closed = false;
    while (cursor < markdown.length) {
      if (markdown[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let runLength = 1;
      while (markdown[cursor + runLength] === "`") runLength += 1;
      if (runLength > fenceLength) throw new Error("Undersized code-span fence.");
      if (runLength === fenceLength) {
        index = cursor + runLength;
        closed = true;
        break;
      }
      cursor += runLength;
    }
    if (!closed) throw new Error("Unclosed code span.");
  }
  return outside;
}

function directDraft(context: ChangeContext): MigrationPackageDraft {
  return {
    ...makeMigrationDraft(context),
    strategy: "DIRECT_RENAME",
    executionClassification: "EXECUTABLE_WITH_REVIEW",
    rationale: "LOW_RISK_CONFIRMED_RENAME",
    stages: ["PREPARE", "DIRECT_RENAME", "VALIDATE"],
    rollback: "RENAME_TARGET_BACK_TO_SOURCE",
    warnings: [],
  };
}

type RenderMode = "template" | "direct" | "staged";

const renderModes = [
  { label: "template", mode: "template" },
  { label: "direct", mode: "direct" },
  { label: "staged", mode: "staged" },
] as const satisfies readonly { readonly label: string; readonly mode: RenderMode }[];

function ownershipContext(
  mode: RenderMode,
  downstreamUrn: string,
  owners: readonly string[] | undefined,
): ChangeContext {
  const datasetName =
    mode === "template"
      ? "b2fd91.order_entry_db.analytics.order_details"
      : "ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS";
  const report = makeImpactReportDraft({
    datasetName,
    score: mode === "direct" ? 20 : 90,
  });
  const downstream = {
    urn: downstreamUrn,
    name: "review target",
    platform: "dbt",
    hop: 1,
    lineageColumns: ["customer_id"],
  } as const;
  const entityContext =
    owners === undefined
      ? []
      : [
          {
            urn: downstreamUrn,
            entityType: "dataset",
            owners: [...owners],
            tags: [],
            glossaryTerms: [],
            siblingUrns: [],
            qualitySignals: [],
          },
        ];
  const inspectedAssets = entityContext.length;
  const withOwners = owners !== undefined && owners.length > 0 ? 1 : 0;
  return buildChangeContext(
    {
      ...report,
      evidence: {
        ...report.evidence,
        downstreamAssets: [downstream],
        columnAffectedAssets: [downstream],
        unmatchedColumnAssets: [],
        entityContextRetrieval: {
          complete: false,
          pages: 1,
          itemCount: inspectedAssets,
          offsets: [0],
          reasonCodes: ["ENTITY_CONTEXT_UNAVAILABLE"],
        },
        entityContext,
        contextCoverage: {
          retrievalComplete: false,
          relevantAssets: 2,
          inspectedAssets,
          retrievalPercentage: inspectedAssets === 0 ? 0 : 50,
          possibleSignals: inspectedAssets * 3,
          coveredSignals: withOwners,
          percentage: inspectedAssets === 0 ? null : Math.round((withOwners / 3) * 100),
          withDescriptions: 0,
          withOwners,
          withGovernance: 0,
          missingMetadataUrns: owners !== undefined && owners.length === 0 ? [downstreamUrn] : [],
          unknownMetadataUrns:
            inspectedAssets === 0
              ? [report.evidence.targetDataset.urn, downstreamUrn]
              : [report.evidence.targetDataset.urn],
        },
      },
    },
    [],
  );
}

function renderMode(context: ChangeContext, mode: RenderMode): string {
  const draft = mode === "direct" ? directDraft(context) : makeMigrationDraft(context);
  return renderMigrationPackage(context, draft).files["rollout-plan.md"];
}

function reviewerGates(markdown: string): string {
  return markdown.split("## Reviewer Gates\n\n")[1]?.split("\n\n1.")[0] ?? "";
}

function textAttackContext(datasetName: string, score: number): ChangeContext {
  const report = makeImpactReportDraft({ datasetName, score });
  const source = "customer`id``|[source](https://example.test)<script>\nΩ";
  const target = "customer```key|[target](https://example.test)<b>\u001b雪";
  const sourceField = { fieldPath: source, nativeDataType: "NUMBER(38,0)" };
  return buildChangeContext(
    {
      ...report,
      intent: {
        ...report.intent,
        sourceColumn: source,
        targetColumn: target,
      },
      evidence: {
        ...report.evidence,
        schemaFields: [sourceField, report.evidence.schemaFields[1]!],
        sourceColumn: sourceField,
      },
    },
    [],
  );
}

it("renders the golden four-part DataHub name as a non-executable staged template", () => {
  const context = makeChangeContext();
  const result = renderMigrationPackage(context, makeMigrationDraft(context));
  expect(result.classification).toBe("NON_EXECUTABLE_TEMPLATE");
  expect(Object.keys(result.files).sort()).toEqual([
    "migration-down.sql",
    "migration-up.sql",
    "rollout-plan.md",
    "validation.sql",
  ]);
  expect(result.files["migration-up.sql"]).toContain("NON-EXECUTABLE TEMPLATE");
  expect(result.files["migration-up.sql"]).toContain(
    "b2fd91.order_entry_db.analytics.order_details",
  );
  expect(result.files["migration-up.sql"]).not.toMatch(/^\s*ALTER\s/im);
  expect(result.files["rollout-plan.md"]).toContain("## PR Review Summary");
  expect(result.files["rollout-plan.md"]).toContain("## Reviewer Gates");
  expect(result.files["rollout-plan.md"]).toContain("DataHub decision: BLOCK_DIRECT_RENAME");
});

it("renders a confirmed low-risk three-part Snowflake object from deterministic templates", () => {
  const context = makeChangeContext({
    datasetName: "ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS",
    score: 20,
  });
  const result = renderMigrationPackage(context, makeMigrationDraft(context));
  expect(result.classification).toBe("EXECUTABLE_WITH_REVIEW");
  expect(result.files["migration-up.sql"]).toContain(
    'ALTER TABLE "ORDER_ENTRY_DB"."ANALYTICS"."ORDER_DETAILS"',
  );
  expect(result.files["migration-up.sql"]).toContain('"customer_key" NUMBER(38,0)');
});

it("preserves a high-risk staged package as advisory SQL", () => {
  const context = makeChangeContext({
    datasetName: "ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS",
    score: 90,
  });
  const result = renderMigrationPackage(context, makeMigrationDraft(context));
  expect(result.classification).toBe("ADVISORY_ONLY");
  expect(result.files["migration-up.sql"]).toContain("ADVISORY ONLY — HUMAN APPROVAL REQUIRED");
  expect(result.files["migration-up.sql"]).toMatch(/ALTER TABLE/u);
  expect(result.files["migration-up.sql"]).not.toMatch(/RENAME COLUMN/u);
});

it("fails closed if an unparsed non-executable strategy reaches the renderer", () => {
  const context = makeChangeContext({ datasetName: "DB.PUBLIC.T", score: 10 });
  const invalid = {
    ...makeMigrationDraft(context),
    strategy: "NON_EXECUTABLE_TEMPLATE" as const,
    executionClassification: "EXECUTABLE_WITH_REVIEW" as const,
  };
  const result = renderMigrationPackage(context, invalid);
  expect(result.classification).toBe("NON_EXECUTABLE_TEMPLATE");
  expect(result.files["migration-up.sql"]).not.toMatch(/^\s*ALTER\s/imu);
});

describe("ownership-grounded reviewer gates", () => {
  const downstreamUrn = "urn:li:dataset:(urn:li:dataPlatform:dbt,review[`asset`]|<Ω>,PROD)";

  it.each(renderModes)(
    "lists only normalized verified owner URNs for $label output",
    ({ mode }) => {
      const owners = ["urn:li:corpGroup:team|[reviewers]", "urn:li:corpuser:Jose\u0301`<owner>"];
      const context = ownershipContext(mode, downstreamUrn, owners);
      const rollout = renderMode(context, mode);
      const gates = reviewerGates(rollout);
      const normalizedOwners = [...context.entityContext[0]!.owners].sort((left, right) =>
        left.localeCompare(right, "en"),
      );
      const expectedLine = `- [ ] Record approval for downstream asset ${markdownCodeSpan(
        context.entityContext[0]!.urn,
      )} from verified owner URNs: ${normalizedOwners.map(markdownCodeSpan).join(", ")}.`;

      expect(gates).toBe(expectedLine);
      expect(gates).not.toContain("invented");
      expect(countHeading(rollout, "## PR Review Summary")).toBe(1);
      expect(countHeading(rollout, "## Reviewer Gates")).toBe(1);
    },
  );

  it.each(renderModes)(
    "states that DataHub returned no owner for inspected $label output",
    ({ mode }) => {
      const context = ownershipContext(mode, downstreamUrn, []);
      const rollout = renderMode(context, mode);
      const gates = reviewerGates(rollout);

      expect(gates).toBe(
        `- [ ] Assign or confirm an owner for inspected downstream asset ${markdownCodeSpan(
          downstreamUrn,
        )}; DataHub returned no owner.`,
      );
      expect(gates).not.toMatch(/corpuser|corpGroup/u);
      expect(countHeading(rollout, "## PR Review Summary")).toBe(1);
      expect(countHeading(rollout, "## Reviewer Gates")).toBe(1);
    },
  );

  it.each(renderModes)(
    "states that ownership is unknown for uninspected $label output",
    ({ mode }) => {
      const context = ownershipContext(mode, downstreamUrn, undefined);
      expect(context.contextCoverage.unknownMetadataUrns).toContain(downstreamUrn);
      const rollout = renderMode(context, mode);
      const gates = reviewerGates(rollout);

      expect(gates).toBe(
        `- [ ] Resolve ownership for uninspected downstream asset ${markdownCodeSpan(
          downstreamUrn,
        )}; ownership is unknown because entity context was not retrieved.`,
      );
      expect(gates).not.toMatch(/corpuser|corpGroup/u);
      expect(countHeading(rollout, "## PR Review Summary")).toBe(1);
      expect(countHeading(rollout, "## Reviewer Gates")).toBe(1);
    },
  );
});

it.each([
  {
    label: "template",
    context: textAttackContext(
      "b2fd91.order_entry_db.analytics.<script>|[`orders`](https://example.test)雪",
      90,
    ),
    expectedClassification: "NON_EXECUTABLE_TEMPLATE",
  },
  {
    label: "staged",
    context: textAttackContext("ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS", 90),
    expectedClassification: "ADVISORY_ONLY",
  },
] as const)(
  "keeps destination-sensitive metadata inside code spans in $label Markdown",
  ({ context, expectedClassification }) => {
    const result = renderMigrationPackage(context, makeMigrationDraft(context));
    const rollout = result.files["rollout-plan.md"];

    expect(result.classification).toBe(expectedClassification);
    expect(stripWellFormedCodeSpans(rollout)).not.toContain("<");
    for (const { id } of context.evidence) expect(rollout).toContain(id);
    expect(countHeading(rollout, "## PR Review Summary")).toBe(1);
    expect(countHeading(rollout, "## Reviewer Gates")).toBe(1);
    const evidenceLine = `-- Evidence: ${context.evidence.map(({ id }) => id).join(", ")}`;
    for (const filename of ["migration-up.sql", "migration-down.sql", "validation.sql"] as const) {
      const sql = result.files[filename];
      expect(sql).not.toContain("\r");
      expect(sql).not.toContain("\u001b");
      expect(sql.split("\n")).toContain(evidenceLine);
    }
  },
);
