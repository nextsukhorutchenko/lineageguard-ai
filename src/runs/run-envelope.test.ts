import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeChangeContext, makeMigrationDraft } from "../../tests/helpers/factories.js";
import { WorkflowSnapshotSchema } from "../workflow/contracts.js";
import { MigrationPackageDraftSchema } from "../workflow/migration-draft.js";
import {
  MAX_RUN_ENVELOPE_BYTES,
  MAX_RETRY_RESERVATION_BYTES,
  MAX_VIRTUAL_ARTIFACT_BYTES,
  RunEnvelopeSchema,
  RetryReservationEnvelopeSchema,
  assertEnvelopeByteLimit,
  assertSafeRunId,
  parseRunEnvelope,
  parseRetryReservation,
  serializeRunEnvelope,
  serializeRetryReservation,
  virtualArtifactFilenames,
} from "./run-envelope.js";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

type Finding = {
  readonly code: string;
  readonly message: string;
  readonly filename?: (typeof virtualArtifactFilenames)[number];
};

function makeSnapshot(options: {
  readonly runId?: string;
  readonly mode?: "LIVE" | "REPLAY";
  readonly parentRunId?: string;
  readonly status?: "COMPLETED" | "VALIDATION_FAILED" | "GENERATION_FAILED" | "DRAFT";
  readonly contextHash?: string;
  readonly executionClassification?:
    "EXECUTABLE_WITH_REVIEW" | "ADVISORY_ONLY" | "NON_EXECUTABLE_TEMPLATE";
  readonly artifacts?: readonly {
    readonly filename: (typeof virtualArtifactFilenames)[number];
    readonly sha256: string;
    readonly validated: boolean;
  }[];
  readonly findings?: readonly Finding[];
}) {
  const status = options.status ?? "COMPLETED";
  const findings = options.findings ?? [];
  return WorkflowSnapshotSchema.parse({
    runId: options.runId ?? "run-1",
    mode: options.mode ?? "REPLAY",
    status,
    ...(options.contextHash === undefined ? {} : { contextHash: options.contextHash }),
    ...(options.executionClassification === undefined
      ? {}
      : { executionClassification: options.executionClassification }),
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    activity: [],
    evidence: [],
    facts: [],
    assumptions: [],
    unknowns: [],
    validation:
      findings.length === 0
        ? { outcome: "PASSED", findingCount: 0, findingCodes: [] }
        : {
            outcome: "REJECTED",
            findingCount: findings.length,
            findingCodes: [...new Set(findings.map(({ code }) => code))].sort(),
          },
    artifacts: [...(options.artifacts ?? [])],
    ...(status === "VALIDATION_FAILED"
      ? { failure: { code: "VALIDATION_FAILED", message: "Validation failed." } }
      : status === "GENERATION_FAILED"
        ? { failure: { code: "GENERATION_FAILED", message: "Generation failed." } }
        : {}),
  });
}

function makeCompletedEnvelope() {
  const context = makeChangeContext();
  const draft = makeMigrationDraft(context);
  const files = {
    "migration-up.sql": "ALTER TABLE orders ADD COLUMN customer_key NUMBER;\n",
    "migration-down.sql": "ALTER TABLE orders DROP COLUMN customer_key;\n",
    "validation.sql": "SELECT COUNT(*) FROM orders;\n",
    "rollout-plan.md": "# Rollout\n",
  } as const;
  const artifactHashes = Object.fromEntries(
    virtualArtifactFilenames.map((filename) => [filename, sha256(files[filename])]),
  ) as Record<(typeof virtualArtifactFilenames)[number], string>;
  const snapshot = makeSnapshot({
    contextHash: context.contextHash,
    executionClassification: draft.executionClassification,
    artifacts: [...virtualArtifactFilenames]
      .sort()
      .map((filename) => ({ filename, sha256: artifactHashes[filename], validated: true })),
  });
  const findings: Finding[] = [];
  return {
    schemaVersion: "1" as const,
    kind: "completed" as const,
    runId: "run-1",
    mode: "REPLAY" as const,
    generationAttempt: 1 as const,
    snapshot,
    context,
    draft,
    findings,
    package: { classification: draft.executionClassification, files },
    hashes: {
      snapshot: sha256(canonical(WorkflowSnapshotSchema.parse(snapshot))),
      context: sha256(canonical(context)),
      draft: sha256(canonical(MigrationPackageDraftSchema.parse(draft))),
      findings: sha256(canonical(findings)),
      artifacts: artifactHashes,
    },
  };
}

