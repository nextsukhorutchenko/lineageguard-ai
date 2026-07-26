import { prepareImpactContext } from "../tests/support/pr-impact/change-context.js";
import { ImpactContextSchema } from "../tests/support/pr-impact/contracts.js";
import { publishImpactContext } from "../tests/support/pr-impact/publication.js";

try {
  const context = await prepareImpactContext({
    cwd: process.cwd(),
    eventName: process.env.GITHUB_EVENT_NAME,
    baseSha: process.env.LINEAGEGUARD_PR_BASE_SHA,
    headSha: process.env.LINEAGEGUARD_PR_HEAD_SHA,
  });
  await publishImpactContext(ImpactContextSchema.parse(context), process.cwd());
  process.stdout.write("PR impact context prepared.\n");
} catch {
  process.stderr.write("PR impact context is unavailable.\n");
  process.exitCode = 1;
}
