import type { RuntimeConfig } from "../config/runtime-config.js";
import type { RecordDeadlineEvent } from "../runtime/deadline-events.js";
import type { ClassifiedAbortScope } from "../runtime/deadlines.js";
import type { DataHubCatalog } from "./catalog.js";
import { DataHubMcpCatalog } from "./mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "./mcp/mcp-client.js";

export async function createDataHubCatalog(
  config: RuntimeConfig,
  scope: ClassifiedAbortScope,
  recordDeadlineEvent: RecordDeadlineEvent,
): Promise<DataHubCatalog> {
  const client = await connectDataHubMcp(config, scope, recordDeadlineEvent);
  return new DataHubMcpCatalog(client, [config.datahubGmsToken]);
}
