import { regeneratePackage } from "../../../../../src/app/regenerate-package.js";
import {
  createWebRegenerationDependencies,
  safeCancellationSnapshot,
  safeUnexpectedFailureSnapshot,
} from "../../../../../src/app/web-dependencies.js";
import { assertTrustedRunsRoot } from "../../../../../src/artifacts/run-envelope-files.js";
import { loadWebConfig } from "../../../../../src/config/web-config.js";
import { createRunId } from "../../../../../src/runs/create-run-id.js";
import { encodeWorkflowEvent } from "../../../../../src/ui/read-ndjson.js";
import type { WorkflowEvent } from "../../../../../src/workflow/contracts.js";
import { isTerminalWorkflowStatus } from "../../../../../src/workflow/state-machine.js";

export const runtime = "nodejs";

type RegenerateRouteContext = { readonly params: Promise<{ readonly runId: string }> };

export async function POST(request: Request, context: RegenerateRouteContext): Promise<Response> {
  let requestBody: string;
  try {
    requestBody = await request.text();
  } catch {
    return Response.json({ error: "Invalid regeneration request." }, { status: 400 });
  }
  if (requestBody.length > 0) {
    return Response.json({ error: "Invalid regeneration request." }, { status: 400 });
  }

  let config: ReturnType<typeof loadWebConfig>;
  try {
    config = loadWebConfig(process.env);
  } catch {
    return Response.json({ error: "Demo service is not configured." }, { status: 503 });
  }
  let runsRoot: string;
  try {
    runsRoot = await assertTrustedRunsRoot(config.runsRoot);
  } catch {
    return Response.json({ error: "Demo service storage is unavailable." }, { status: 503 });
  }

  const { runId: parentRunId } = await context.params;
  const runId = createRunId(new Date());
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let terminalSnapshotSent = false;
      const safeEnqueue = (event: WorkflowEvent): boolean => {
        try {
          controller.enqueue(encodeWorkflowEvent(event));
          if (event.type === "snapshot" && isTerminalWorkflowStatus(event.snapshot.status)) {
            terminalSnapshotSent = true;
          }
          return true;
        } catch {
          return false;
        }
      };
      try {
        const snapshot = await regeneratePackage(
          createWebRegenerationDependencies({
            config,
            runsRoot,
            parentRunId,
            runId,
            signal: abortController.signal,
            onEvent: (event) => void safeEnqueue(event),
          }),
        );
        if (!terminalSnapshotSent) safeEnqueue({ type: "snapshot", snapshot });
      } catch {
        if (!terminalSnapshotSent) {
          const snapshot = abortController.signal.aborted
            ? safeCancellationSnapshot(runId, config.mode)
            : safeUnexpectedFailureSnapshot(runId, config.mode);
          safeEnqueue({ type: "snapshot", snapshot });
        }
      } finally {
        request.signal.removeEventListener("abort", abort);
        try {
          controller.close();
        } catch {
          // A disconnected client is expected to have cancelled the stream.
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
