import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { AppError } from "../../errors/app-error.js";
import { redact } from "../../security/redact.js";
import { sanitizeBoundaryText } from "../../security/sanitize-output.js";
import type { RecordDeadlineEvent } from "../../runtime/deadline-events.js";
import {
  createDeadline,
  DEADLINES_MS,
  type ClassifiedAbortScope,
} from "../../runtime/deadlines.js";
import type { McpToolClient, ToolCallRequest } from "./datahub-mcp-catalog.js";
import { createBoundedMcpClose, type OwnedMcpToolCallOptions } from "./mcp-boundary-policy.js";

const MAX_STDERR_CHARACTERS = 4_096;

export function dataHubMcpServerParameters(config: RuntimeConfig): StdioServerParameters {
  return {
    command: config.uvxPath,
    args: ["mcp-server-datahub@0.6.0", "--transport", "stdio"],
    env: {
      UV_OFFLINE: "1",
      DATAHUB_GMS_URL: config.datahubGmsUrl,
      DATAHUB_GMS_TOKEN: config.datahubGmsToken,
      TOOLS_IS_MUTATION_ENABLED: "false",
      TOOLS_IS_USER_ENABLED: "false",
      DATAHUB_MCP_DOCUMENT_TOOLS_DISABLED: "true",
      SAVE_DOCUMENT_TOOL_ENABLED: "false",
      DATA_QUALITY_TOOLS_ENABLED: "false",
      SEMANTIC_SEARCH_ENABLED: "false",
    },
    stderr: "pipe",
  };
}

