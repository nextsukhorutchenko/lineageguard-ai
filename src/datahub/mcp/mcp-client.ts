import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { AppError } from "../../errors/app-error.js";
import { redact } from "../../security/redact.js";
import type { McpToolClient, ToolCallRequest } from "./datahub-mcp-catalog.js";

const MAX_STDERR_CHARACTERS = 4_096;

export function dataHubMcpServerParameters(config: RuntimeConfig): StdioServerParameters {
  return {
    command: config.uvxPath,
    args: ["mcp-server-datahub@0.6.0", "--transport", "stdio"],
    env: {
      DATAHUB_GMS_URL: config.datahubGmsUrl,
      DATAHUB_GMS_TOKEN: config.datahubGmsToken,
      TOOLS_IS_MUTATION_ENABLED: "false",
      DATAHUB_MCP_DOCUMENT_TOOLS_DISABLED: "true",
      SAVE_DOCUMENT_TOOL_ENABLED: "false",
    },
    stderr: "pipe",
  };
}

interface SdkToolClient {
  callTool(
    request: ToolCallRequest,
    resultSchema?: typeof CallToolResultSchema,
    options?: { readonly signal?: AbortSignal },
  ): ReturnType<Client["callTool"]>;
  close(): Promise<void>;
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

export function toDataHubMcpToolClient(client: SdkToolClient): McpToolClient {
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
    async close() {
      await client.close();
    },
  };
}

export async function connectDataHubMcp(
  config: RuntimeConfig,
  signal?: AbortSignal,
): Promise<McpToolClient> {
  signal?.throwIfAborted();
  const client = new Client({ name: "lineageguard-ai", version: "0.1.0" });
  const transport = new StdioClientTransport(dataHubMcpServerParameters(config));
  transport.stderr?.on("data", boundedStderrCollector([config.datahubGmsToken]));

  try {
    await client.connect(transport, signal === undefined ? undefined : { signal });
    return toDataHubMcpToolClient(client);
  } catch {
    try {
      await client.close();
    } catch {
      // Startup diagnostics remain bounded and private even when cleanup also fails.
    }
    if (signal?.aborted) signal.throwIfAborted();
    throw new AppError("MCP_UNAVAILABLE", "The DataHub MCP subprocess could not be started.");
  }
}
