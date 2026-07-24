import { expect, it } from "vitest";
import { makeImpactReportDraft } from "../../tests/helpers/factories.js";
import { WorkflowSnapshotSchema } from "./contracts.js";
import { buildChangeContext, ChangeContextSchema } from "./change-context.js";

it("builds stable grounded evidence IDs and a deterministic hash", () => {
  const first = buildChangeContext(makeImpactReportDraft(), []);
  const second = buildChangeContext(makeImpactReportDraft(), []);

  expect(first.assessment).toMatchObject({ score: 90, level: "critical" });
  expect(first.advisoryDecision).toBe("BLOCK_DIRECT_RENAME");
  expect(first.evidence.filter(({ kind }) => kind === "downstream")).toHaveLength(2);
  expect(first.evidence.filter(({ level }) => level === "column")).toHaveLength(1);
  expect(first.contextHash).toBe(second.contextHash);
  expect(new Set(first.evidence.map(({ id }) => id)).size).toBe(first.evidence.length);
  expect(first.provenance.map(({ tool }) => tool)).toEqual([
    "search",
    "list_schema_fields",
    "get_lineage",
    "get_lineage",
    "get_entities",
  ]);
});

it("excludes volatile provenance telemetry but includes semantic provenance in the hash", () => {
  const base = makeImpactReportDraft();
  const changedTelemetry = {
    ...base,
    evidence: {
      ...base.evidence,
      trace: base.evidence.trace.map((entry) => ({
        ...entry,
        callId: `retry-${entry.callId}`,
        at: "2026-07-22T12:01:00.000Z",
      })),
    },
  };
  expect(buildChangeContext(changedTelemetry, []).contextHash).toBe(
    buildChangeContext(base, []).contextHash,
  );

  const changedPage = {
    ...base,
    evidence: {
      ...base.evidence,
      trace: base.evidence.trace.map((entry, index) =>
        index === 0 ? { ...entry, page: 2 } : entry,
      ),
    },
  };
  expect(buildChangeContext(changedPage, []).contextHash).not.toBe(
    buildChangeContext(base, []).contextHash,
  );
});

it("canonicalizes equivalent relevant entity-context order before hashing", () => {
  const base = makeImpactReportDraft();
  const entity = (urn: string) => ({
    urn,
    entityType: "DATASET",
    owners: [],
    tags: [],
    glossaryTerms: [],
    siblingUrns: [],
    qualitySignals: [],
  });
  const firstDownstream = base.evidence.downstreamAssets[0]!;
  const secondDownstream = base.evidence.downstreamAssets[1]!;
  const first = {
    ...base,
    evidence: {
      ...base.evidence,
      entityContext: [entity(secondDownstream.urn), entity(firstDownstream.urn)],
      entityContextRetrieval: {
        complete: false,
        pages: 1,
        itemCount: 2,
        offsets: [0],
        reasonCodes: ["ENTITY_CONTEXT_UNAVAILABLE"] as const,
      },
      contextCoverage: {
        retrievalComplete: false,
        relevantAssets: 3,
        inspectedAssets: 2,
        retrievalPercentage: 67,
        possibleSignals: 6,
        coveredSignals: 0,
        percentage: 0,
        withDescriptions: 0,
        withOwners: 0,
        withGovernance: 0,
        missingMetadataUrns: [firstDownstream.urn, secondDownstream.urn],
        unknownMetadataUrns: [base.evidence.targetDataset.urn],
      },
    },
  };
  const second = {
    ...first,
    evidence: { ...first.evidence, entityContext: [...first.evidence.entityContext].reverse() },
  };
  expect(buildChangeContext(first, []).contextHash).toBe(
    buildChangeContext(second, []).contextHash,
  );
});

it("bounds schema input while hashing every collected schema field", () => {
  const base = makeImpactReportDraft();
  const source = base.evidence.sourceColumn;
  const fields = [
    source,
    ...Array.from({ length: 9_999 }, (_, index) => ({
      fieldPath: `field_${String(index).padStart(4, "0")}`,
      nativeDataType: "VARCHAR",
    })),
  ];
  const report = { ...base, evidence: { ...base.evidence, schemaFields: fields } };
  const first = buildChangeContext(report, []);
  const changed = {
    ...report,
    evidence: {
      ...report.evidence,
      schemaFields: report.evidence.schemaFields.map((field, index) =>
        index === 9_999 ? { ...field, nativeDataType: "BOOLEAN" } : field,
      ),
    },
  };
  const second = buildChangeContext(changed, []);

  expect(first.knownFields).toHaveLength(100);
  expect(first.knownFields[0]).toMatchObject(source);
  expect(first.schemaSummary).toMatchObject({ totalFields: 10_000, truncated: true });
  expect(second.schemaSummary.fingerprint).not.toBe(first.schemaSummary.fingerprint);
  expect(second.contextHash).not.toBe(first.contextHash);
});