function makeFailedEnvelope(findings: readonly Finding[] = []) {
  const context = makeChangeContext();
  const snapshot = makeSnapshot({
    contextHash: context.contextHash,
    status: findings.length === 0 ? "GENERATION_FAILED" : "VALIDATION_FAILED",
    findings,
  });
  return {
    schemaVersion: "1" as const,
    kind: "failed" as const,
    runId: "run-1",
    mode: "REPLAY" as const,
    generationAttempt: 1 as const,
    snapshot,
    context,
    findings: [...findings],
    hashes: {
      snapshot: sha256(canonical(WorkflowSnapshotSchema.parse(snapshot))),
      context: sha256(canonical(context)),
      findings: sha256(canonical(findings)),
    },
  };
}

function makeImpactEnvelope(report = "# Sanitized impact report\n") {
  return {
    schemaVersion: "1" as const,
    kind: "impact-report" as const,
    runId: "run-1",
    status: "COMPLETED" as const,
    report,
    hashes: { report: sha256(report) },
  };
}

describe("run envelopes", () => {
  it("uses the exact public artifact allowlist", () => {
    expect(virtualArtifactFilenames).toEqual([
      "migration-up.sql",
      "migration-down.sql",
      "validation.sql",
      "rollout-plan.md",
    ]);
  });

  it("rejects unknown keys and a completed envelope missing any public artifact", () => {
    const valid = makeCompletedEnvelope();
    expect(() => RunEnvelopeSchema.parse({ ...valid, extra: "forbidden" })).toThrow();
    const { ["migration-up.sql"]: omitted, ...incomplete } = valid.package.files;
    expect(omitted).toBeTypeOf("string");
    expect(() =>
      RunEnvelopeSchema.parse({ ...valid, package: { ...valid.package, files: incomplete } }),
    ).toThrow();
  });

  it("rejects a failed envelope with a public package", () => {
    const completed = makeCompletedEnvelope();
    expect(() =>
      RunEnvelopeSchema.parse({
        ...completed,
        kind: "failed",
        snapshot: makeFailedEnvelope().snapshot,
      }),
    ).toThrow();
  });

  it("rejects exact maximum plus one before JSON parsing", () => {
    const oversized = "x".repeat(MAX_RUN_ENVELOPE_BYTES + 1);
    expect(() => parseRunEnvelope(oversized, "run-1")).toThrow("The stored run is unavailable.");
  });

  it("accepts the exact envelope byte boundary and rejects one byte more", () => {
    expect(() => assertEnvelopeByteLimit("x".repeat(MAX_RUN_ENVELOPE_BYTES))).not.toThrow();
    expect(() => assertEnvelopeByteLimit("x".repeat(MAX_RUN_ENVELOPE_BYTES + 1))).toThrow(
      "The stored run is unavailable.",
    );
  });

  it("accepts an artifact at its exact byte limit and rejects one byte more", () => {
    expect(() =>
      RunEnvelopeSchema.parse(makeImpactEnvelope("x".repeat(MAX_VIRTUAL_ARTIFACT_BYTES))),
    ).not.toThrow();
    expect(() =>
      RunEnvelopeSchema.parse(makeImpactEnvelope("x".repeat(MAX_VIRTUAL_ARTIFACT_BYTES + 1))),
    ).toThrow();
  });

  it("rejects mismatched run IDs before returning a parsed envelope", () => {
    expect(() => parseRunEnvelope(serializeRunEnvelope(makeCompletedEnvelope()), "run-2")).toThrow(
      "The stored run is unavailable.",
    );
  });

  it.each([
    ["mode", (value: ReturnType<typeof makeCompletedEnvelope>) => ({ ...value, mode: "BAD" })],
    [
      "parent",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({ ...value, parentRunId: "parent-1" }),
    ],
    [
      "attempt",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({ ...value, generationAttempt: 2 }),
    ],
    [
      "snapshot hash",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({
        ...value,
        hashes: { ...value.hashes, snapshot: "0".repeat(64) },
      }),
    ],
    [
      "context hash",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({
        ...value,
        hashes: { ...value.hashes, context: "0".repeat(64) },
      }),
    ],
    [
      "draft hash",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({
        ...value,
        hashes: { ...value.hashes, draft: "0".repeat(64) },
      }),
    ],
    [
      "findings hash",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({
        ...value,
        hashes: { ...value.hashes, findings: "0".repeat(64) },
      }),
    ],
    [
      "artifact hash",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({
        ...value,
        hashes: {
          ...value.hashes,
          artifacts: { ...value.hashes.artifacts, "migration-up.sql": "0".repeat(64) },
        },
      }),
    ],
    [
      "non-terminal snapshot",
      (value: ReturnType<typeof makeCompletedEnvelope>) => ({
        ...value,
        snapshot: { ...value.snapshot, status: "DRAFT", validation: undefined },
      }),
    ],
  ])("rejects an invalid completed %s", (_label, mutate) => {
    expect(() => RunEnvelopeSchema.parse(mutate(makeCompletedEnvelope()))).toThrow();
  });

  it("rejects more than 200 findings, duplicate tuples, and unsorted tuples", () => {
    const findings: Finding[] = Array.from({ length: 201 }, (_, index) => ({
      code: `FINDING_${index}`,
      message: "Rejected.",
    }));
    expect(() => RunEnvelopeSchema.parse(makeFailedEnvelope(findings))).toThrow();

    expect(() =>
      RunEnvelopeSchema.parse(
        makeFailedEnvelope([
          { code: "A", message: "Repeated." },
          { code: "A", message: "Repeated." },
        ]),
      ),
    ).toThrow();
    expect(() =>
      RunEnvelopeSchema.parse(
        makeFailedEnvelope([
          { code: "B", message: "Second." },
          { code: "A", message: "First." },
        ]),
      ),
    ).toThrow();
  });

  it("rejects malformed legacy impact-report envelopes", () => {
    const valid = makeImpactEnvelope();
    expect(() => RunEnvelopeSchema.parse({ ...valid, status: "GENERATION_FAILED" })).toThrow();
    expect(() =>
      RunEnvelopeSchema.parse({ ...valid, hashes: { report: "0".repeat(64) } }),
    ).toThrow();
    expect(() => RunEnvelopeSchema.parse({ ...valid, extra: "forbidden" })).toThrow();
  });

  it.each([
    [
      "snapshot",
      () => ({
        ...makeCompletedEnvelope(),
        snapshot: { ...makeCompletedEnvelope().snapshot, extra: true },
      }),
    ],
    [
      "context",
      () => ({
        ...makeCompletedEnvelope(),
        context: { ...makeCompletedEnvelope().context, extra: true },
      }),
    ],
    [
      "draft",
      () => ({
        ...makeCompletedEnvelope(),
        draft: { ...makeCompletedEnvelope().draft, extra: true },
      }),
    ],
    [
      "package",
      () => ({
        ...makeCompletedEnvelope(),
        package: { ...makeCompletedEnvelope().package, extra: true },
      }),
    ],
    [
      "artifact files",
      () => ({
        ...makeCompletedEnvelope(),
        package: {
          ...makeCompletedEnvelope().package,
          files: { ...makeCompletedEnvelope().package.files, extra: true },
        },
      }),
    ],
    [
      "hashes",
      () => ({
        ...makeCompletedEnvelope(),
        hashes: { ...makeCompletedEnvelope().hashes, extra: "forbidden" },
      }),
    ],
    [
      "artifact hashes",
      () => ({
        ...makeCompletedEnvelope(),
        hashes: {
          ...makeCompletedEnvelope().hashes,
          artifacts: { ...makeCompletedEnvelope().hashes.artifacts, extra: "forbidden" },
        },
      }),
    ],
    [
      "finding",
      () => ({
        ...makeFailedEnvelope([{ code: "A", message: "Rejected." }]),
        findings: [{ code: "A", message: "Rejected.", extra: true }],
      }),
    ],
    [
      "impact hashes",
      () => ({
        ...makeImpactEnvelope(),
        hashes: { ...makeImpactEnvelope().hashes, extra: "forbidden" },
      }),
    ],
  ])("rejects unknown nested %s keys", (_label, makeInvalid) => {
    expect(() => RunEnvelopeSchema.parse(makeInvalid())).toThrow();
  });
});

