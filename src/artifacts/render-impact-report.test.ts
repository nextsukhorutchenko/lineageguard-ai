import { describe, expect, it } from "vitest";
import type { AnalysisRun } from "../app/run-impact-analysis.js";
import type { NormalizedEvidence } from "../domain/evidence.js";
import type { ImpactAssessment } from "../domain/impact-assessment.js";
import { renderImpactReport } from "./render-impact-report.js";

const TARGET_URN = "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)";
const DOWNSTREAM_URN = "urn:li:dataset:(urn:li:dataPlatform:snowflake,customer_orders,PROD)";

const columnEvidence: NormalizedEvidence = {
  targetDataset: { urn: TARGET_URN, name: "orders|daily", platform: "snow`flake" },
  schemaFields: [{ fieldPath: "customer_id", nativeDataType: "NUMBER\r\n(38,0)", nullable: false }],
  sourceColumn: {
    fieldPath: "customer_id",
    nativeDataType: "NUMBER\r\n(38,0)",
    nullable: false,
  },
  downstreamAssets: [
    {
      urn: DOWNSTREAM_URN,
      name: "customer|orders",
      platform: "snow`flake",
      hop: 1,
      lineageColumns: [],
    },
  ],
  columnAffectedAssets: [
    {
      urn: DOWNSTREAM_URN,
      name: "customer|orders",
      platform: "snow`flake",
      hop: 1,
      lineageColumns: ["customer_id"],
    },
  ],
  evidenceLevel: "column",
  metadataGaps: [],
  trace: [
    {
      callId: "mcp-001",
      tool: "search",
      arguments: { offset: 0, query: "/q orders|daily" },
      status: "ok",
    },
  ],
};

const assessment: ImpactAssessment = {
  score: 38,
  level: "medium",
  confidence: "high",
  factors: [
    {
      name: "renameSeverity",
      points: 25,
      explanation: "A column rename is a breaking schema change.",
    },
    {
      name: "downstreamAssets",
      points: 3,
      explanation: "1 downstream assets are visible.",
    },
  ],
};

function createRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    runId: "20260722T120000Z-0123abcd",
    createdAt: "2026-07-22T12:00:00.000Z",
    request: "Rename column customer_id to customer_key in dataset snowflake:orders|daily",
    intent: {
      kind: "rename_column",
      datasetHint: "snowflake:orders|daily",
      sourceColumn: "customer_id",
      targetColumn: "customer_key",
    },
    evidence: columnEvidence,
    assessment,
    facts: [
      `Selected dataset ${TARGET_URN} was returned by DataHub.`,
      `Downstream asset ${DOWNSTREAM_URN} was returned at hop 1.`,
    ],
    assumptions: [
      "Dataset resolution required one exact URN, name, or platform-qualified name match.",
      "Downstream lineage inspection was bounded to two hops.",
    ],
    unknowns: ["Selected dataset environment metadata was not available."],
    status: "COMPLETED",
    artifactPath: "runs/20260722T120000Z-0123abcd/impact-report.md",
    ...overrides,
  };
}

const expectedHeadings = [
  "# LineageGuard AI Impact Report",
  "## Request",
  "## Resolved Change Intent",
  "## Selected Dataset",
  "## Evidence Summary",
  "## Affected Downstream Assets",
  "## Deterministic Impact Assessment",
  "## Facts",
  "## Assumptions",
  "## Unknowns",
  "## DataHub Tool Trace",
  "## Final Status",
] as const;

