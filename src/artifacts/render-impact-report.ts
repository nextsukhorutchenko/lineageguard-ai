import type { ImpactReportDraft } from "../app/run-impact-analysis.js";
import type { RiskFactor } from "../domain/impact-assessment.js";
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from "../security/sanitize-output.js";

type Alignment = "left" | "right";

const factorNames: Readonly<Record<RiskFactor["name"], string>> = {
  renameSeverity: "Rename severity",
  downstreamAssets: "Downstream assets",
  lineageDepth: "Lineage depth",
  confirmedColumns: "Confirmed columns",
  metadataGap: "Metadata gap",
};

const traceArgumentKeys = {
  search: ["filter", "num_results", "offset", "query"],
  list_schema_fields: ["limit", "offset", "urn"],
  get_lineage: ["column", "max_hops", "max_results", "offset", "upstream", "urn"],
  get_entities: ["urns"],
} as const;

function escapeTableCell(value: unknown, secrets: readonly string[]): string {
  return sanitizeMarkdownTableCell(value, secrets);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function compactTable(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  secrets: readonly string[],
): string {
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) => `| ${row.map((value) => escapeTableCell(value, secrets)).join(" | ")} |`,
  );
  return [header, separator, ...body].join("\n");
}

function alignedTable(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  alignments: readonly Alignment[],
  secrets: readonly string[],
): string {
  const escapedRows = rows.map((row) => row.map((value) => escapeTableCell(value, secrets)));
  const widths = headers.map((header, index) =>
    Math.max(header.length, 3, ...escapedRows.map((row) => row[index]?.length ?? 0)),
  );
  const renderRow = (row: readonly string[], header = false): string =>
    `| ${row
      .map((cell, index) =>
        header || alignments[index] !== "right"
          ? cell.padEnd(widths[index]!)
          : cell.padStart(widths[index]!),
      )
      .join(" | ")} |`;
  const separator = widths.map((width, index) =>
    alignments[index] === "right" ? `${"-".repeat(Math.max(2, width - 1))}:` : "-".repeat(width),
  );

  return [
    renderRow(headers, true),
    renderRow(separator),
    ...escapedRows.map((row) => renderRow(row)),
  ].join("\n");
}

function bulletList(values: readonly string[], secrets: readonly string[]): string {
  return values.length === 0
    ? "- None."
    : values.map((value) => `- ${sanitizeMarkdownText(value, secrets)}`).join("\n");
}

function safeTraceArguments(
  tool: keyof typeof traceArgumentKeys,
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    traceArgumentKeys[tool]
      .filter((key) => Object.hasOwn(args, key))
      .map((key) => [key, args[key]]),
  );
}

export function renderImpactReport(
  run: ImpactReportDraft,
  secrets: readonly string[] = [],
): string {
  const columnAffectedUrns = new Set(run.evidence.columnAffectedAssets.map(({ urn }) => urn));
  const affectedAssets =
    run.evidence.downstreamAssets.length === 0
      ? "No downstream assets were returned."
      : compactTable(
          ["URN", "Name", "Platform", "Hop", "Evidence"],
          run.evidence.downstreamAssets.map((asset) => [
            asset.urn,
            asset.name ?? "Not available",
            asset.platform ?? "Not available",
            asset.hop,
            columnAffectedUrns.has(asset.urn) ? "Column" : "Table",
          ]),
          secrets,
        );
  const factorTable = alignedTable(
    ["Factor", "Points", "Explanation"],
    run.assessment.factors.map((factor) => [
      factorNames[factor.name],
      factor.points,
      factor.explanation,
    ]),
    ["left", "right", "left"],
    secrets,
  );
  const traceTable = compactTable(
    ["Call ID", "Tool", "Status", "Arguments"],
    run.evidence.trace.map((entry) => [
      entry.callId,
      entry.tool,
      entry.status,
      stableJson(safeTraceArguments(entry.tool, entry.arguments)),
    ]),
    secrets,
  );
  const sections = [
    "# LineageGuard AI Impact Report",
    "## Request",
    compactTable(
      ["Run ID", "Created at", "Original request"],
      [[run.runId, run.createdAt, run.request]],
      secrets,
    ),
    "## Resolved Change Intent",
    compactTable(
      ["Change", "Dataset hint", "Source column", "Target column"],
      [["Rename column", run.intent.datasetHint, run.intent.sourceColumn, run.intent.targetColumn]],
      secrets,
    ),
    "## Selected Dataset",
    compactTable(
      ["URN", "Name", "Platform", "Environment", "Source column", "Native type", "Nullable"],
      [
        [
          run.evidence.targetDataset.urn,
          run.evidence.targetDataset.name,
          run.evidence.targetDataset.platform ?? "Not available",
          run.evidence.targetDataset.environment ?? "Not available",
          run.evidence.sourceColumn.fieldPath,
          run.evidence.sourceColumn.nativeDataType ?? "Not available",
          run.evidence.sourceColumn.nullable === undefined
            ? "Not available"
            : run.evidence.sourceColumn.nullable
              ? "Yes"
              : "No",
        ],
      ],
      secrets,
    ),
    "## Evidence Summary",
    compactTable(
      ["Evidence level", "Downstream assets", "Column-affected assets", "Inspection bound"],
      [
        [
          run.evidence.evidenceLevel,
          run.evidence.downstreamAssets.length,
          run.evidence.columnAffectedAssets.length,
          "2 hops",
        ],
      ],
      secrets,
    ),
    "## Affected Downstream Assets",
    affectedAssets,
    "## Deterministic Impact Assessment",
    compactTable(
      ["Score", "Risk level", "Confidence"],
      [[run.assessment.score, run.assessment.level, run.assessment.confidence]],
      secrets,
    ),
    factorTable,
    "## Facts",
    bulletList(run.facts, secrets),
    "## Assumptions",
    bulletList(run.assumptions, secrets),
    "## Unknowns",
    bulletList(run.unknowns, secrets),
    "## DataHub Tool Trace",
    traceTable,
    "## Final Status",
    run.status,
  ];

  return `${sections.join("\n\n").trimEnd()}\n`;
}
