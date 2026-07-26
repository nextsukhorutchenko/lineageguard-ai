import { appendFile, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { MAX_REPORT_MARKDOWN_BYTES } from "./contracts.js";
import { IMPACT_REPORT_MARKDOWN_PATH } from "./publication.js";

export interface AppendImpactSummaryOptions {
  readonly cwd: string;
  readonly eventName: string | undefined;
  readonly summaryPath: string | undefined;
}

const unavailable = (): Error => new Error("PR impact summary is unavailable.");

export async function appendImpactSummary(
  options: AppendImpactSummaryOptions,
): Promise<"APPENDED" | "SKIPPED"> {
  if (options.eventName !== "pull_request") return "SKIPPED";

  let report: Buffer;
  try {
    const canonicalCwd = await realpath(options.cwd);
    const reportPath = await realpath(join(canonicalCwd, IMPACT_REPORT_MARKDOWN_PATH));
    const reportRelative = relative(canonicalCwd, reportPath);
    if (
      reportRelative === ".." ||
      reportRelative.startsWith(`..${sep}`) ||
      isAbsolute(reportRelative)
    ) {
      throw unavailable();
    }
    report = await readFile(reportPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "SKIPPED";
    throw unavailable();
  }

  try {
    if (
      report.length > MAX_REPORT_MARKDOWN_BYTES ||
      options.summaryPath === undefined ||
      !isAbsolute(options.summaryPath)
    ) {
      throw unavailable();
    }
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(report);
    await appendFile(options.summaryPath, `${markdown}\n`, { encoding: "utf8", flag: "a" });
    return "APPENDED";
  } catch {
    throw unavailable();
  }
}
