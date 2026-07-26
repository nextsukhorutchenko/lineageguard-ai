import { appendImpactSummary } from "../tests/support/pr-impact/summary.js";

try {
  const result = await appendImpactSummary({
    cwd: process.cwd(),
    eventName: process.env.GITHUB_EVENT_NAME,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  });
  if (result === "APPENDED") {
    process.stdout.write("PR impact summary appended.\n");
  }
} catch {
  process.stderr.write("PR impact summary is unavailable.\n");
  process.exitCode = 1;
}
