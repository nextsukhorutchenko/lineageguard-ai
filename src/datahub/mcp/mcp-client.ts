import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { AppError } from "../../errors/app-error.js";
import { redact } from "../../security/redact.js";

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

function boundedStderrCollector(secrets: readonly string[]): (chunk: unknown) => void {
  let collected = "";

  return (chunk: unknown): void => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const safeText = String(redact(text, secrets));
    collected = `${collected}${safeText}`.slice(-MAX_STDERR_CHARACTERS);
  };
}

export async function connectDataHubMcp(config: RuntimeConfig): Promise<Client> {
  const client = new Client({ name: "lineageguard-ai", version: "0.1.0" });
  const transport = new StdioClientTransport(dataHubMcpServerParameters(config));
  transport.stderr?.on("data", boundedStderrCollector([config.datahubGmsToken]));

  try {
    await client.connect(transport);
    return client;
  } catch {
    try {
      await client.close();
    } catch {
      // Startup diagnostics remain bounded and private even when cleanup also fails.
    }
    throw new AppError("MCP_UNAVAILABLE", "The DataHub MCP subprocess could not be started.");
  }
}
