import type { RuntimeConfig } from "../config/runtime-config.js";
import type { DataHubCatalog } from "./catalog.js";
import { DataHubMcpCatalog } from "./mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "./mcp/mcp-client.js";

export async function createDataHubCatalog(
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<DataHubCatalog> {
  const client = await connectDataHubMcp(config, signal);
  return new DataHubMcpCatalog(client, [config.datahubGmsToken]);
}