it("preserves maximum-length valid identities across context and snapshot evidence", () => {
  const base = makeImpactReportDraft();
  const fieldPath = "f".repeat(500);
  const urn = `urn:li:${"a".repeat(493)}`;
  const report = {
    ...base,
    intent: { ...base.intent, sourceColumn: fieldPath },
    evidence: {
      ...base.evidence,
      targetDataset: { ...base.evidence.targetDataset, urn, name: "n".repeat(500) },
      searchCandidateUrns: [urn],
      schemaFields: [{ fieldPath, nativeDataType: "VARCHAR" }],
      sourceColumn: { fieldPath, nativeDataType: "VARCHAR" },
      downstreamAssets: [],
      columnAffectedAssets: [],
      contextCoverage: {
        ...base.evidence.contextCoverage,
        relevantAssets: 1,
        unknownMetadataUrns: [urn],
      },
      trace: base.evidence.trace.map((entry) =>
        entry.tool === "search" ? entry : { ...entry, arguments: { urn, offset: 0 } },
      ),
    },
    facts: [`Selected dataset ${urn} was returned by DataHub.`],
  };
  const context = buildChangeContext(report, []);
  const sourceEvidence = context.evidence.find(({ kind }) => kind === "source_column");

  expect(sourceEvidence?.id).toHaveLength("datahub:source-column:".length + fieldPath.length);
  expect(sourceEvidence?.id.length).toBeLessThanOrEqual(600);
  expect(context.facts[0]).toHaveLength(`Selected dataset ${urn} was returned by DataHub.`.length);
  expect(context.facts[0]?.length).toBeLessThanOrEqual(1_200);
  expect(ChangeContextSchema.parse(context).sourceField.fieldPath).toBe(fieldPath);
  expect(
    WorkflowSnapshotSchema.parse({
      runId: "run-test",
      mode: "REPLAY",
      status: "DRAFT",
      activity: [],
      evidence: context.evidence,
      facts: context.facts,
      assumptions: context.assumptions,
      unknowns: context.unknowns,
      artifacts: [],
    }).evidence.find(({ kind }) => kind === "source_column")?.fieldPath,
  ).toBe(fieldPath);
});

it("hashes all canonical narrative candidates before retaining the first one hundred", () => {
  const base = makeImpactReportDraft();
  const facts = Array.from({ length: 101 }, (_, index) => `Fact ${String(index).padStart(3, "0")}`);
  const first = buildChangeContext({ ...base, facts }, []);
  const second = buildChangeContext({ ...base, facts: [...facts.slice(0, 100), "Fact 999"] }, []);

  expect(first.facts).toEqual(second.facts);
  expect(first.narrativeSummary.fingerprint).not.toBe(second.narrativeSummary.fingerprint);
  expect(first.contextHash).not.toBe(second.contextHash);
});

it("redacts ordinary copied text before it enters the change context", () => {
  const secret = "server-secret";
  const context = buildChangeContext(
    {
      ...makeImpactReportDraft(),
      request: `Rename a column with ${secret}.`,
      facts: [`DataHub supplied ${secret}.`],
      assumptions: [`The ${secret} connection was available.`],
      unknowns: [`The ${secret} owner remains unknown.`],
    },
    [secret],
  );

  expect(JSON.stringify(context)).not.toContain(secret);
  expect(context.request).toContain("[REDACTED]");
  expect(context.facts).toEqual(["DataHub supplied [REDACTED]."]);
});

it("rejects a required identity that is redacted at the context boundary", () => {
  const secret = "customer_secret";
  const base = makeImpactReportDraft();
  const report = {
    ...base,
    intent: { ...base.intent, sourceColumn: secret },
    evidence: {
      ...base.evidence,
      schemaFields: [{ fieldPath: secret, nativeDataType: "VARCHAR" }],
      sourceColumn: { fieldPath: secret, nativeDataType: "VARCHAR" },
    },
  };

  expect(() => buildChangeContext(report, [secret])).toThrow("Invalid sanitized ChangeContext.");
});

