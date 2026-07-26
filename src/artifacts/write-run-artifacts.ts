import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import {
  MAX_VIRTUAL_ARTIFACT_BYTES,
  SafeRunIdSchema,
  serializeRunEnvelope,
  type RunEnvelope,
} from "../runs/run-envelope.js";
import { sanitizeBoundaryText } from "../security/sanitize-output.js";
import { publishRunEnvelope, readRunEnvelope } from "./run-envelope-files.js";

export { assertSafeRunId } from "../runs/run-envelope.js";

type ImpactReportStatus =
  "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "INSUFFICIENT_METADATA" | "INCOMPLETE_EVIDENCE";

const impactReportStatuses = new Set<ImpactReportStatus>([
  "COMPLETED",
  "COMPLETED_WITH_LIMITATIONS",
  "INSUFFICIENT_METADATA",
  "INCOMPLETE_EVIDENCE",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function writerInputError(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "Unable to persist the run.");
}

function unavailableImpactReport(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The stored impact report is unavailable.");
}

function assertBoundarySafeReport(content: string): void {
  const sanitized = sanitizeBoundaryText(content, [], Number.MAX_SAFE_INTEGER);
  const expectedWithVisibleLineFeeds = content.replaceAll("\n", "\\n");
  if (sanitized !== expectedWithVisibleLineFeeds) throw writerInputError();
}

function assertValidWriterInput(options: {
  readonly runId: unknown;
  readonly filename: unknown;
  readonly content: unknown;
  readonly status: unknown;
}): asserts options is {
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
  readonly status: ImpactReportStatus;
} {
  if (
    options.filename !== "impact-report.md" ||
    typeof options.runId !== "string" ||
    !SafeRunIdSchema.safeParse(options.runId).success ||
    typeof options.status !== "string" ||
    !impactReportStatuses.has(options.status as ImpactReportStatus) ||
    typeof options.content !== "string" ||
    Buffer.byteLength(options.content, "utf8") > MAX_VIRTUAL_ARTIFACT_BYTES
  ) {
    throw writerInputError();
  }
  assertBoundarySafeReport(options.content);
}

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
  readonly status: ImpactReportStatus;
  readonly signal?: AbortSignal;
}): Promise<"impact-report.md"> {
  let serialized: string;
  try {
    assertValidWriterInput(options);
    const envelope: RunEnvelope = {
      schemaVersion: "1",
      kind: "impact-report",
      runId: options.runId,
      status: options.status,
      report: options.content,
      hashes: { report: sha256(options.content) },
    };
    serialized = serializeRunEnvelope(envelope);
  } catch {
    throw writerInputError();
  }

  await publishRunEnvelope({
    runsRoot: options.runsRoot,
    runId: options.runId,
    serialized,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return "impact-report.md";
}

export async function readImpactReport(options: {
  readonly runsRoot: string;
  readonly runId: string;
}): Promise<string> {
  try {
    const envelope = await readRunEnvelope(options);
    if (envelope.kind !== "impact-report") throw unavailableImpactReport();
    return envelope.report;
  } catch {
    throw unavailableImpactReport();
  }
}