describe("renderImpactReport", () => {
  it("renders a deterministic grounded column-level report", () => {
    const run = createRun();

    const first = renderImpactReport(run);
    const second = renderImpactReport(run);

    expect(second).toBe(first);
    const headingPositions = expectedHeadings.map((heading) => first.indexOf(heading));
    expect(headingPositions.every((position) => position >= 0)).toBe(true);
    for (let index = 1; index < expectedHeadings.length; index += 1) {
      expect(first.indexOf(expectedHeadings[index]!)).toBeGreaterThan(
        first.indexOf(expectedHeadings[index - 1]!),
      );
    }
    expect(first).toContain(
      "| Factor            | Points | Explanation                                  |\n" +
        "| ----------------- | -----: | -------------------------------------------- |\n" +
        "| Rename severity   |     25 | A column rename is a breaking schema change. |",
    );
    expect(first).toContain("orders\\|daily");
    expect(first).toContain("snow\\`flake");
    expect(first).toContain("NUMBER\\r\\n(38,0)");
    expect(first).toContain('{"offset":0,"query":"/q orders\\|daily"}');
    expect(first.endsWith("\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
    expect(first).not.toContain("raw payload");
    expect(first).not.toContain("process.stderr");
    expect(first).not.toContain("DATAHUB_GMS_TOKEN");

    const evidenceUrns = new Set([
      run.evidence.targetDataset.urn,
      ...run.evidence.downstreamAssets.map(({ urn }) => urn),
      ...run.evidence.columnAffectedAssets.map(({ urn }) => urn),
    ]);
    const factSection = first.split("## Facts\n\n")[1]!.split("\n\n## Assumptions")[0]!;
    const factUrns = factSection.match(/urn:li:dataset:\([^\s]+\)/g) ?? [];
    expect(factUrns.every((urn) => evidenceUrns.has(urn))).toBe(true);
    expect(first).toMatchInlineSnapshot(`
      "# LineageGuard AI Impact Report

      ## Request

      | Run ID | Created at | Original request |
      | --- | --- | --- |
      | 20260722T120000Z-0123abcd | 2026-07-22T12:00:00.000Z | Rename column customer_id to customer_key in dataset snowflake:orders\\|daily |

      ## Resolved Change Intent

      | Change | Dataset hint | Source column | Target column |
      | --- | --- | --- | --- |
      | Rename column | snowflake:orders\\|daily | customer_id | customer_key |

      ## Selected Dataset

      | URN | Name | Platform | Source column | Native type | Nullable |
      | --- | --- | --- | --- | --- | --- |
      | urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD) | orders\\|daily | snow\\\`flake | customer_id | NUMBER\\r\\n(38,0) | No |

      ## Evidence Summary

      | Evidence level | Downstream assets | Column-affected assets | Inspection bound |
      | --- | --- | --- | --- |
      | column | 1 | 1 | 2 hops |

      ## Affected Downstream Assets

      | URN | Name | Platform | Hop | Evidence |
      | --- | --- | --- | --- | --- |
      | urn:li:dataset:(urn:li:dataPlatform:snowflake,customer_orders,PROD) | customer\\|orders | snow\\\`flake | 1 | Column |

      ## Deterministic Impact Assessment

      | Score | Risk level | Confidence |
      | --- | --- | --- |
      | 38 | medium | high |

      | Factor            | Points | Explanation                                  |
      | ----------------- | -----: | -------------------------------------------- |
      | Rename severity   |     25 | A column rename is a breaking schema change. |
      | Downstream assets |      3 | 1 downstream assets are visible.             |

      ## Facts

      - Selected dataset urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD) was returned by DataHub.
      - Downstream asset urn:li:dataset:(urn:li:dataPlatform:snowflake,customer_orders,PROD) was returned at hop 1.

      ## Assumptions

      - Dataset resolution required one exact URN, name, or platform-qualified name match.
      - Downstream lineage inspection was bounded to two hops.

      ## Unknowns

      - Selected dataset environment metadata was not available.

      ## DataHub Tool Trace

      | Call ID | Tool | Status | Arguments |
      | --- | --- | --- | --- |
      | mcp-001 | search | ok | {"offset":0,"query":"/q orders\\|daily"} |

      ## Final Status

      COMPLETED
      "
    `);
  });

  it("renders the required table-only limitation without claiming column impact", () => {
    const evidence: NormalizedEvidence = {
      ...columnEvidence,
      columnAffectedAssets: [],
      evidenceLevel: "table",
    };
    const report = renderImpactReport(
      createRun({
        evidence,
        assessment: { ...assessment, confidence: "low" },
        unknowns: [
          "Column-level impact is unknown; only table-level downstream lineage was returned.",
          "Selected dataset environment metadata was not available.",
        ],
        status: "COMPLETED_WITH_LIMITATIONS",
      }),
    );

    expect(report).toContain(
      "Column-level impact is unknown; only table-level downstream lineage was returned.",
    );
    expect(report).toContain("COMPLETED_WITH_LIMITATIONS");
    expect(report).toContain("| Table |");
    expect(report.endsWith("\n")).toBe(true);
    expect(report.endsWith("\n\n")).toBe(false);
    expect(report).toMatchInlineSnapshot(`
      "# LineageGuard AI Impact Report

      ## Request

      | Run ID | Created at | Original request |
      | --- | --- | --- |
      | 20260722T120000Z-0123abcd | 2026-07-22T12:00:00.000Z | Rename column customer_id to customer_key in dataset snowflake:orders\\|daily |

      ## Resolved Change Intent

      | Change | Dataset hint | Source column | Target column |
      | --- | --- | --- | --- |
      | Rename column | snowflake:orders\\|daily | customer_id | customer_key |

      ## Selected Dataset

      | URN | Name | Platform | Source column | Native type | Nullable |
      | --- | --- | --- | --- | --- | --- |
      | urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD) | orders\\|daily | snow\\\`flake | customer_id | NUMBER\\r\\n(38,0) | No |

      ## Evidence Summary

      | Evidence level | Downstream assets | Column-affected assets | Inspection bound |
      | --- | --- | --- | --- |
      | table | 1 | 0 | 2 hops |

      ## Affected Downstream Assets

      | URN | Name | Platform | Hop | Evidence |
      | --- | --- | --- | --- | --- |
      | urn:li:dataset:(urn:li:dataPlatform:snowflake,customer_orders,PROD) | customer\\|orders | snow\\\`flake | 1 | Table |

      ## Deterministic Impact Assessment

      | Score | Risk level | Confidence |
      | --- | --- | --- |
      | 38 | medium | low |

      | Factor            | Points | Explanation                                  |
      | ----------------- | -----: | -------------------------------------------- |
      | Rename severity   |     25 | A column rename is a breaking schema change. |
      | Downstream assets |      3 | 1 downstream assets are visible.             |

      ## Facts

      - Selected dataset urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD) was returned by DataHub.
      - Downstream asset urn:li:dataset:(urn:li:dataPlatform:snowflake,customer_orders,PROD) was returned at hop 1.

      ## Assumptions

      - Dataset resolution required one exact URN, name, or platform-qualified name match.
      - Downstream lineage inspection was bounded to two hops.

      ## Unknowns

      - Column-level impact is unknown; only table-level downstream lineage was returned.
      - Selected dataset environment metadata was not available.

      ## DataHub Tool Trace

      | Call ID | Tool | Status | Arguments |
      | --- | --- | --- | --- |
      | mcp-001 | search | ok | {"offset":0,"query":"/q orders\\|daily"} |

      ## Final Status

      COMPLETED_WITH_LIMITATIONS
      "
    `);
  });
});
