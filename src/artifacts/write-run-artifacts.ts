import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import { serializeRunEnvelope, type RunEnvelope } from "../runs/run-envelope.js";
import { publishRunEnvelope, readRunEnvelope } from "./run-envelope-files.js";

export { assertSafeRunId } from "../runs/run-envelope.js";

type ImpactReportStatus =
  "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "INSUFFICIENT_METADATA" | "INCOMPLETE_EVIDENCE";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function unavailableImpactReport(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The stored impact report is unavailable.");
}

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
  readonly status: ImpactReportStatus;
  readonly signal?: AbortSignal;
}): Promise<"impact-report.md"> {
  const envelope: RunEnvelope = {
    schemaVersion: "1",
    kind: "impact-report",
    runId: options.runId,
    status: options.status,
    report: options.content,
    hashes: { report: sha256(options.content) },
  };
  const serialized = serializeRunEnvelope(envelope);

  await publishRunEnvelope({
    runsRoot: options.runsRoot,
    runId: options.runId,
    serialized,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return options.filename;
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
