import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkflowSnapshotSchema, type WorkflowSnapshot } from "../workflow/contracts.js";
import { ContextCoveragePanel } from "./context-coverage-panel.js";

const completeCollection: NonNullable<WorkflowSnapshot["evidenceCompleteness"]>["search"] = {
  complete: true,
  pages: 1,
  itemCount: 1,
  offsets: [0],
  reasonCodes: [],
};

function makeSnapshot(options: {
  readonly analysisStatus: "COMPLETED" | "INCOMPLETE_EVIDENCE";
  readonly evidenceCompleteness: WorkflowSnapshot["evidenceCompleteness"];
  readonly entityContextRetrieval: WorkflowSnapshot["entityContextRetrieval"];
  readonly contextCoverage: WorkflowSnapshot["contextCoverage"];
}): WorkflowSnapshot {
  return WorkflowSnapshotSchema.parse({
    runId: "context-panel-test",
    mode: "REPLAY",
    status: "DRAFT",
    analysisStatus: options.analysisStatus,
    activity: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    evidenceCompleteness: options.evidenceCompleteness,
    entityContextRetrieval: options.entityContextRetrieval,
    contextCoverage: options.contextCoverage,
    contextIndicators: {
      quality: { assetsWithSignals: 1, signalCount: 2 },
      usage: {
        status: "NOT_COLLECTED",
        assetsWithSignals: 0,
        signalCount: 0,
        reason: "OUTSIDE_FOUR_TOOL_SLICE",
      },
    },
    artifacts: [],
  });
}

it("keeps complete evidence and metadata context coverage as separate states", () => {
  const renderedComplete = renderToStaticMarkup(
    createElement(ContextCoveragePanel, {
      snapshot: makeSnapshot({
        analysisStatus: "COMPLETED",
        evidenceCompleteness: {
          complete: true,
          search: completeCollection,
          schema: completeCollection,
          tableLineage: completeCollection,
          columnLineage: completeCollection,
        },
        entityContextRetrieval: {
          complete: true,
          pages: 1,
          itemCount: 2,
          offsets: [0],
          reasonCodes: [],
        },
        contextCoverage: {
          retrievalComplete: true,
          relevantAssets: 2,
          inspectedAssets: 2,
          retrievalPercentage: 100,
          possibleSignals: 6,
          coveredSignals: 3,
          percentage: 50,
          withDescriptions: 1,
          withOwners: 1,
          withGovernance: 1,
          missingMetadataUrns: ["urn:li:dataset:(missing-context)"],
          unknownMetadataUrns: [],
        },
      }),
    }),
  );
  const renderedIncomplete = renderToStaticMarkup(
    createElement(ContextCoveragePanel, {
      snapshot: makeSnapshot({
        analysisStatus: "INCOMPLETE_EVIDENCE",
        evidenceCompleteness: {
          complete: false,
          search: {
            complete: false,
            pages: 1,
            itemCount: 1,
            offsets: [0],
            reasonCodes: ["TOKEN_BUDGET_TRUNCATION"],
          },
          schema: completeCollection,
          tableLineage: completeCollection,
          columnLineage: completeCollection,
        },
        entityContextRetrieval: {
          complete: false,
          pages: 1,
          itemCount: 1,
          offsets: [0],
          reasonCodes: ["ENTITY_CONTEXT_TRUNCATED"],
        },
        contextCoverage: {
          retrievalComplete: false,
          relevantAssets: 2,
          inspectedAssets: 1,
          retrievalPercentage: 50,
          possibleSignals: 3,
          coveredSignals: 0,
          percentage: 0,
          withDescriptions: 0,
          withOwners: 0,
          withGovernance: 0,
          missingMetadataUrns: [],
          unknownMetadataUrns: ["urn:li:dataset:(unknown-context)"],
        },
      }),
    }),
  );

  expect(renderedComplete).toContain("Evidence complete");
  expect(renderedComplete).toContain("Context coverage");
  expect(renderedComplete).toContain("50%");
  expect(renderedComplete).toContain("2 of 2 assets inspected");
  expect(renderedComplete).toContain("100% retrieval coverage");
  expect(renderedComplete).toContain("Entity context retrieval complete");
  expect(renderedComplete).toContain("search");
  expect(renderedComplete).toContain("list_schema_fields");
  expect(renderedComplete).toContain("get_lineage · table");
  expect(renderedComplete).toContain("get_lineage · column");
  expect(renderedComplete).toContain("get_entities");
  expect((renderedComplete.match(/get_entities/gu) ?? []).length).toBe(1);
  expect(renderedComplete).toContain("Quality indicators");
  expect(renderedComplete).toContain("Usage indicators not collected");
  expect(renderedComplete).toContain("urn:li:dataset:(missing-context)");
  expect(renderedIncomplete).toContain("urn:li:dataset:(unknown-context)");
  expect(renderedIncomplete).toContain("Entity context retrieval incomplete");
  expect(renderedIncomplete).toContain("ENTITY CONTEXT TRUNCATED");
  expect(renderedIncomplete).toContain("Incomplete evidence");
  expect(renderedIncomplete).toContain("TOKEN BUDGET TRUNCATION");
  expect(renderedIncomplete).toContain("Collected counts are lower bounds");
  expect(renderedIncomplete).not.toContain(">Evidence complete</strong>");
});