it("rejects identities that collide after boundary normalization", () => {
  const base = makeImpactReportDraft();
  const report = {
    ...base,
    evidence: {
      ...base.evidence,
      schemaFields: [
        base.evidence.sourceColumn,
        { fieldPath: "e\u0301", nativeDataType: "VARCHAR" },
        { fieldPath: "é", nativeDataType: "VARCHAR" },
      ],
    },
  };

  expect(() => buildChangeContext(report, [])).toThrow("Invalid sanitized ChangeContext.");
});

it("ignores unknown runtime collection properties rather than reading them", () => {
  const base = makeImpactReportDraft();
  const search = { ...base.evidence.completeness.search } as Record<string, unknown>;
  Object.defineProperty(search, "unsafeFutureProperty", {
    enumerable: true,
    get: () => {
      throw new Error("raw-secret-must-not-be-read");
    },
  });
  const report = {
    ...base,
    evidence: {
      ...base.evidence,
      completeness: { ...base.evidence.completeness, search },
    },
  };

  expect(buildChangeContext(report as unknown as typeof base, [])).toMatchObject({
    evidenceCompleteness: { search: base.evidence.completeness.search },
  });
});

it("exposes only the fixed boundary error when untrusted conversion fails", () => {
  const base = makeImpactReportDraft();
  const unsafeIdentity = {
    toString: () => {
      throw new Error("raw-secret-must-not-escape");
    },
  };
  const report = {
    ...base,
    evidence: {
      ...base.evidence,
      schemaFields: [{ fieldPath: unsafeIdentity, nativeDataType: "VARCHAR" }],
      sourceColumn: { fieldPath: unsafeIdentity, nativeDataType: "VARCHAR" },
    },
  };

  expect(() => buildChangeContext(report as unknown as typeof base, [])).toThrow(
    "Invalid sanitized ChangeContext.",
  );
  expect(() => buildChangeContext(report as unknown as typeof base, [])).not.toThrow(
    "raw-secret-must-not-escape",
  );
});

it("requires entity-context and unknown metadata to partition relevant URNs exactly", () => {
  const context = buildChangeContext(makeImpactReportDraft(), []);
  const relevant = context.evidence.find(({ kind }) => kind === "downstream")!.urn;
  const foreign = "urn:li:dataset:(foreign)";

  const parse = (update: (value: typeof context) => typeof context) =>
    expect(() => ChangeContextSchema.parse(update(context))).toThrow("Inconsistent ChangeContext.");

  parse((value) => ({
    ...value,
    entityContext: [
      {
        urn: foreign,
        entityType: "DATASET",
        owners: [],
        tags: [],
        glossaryTerms: [],
        siblingUrns: [],
        qualitySignals: [],
      },
    ],
    entityContextRetrieval: {
      complete: false,
      pages: 1,
      itemCount: 1,
      offsets: [0],
      reasonCodes: ["ENTITY_CONTEXT_UNAVAILABLE"],
    },
    contextCoverage: {
      ...value.contextCoverage,
      inspectedAssets: 1,
      retrievalPercentage: 33,
      possibleSignals: 3,
      percentage: 0,
      missingMetadataUrns: [foreign],
      unknownMetadataUrns: value.contextCoverage.unknownMetadataUrns.filter(
        (urn) => urn !== relevant,
      ),
    },
  }));
  parse((value) => ({
    ...value,
    contextCoverage: {
      ...value.contextCoverage,
      unknownMetadataUrns: [...value.contextCoverage.unknownMetadataUrns, foreign],
    },
  }));
  parse((value) => ({
    ...value,
    contextCoverage: {
      ...value.contextCoverage,
      unknownMetadataUrns: value.contextCoverage.unknownMetadataUrns.filter(
        (urn) => urn !== relevant,
      ),
    },
  }));
  parse((value) => ({
    ...value,
    entityContext: [
      {
        urn: relevant,
        entityType: "DATASET",
        owners: [],
        tags: [],
        glossaryTerms: [],
        siblingUrns: [],
        qualitySignals: [],
      },
    ],
    entityContextRetrieval: {
      complete: false,
      pages: 1,
      itemCount: 1,
      offsets: [0],
      reasonCodes: ["ENTITY_CONTEXT_UNAVAILABLE"],
    },
    contextCoverage: {
      ...value.contextCoverage,
      inspectedAssets: 1,
      retrievalPercentage: 33,
      possibleSignals: 3,
      percentage: 0,
      missingMetadataUrns: [relevant],
    },
  }));
  parse((value) => ({
    ...value,
    contextCoverage: { ...value.contextCoverage, relevantAssets: 2 },
  }));

  expect(ChangeContextSchema.parse(context)).toEqual(context);
});
