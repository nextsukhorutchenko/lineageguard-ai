import { assertTrustedRunsRoot } from "../../../../src/artifacts/run-envelope-files.js";
import { loadWebConfig } from "../../../../src/config/web-config.js";
import { loadRunSnapshot } from "../../../../src/runs/run-store.js";

export const runtime = "nodejs";

type RunRouteContext = { readonly params: Promise<{ readonly runId: string }> };

export async function GET(_request: Request, context: RunRouteContext): Promise<Response> {
  try {
    const { runId } = await context.params;
    const config = loadWebConfig(process.env);
    const runsRoot = await assertTrustedRunsRoot(config.runsRoot);
    const snapshot = await loadRunSnapshot({ runsRoot, runId });
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }
}
