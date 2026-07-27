import { assertTrustedRunsRoot } from "../artifacts/run-envelope-files.js";
import { loadWebConfig } from "../config/web-config.js";
import { noStoreHeaders } from "../http/response-headers.js";

export function createPublicReplayHealthHandler(
  overrides: {
    readonly loadConfig?: typeof loadWebConfig;
    readonly assertRunsRoot?: typeof assertTrustedRunsRoot;
  } = {},
): () => Promise<Response> {
  const loadConfig = overrides.loadConfig ?? loadWebConfig;
  const assertRunsRoot = overrides.assertRunsRoot ?? assertTrustedRunsRoot;

  return async (): Promise<Response> => {
    try {
      const config = loadConfig(process.env);
      if (config.deploymentProfile !== "PUBLIC_REPLAY") throw new Error("Unavailable.");
      await assertRunsRoot(config.runsRoot);
      return Response.json({ status: "ok", mode: "PUBLIC_REPLAY" }, { headers: noStoreHeaders() });
    } catch {
      return Response.json({ status: "unavailable" }, { status: 503, headers: noStoreHeaders() });
    }
  };
}
