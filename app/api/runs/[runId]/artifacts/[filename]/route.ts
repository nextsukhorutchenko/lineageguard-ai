import { z } from "zod";
import { assertTrustedRunsRoot } from "../../../../../../src/artifacts/run-envelope-files.js";
import { loadWebConfig } from "../../../../../../src/config/web-config.js";
import { readCompletedPackageFile } from "../../../../../../src/runs/run-store.js";

export const runtime = "nodejs";

const PublicArtifactSchema = z.enum([
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
]);

type ArtifactRouteContext = {
  readonly params: Promise<{ readonly runId: string; readonly filename: string }>;
};

export async function GET(_request: Request, context: ArtifactRouteContext): Promise<Response> {
  try {
    const { runId, filename: untrustedFilename } = await context.params;
    const filename = PublicArtifactSchema.parse(untrustedFilename);
    const config = loadWebConfig(process.env);
    const runsRoot = await assertTrustedRunsRoot(config.runsRoot);
    const body = await readCompletedPackageFile({ runsRoot, runId, filename });
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": filename.endsWith(".sql")
          ? "text/sql; charset=utf-8"
          : "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Artifact not found." }, { status: 404 });
  }
}