describe("retry reservations", () => {
  const value = {
    schemaVersion: "1",
    kind: "retry-reservation",
    parentRunId: "parent-1",
    childRunId: "child-1",
    childMode: "REPLAY",
    generationAttempt: 2,
  } as const;

  it("accepts only the fixed closed reservation shape", () => {
    expect(RetryReservationEnvelopeSchema.parse(value)).toEqual(value);
    expect(() => RetryReservationEnvelopeSchema.parse({ ...value, token: "forbidden" })).toThrow();
  });

  it("accepts a safe run ID and rejects an unsafe one with a fixed boundary error", () => {
    expect(() => assertSafeRunId("run-1._safe")).not.toThrow();
    try {
      assertSafeRunId("../raw-input");
      throw new Error("Expected the unsafe run ID to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The run ID is invalid.",
      });
    }
  });

  it("serializes canonically and round-trips a retry reservation", () => {
    const serialized = serializeRetryReservation(value);
    expect(serialized).toBe(
      "{\n" +
        '  "schemaVersion": "1",\n' +
        '  "kind": "retry-reservation",\n' +
        '  "parentRunId": "parent-1",\n' +
        '  "childRunId": "child-1",\n' +
        '  "childMode": "REPLAY",\n' +
        '  "generationAttempt": 2\n' +
        "}\n",
    );
    expect(parseRetryReservation(serialized, value.parentRunId)).toEqual(value);
  });

  it.each([
    ["a different expected parent", serializeRetryReservation(value), "parent-2"],
    ["malformed JSON", '{"raw":"INPUT_MUST_NOT_LEAK"', value.parentRunId],
    [
      "a raw value over the byte limit",
      "x".repeat(MAX_RETRY_RESERVATION_BYTES + 1),
      value.parentRunId,
    ],
  ])("returns a fixed storage error for %s", (_label, raw, expectedParentRunId) => {
    try {
      parseRetryReservation(raw, expectedParentRunId);
      throw new Error("Expected retry-reservation parsing to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ARTIFACT_WRITE_FAILED",
        message: "The stored run is unavailable.",
      });
      expect((error as Error).message).not.toContain(raw);
    }
  });

  it.each([
    ["an unknown key", { token: "forbidden" }],
    ["an invalid generation attempt", { generationAttempt: 1 }],
  ])("rejects serialization with %s", (_label, invalid) => {
    expect(() => serializeRetryReservation({ ...value, ...invalid } as never)).toThrow();
  });

  it.each([
    ["same parent and child", { parentRunId: "parent-1", childRunId: "parent-1" }],
    ["wrong mode", { childMode: "REGENERATE" }],
    ["wrong attempt", { generationAttempt: 1 }],
  ])("rejects a reservation with %s", (_label, invalid) => {
    expect(() =>
      RetryReservationEnvelopeSchema.parse({
        schemaVersion: "1",
        kind: "retry-reservation",
        parentRunId: "parent-1",
        childRunId: "child-1",
        childMode: "REPLAY",
        generationAttempt: 2,
        ...invalid,
      }),
    ).toThrow();
  });
});