interface SdkToolClient {
  callTool(
    request: ToolCallRequest,
    resultSchema?: typeof CallToolResultSchema,
    options?: OwnedMcpToolCallOptions,
  ): ReturnType<Client["callTool"]>;
  listTools(
    params?: { readonly cursor?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    readonly tools: readonly {
      readonly name: string;
      readonly annotations?: { readonly readOnlyHint?: boolean | undefined } | undefined;
    }[];
    readonly nextCursor?: string | undefined;
  }>;
  getServerVersion(): { readonly name: string; readonly version: string } | undefined;
  close(): Promise<void>;
}

interface OwnedSdkToolClient extends SdkToolClient {
  connect: Client["connect"];
}

export const REQUIRED_DATAHUB_READ_TOOLS = [
  "search",
  "list_schema_fields",
  "get_lineage",
  "get_entities",
] as const;

export function assertRequiredReadOnlyTools(
  tools: readonly {
    readonly name: string;
    readonly annotations?: { readonly readOnlyHint?: boolean | undefined } | undefined;
  }[],
): void {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const invalid = REQUIRED_DATAHUB_READ_TOOLS.filter(
    (name) => byName.get(name)?.annotations?.readOnlyHint !== true,
  );
  if (invalid.length > 0) {
    throw new AppError("MCP_UNAVAILABLE", "Required read-only DataHub MCP tools are unavailable.");
  }
}

interface ToolListClient {
  listTools(
    params?: { readonly cursor?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    readonly tools: readonly {
      readonly name: string;
      readonly annotations?: { readonly readOnlyHint?: boolean | undefined } | undefined;
    }[];
    readonly nextCursor?: string | undefined;
  }>;
}

export async function listAndAssertRequiredReadOnlyTools(
  client: ToolListClient,
  signal: AbortSignal,
): Promise<void> {
  const byName = new Map<
    string,
    { name: string; annotations?: { readOnlyHint?: boolean | undefined } | undefined }
  >();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    signal.throwIfAborted();
    const result = await client.listTools(cursor === undefined ? undefined : { cursor }, {
      signal,
    });
    signal.throwIfAborted();
    for (const tool of result.tools) byName.set(tool.name, tool);
    if (result.nextCursor === undefined) {
      assertRequiredReadOnlyTools([...byName.values()]);
      return;
    }
    if (seenCursors.has(result.nextCursor)) {
      throw new AppError("MCP_UNAVAILABLE", "DataHub MCP tool discovery did not terminate.");
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new AppError("MCP_UNAVAILABLE", "DataHub MCP tool discovery exceeded its page limit.");
}

export function appendBoundedRedactedStderr(
  collected: string,
  chunk: unknown,
  secrets: readonly string[],
): string {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  return String(redact(`${collected}${text}`, secrets)).slice(-MAX_STDERR_CHARACTERS);
}

function boundedStderrCollector(secrets: readonly string[]): (chunk: unknown) => void {
  let collected = "";

  return (chunk: unknown): void => {
    collected = appendBoundedRedactedStderr(collected, chunk, secrets);
  };
}

function sanitizedIdentity(
  value: string | undefined,
  secrets: readonly string[],
): string | undefined {
  if (value === undefined) return undefined;
  const sanitized = sanitizeBoundaryText(value, secrets, 100).trim();
  if (sanitized.length === 0 || /^(?:\[REDACTED\]\s*)+$/u.test(sanitized)) return undefined;
  return sanitized;
}

export function toDataHubMcpToolClient(
  client: Pick<SdkToolClient, "callTool" | "close" | "getServerVersion">,
  secrets: readonly string[] = [],
): McpToolClient {
  const serverVersion = client.getServerVersion?.();
  const reportedServerName = sanitizedIdentity(serverVersion?.name, secrets);
  const reportedServerVersion = sanitizedIdentity(serverVersion?.version, secrets);
  const serverInfo = Object.freeze({
    ...(reportedServerName === undefined ? {} : { reportedServerName }),
    ...(reportedServerVersion === undefined ? {} : { reportedServerVersion }),
  });
  return {
    async callTool(request, options) {
      const result = await client.callTool(request, CallToolResultSchema, options);
      if ("toolResult" in result) {
        throw new Error("DataHub MCP returned an unsupported task result.");
      }
      const parsed = CallToolResultSchema.safeParse(result);
      if (!parsed.success) {
        throw new Error("DataHub MCP returned an unsupported task result.");
      }
      return parsed.data;
    },
    getServerInfo() {
      return serverInfo;
    },
    async close() {
      await client.close();
    },
  };
}

export async function connectOwnedDataHubMcpClient(
  client: OwnedSdkToolClient,
  transport: Parameters<Client["connect"]>[0],
  secrets: readonly string[],
  scope: ClassifiedAbortScope,
  recordDeadlineEvent: RecordDeadlineEvent,
): Promise<McpToolClient> {
  const closeOwnedClient = createBoundedMcpClose(() => client.close());
  const connectionScope = createDeadline(scope, DEADLINES_MS.mcpConnect, "MCP_CONNECT_TIMEOUT");
  let eventRecorded = false;
  const record = (outcome: "completed" | "expired" | "cancelled"): void => {
    if (eventRecorded) return;
    eventRecorded = true;
    recordDeadlineEvent({
      kind: "MCP_CONNECT_TIMEOUT",
      durationMs: DEADLINES_MS.mcpConnect,
      attempt: 1,
      outcome,
    });
  };

  try {
    connectionScope.signal.throwIfAborted();
    await client.connect(transport, { signal: connectionScope.signal });
    connectionScope.signal.throwIfAborted();
    await listAndAssertRequiredReadOnlyTools(client, connectionScope.signal);
    connectionScope.signal.throwIfAborted();
    record("completed");
    return toDataHubMcpToolClient(client, secrets);
  } catch {
    const primary = connectionScope.signal.aborted
      ? (() => {
          const classification = connectionScope.classifyAbort();
          record(classification.owner === "MCP_CONNECT_TIMEOUT" ? "expired" : "cancelled");
          return classification.error;
        })()
      : (() => {
          record("completed");
          return new AppError(
            "MCP_UNAVAILABLE",
            "The DataHub MCP subprocess could not be started.",
          );
        })();

    try {
      await closeOwnedClient();
    } catch {
      // Startup cleanup is bounded and secondary to the classified startup failure.
    }
    throw primary;
  } finally {
    connectionScope.dispose();
  }
}

export async function connectDataHubMcp(
  config: RuntimeConfig,
  scope: ClassifiedAbortScope,
  recordDeadlineEvent: RecordDeadlineEvent,
): Promise<McpToolClient> {
  if (scope.signal.aborted) throw scope.classifyAbort().error;
  const client = new Client({ name: "lineageguard-ai", version: "0.1.0" });
  const transport = new StdioClientTransport(dataHubMcpServerParameters(config));
  transport.stderr?.on("data", boundedStderrCollector([config.datahubGmsToken]));
  return connectOwnedDataHubMcpClient(
    client,
    transport,
    [config.datahubGmsToken],
    scope,
    recordDeadlineEvent,
  );
}
