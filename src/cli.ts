import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  runImpactAnalysis,
  type RunImpactAnalysisDependencies,
} from "./app/run-impact-analysis.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./config/runtime-config.js";
import type { DataHubCatalog } from "./datahub/catalog.js";
import { DataHubMcpCatalog } from "./datahub/mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "./datahub/mcp/mcp-client.js";
import type { RunStatus } from "./domain/run-result.js";
import { AppError, type AppErrorCode } from "./errors/app-error.js";

const help = [
  "Usage: lineageguard --request <text> [--runs-dir <path>]",
  "",
  "Options:",
  "  -r, --request <text>  Column rename request to analyze.",
  "      --runs-dir <path> Directory beneath which reports are written.",
  "  -h, --help            Show this help.",
  "",
].join("\n");

const guidance = {
  DATAHUB_UNAVAILABLE:
    "Verify Docker containers with `docker ps` and confirm http://localhost:8080/health responds.",
  MCP_UNAVAILABLE:
    "Verify `uvx mcp-server-datahub@0.6.0 --version` and the DATAHUB_GMS_URL configuration.",
  TARGET_NOT_FOUND: "Use a more specific platform-qualified dataset identifier.",
  NEEDS_USER_CLARIFICATION: "Choose one of the listed dataset URNs and retry with that exact URN.",
  COLUMN_NOT_FOUND: "Choose one of the actual schema fields listed above.",
  ARTIFACT_WRITE_FAILED:
    "Verify that the configured runs directory is writable and remains inside the project workspace.",
} as const;

const exitCodes = {
  INVALID_REQUEST: 2,
  TARGET_NOT_FOUND: 2,
  NEEDS_USER_CLARIFICATION: 2,
  COLUMN_NOT_FOUND: 2,
  DATAHUB_UNAVAILABLE: 3,
  MCP_UNAVAILABLE: 3,
  ARTIFACT_WRITE_FAILED: 4,
} as const satisfies Readonly<Record<AppErrorCode, number>>;

type SuccessfulStatus = Extract<
  RunStatus,
  "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "INSUFFICIENT_METADATA"
>;

interface CliAnalysisResult {
  readonly status: SuccessfulStatus;
  readonly runId: string;
  readonly artifactPath: string;
}

interface TextWriter {
  write(text: string): unknown;
}

interface InterruptSignal {
  once(event: "SIGINT", listener: () => void): unknown;
  off(event: "SIGINT", listener: () => void): unknown;
}

export interface CliDependencies {
  readonly clock: () => Date;
  readonly environment: NodeJS.ProcessEnv;
  readonly stdout: TextWriter;
  readonly stderr: TextWriter;
  readonly signal: InterruptSignal;
  readonly createCatalog: (config: RuntimeConfig) => Promise<DataHubCatalog>;
  readonly runImpactAnalysis: (input: RunImpactAnalysisDependencies) => Promise<CliAnalysisResult>;
}

export const createRunId = (now: Date): string =>
  `${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}-${randomBytes(4).toString("hex")}`;

function parseCliArguments(argv: readonly string[]): {
  readonly help: boolean;
  readonly request?: string;
  readonly runsRoot?: string;
} {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      request: { type: "string", short: "r" },
      "runs-dir": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  return {
    help: values.help,
    ...(values.request === undefined ? {} : { request: values.request }),
    ...(values["runs-dir"] === undefined ? {} : { runsRoot: values["runs-dir"] }),
  };
}

function closeOnce(catalog: DataHubCatalog): DataHubCatalog {
  let closing: Promise<void> | undefined;

  return {
    searchDatasets: (hint) => catalog.searchDatasets(hint),
    listSchemaFields: (datasetUrn) => catalog.listSchemaFields(datasetUrn),
    getDownstreamLineage: (datasetUrn, options) =>
      catalog.getDownstreamLineage(datasetUrn, options),
    getTrace: () => catalog.getTrace(),
    close: () => (closing ??= catalog.close()),
  };
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function diagnosticDetails(error: AppError): string {
  if (error.code === "TARGET_NOT_FOUND" && typeof error.details.searchHint === "string") {
    return `Search hint: ${error.details.searchHint}\n`;
  }

  const candidates = stringList(error.details.candidates);
  if (error.code === "NEEDS_USER_CLARIFICATION" && candidates !== undefined) {
    return `Dataset candidates:\n${candidates.map((candidate) => `- ${candidate}\n`).join("")}`;
  }

  const knownFields = stringList(error.details.knownFields);
  if (error.code === "COLUMN_NOT_FOUND" && knownFields !== undefined) {
    return `Known schema fields:\n${knownFields.map((field) => `- ${field}\n`).join("")}`;
  }

  return "";
}

function writeAppError(error: AppError, stderr: TextWriter): number {
  const recovery = error.code === "INVALID_REQUEST" ? undefined : guidance[error.code];
  stderr.write(
    `Status: ${error.code}\n${error.message}\n${diagnosticDetails(error)}${
      recovery === undefined ? "" : `Recovery: ${recovery}\n`
    }`,
  );
  return exitCodes[error.code];
}

async function defaultCreateCatalog(config: RuntimeConfig): Promise<DataHubCatalog> {
  const client = await connectDataHubMcp(config);
  return new DataHubMcpCatalog(client, [config.datahubGmsToken]);
}

const defaultDependencies: CliDependencies = {
  clock: () => new Date(),
  environment: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  signal: process,
  createCatalog: defaultCreateCatalog,
  runImpactAnalysis,
};

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  let arguments_: ReturnType<typeof parseCliArguments>;
  try {
    arguments_ = parseCliArguments(argv);
  } catch {
    dependencies.stderr.write(
      "Status: INVALID_REQUEST\nInvalid command-line arguments. Run with --help for usage.\n",
    );
    return 2;
  }

  if (arguments_.help) {
    dependencies.stdout.write(help);
    return 0;
  }
  if (arguments_.request === undefined) {
    dependencies.stderr.write(
      "Status: INVALID_REQUEST\nA --request value is required. Run with --help for usage.\n",
    );
    return 2;
  }

  let config: RuntimeConfig;
  try {
    config = loadRuntimeConfig(dependencies.environment);
  } catch {
    dependencies.stderr.write(
      "Status: MCP_UNAVAILABLE\nConfiguration is invalid. Verify DATAHUB_GMS_URL and DATAHUB_GMS_TOKEN.\n",
    );
    return 3;
  }

  try {
    const catalog = closeOnce(await dependencies.createCatalog(config));
    try {
      let interruptedByUser = false;
      let resolveInterrupted!: (outcome: { readonly kind: "interrupted" }) => void;
      const interrupted = new Promise<{ readonly kind: "interrupted" }>((resolve) => {
        resolveInterrupted = resolve;
      });
      const onInterrupt = (): void => {
        interruptedByUser = true;
        resolveInterrupted({ kind: "interrupted" });
        void catalog.close().catch(() => undefined);
      };
      dependencies.signal.once("SIGINT", onInterrupt);

      try {
        const analysis = dependencies
          .runImpactAnalysis({
            request: arguments_.request,
            catalog,
            clock: dependencies.clock,
            runId: createRunId(dependencies.clock()),
            runsRoot: arguments_.runsRoot ?? config.runsRoot,
          })
          .then(
            (run) => ({ kind: "completed" as const, run }),
            (error: unknown) => ({ kind: "failed" as const, error }),
          );
        const outcome = await Promise.race([analysis, interrupted]);

        if (interruptedByUser || outcome.kind === "interrupted") {
          dependencies.stderr.write("Interrupted by the user.\n");
          return 130;
        }
        if (outcome.kind === "failed") {
          if (outcome.error instanceof AppError) {
            return writeAppError(outcome.error, dependencies.stderr);
          }
          dependencies.stderr.write(
            "Status: MCP_UNAVAILABLE\nThe analysis failed at an external integration boundary.\n",
          );
          return 3;
        }

        dependencies.stdout.write(
          `Status: ${outcome.run.status}\nRun ID: ${outcome.run.runId}\nReport: ${outcome.run.artifactPath}\n`,
        );
        return 0;
      } finally {
        dependencies.signal.off("SIGINT", onInterrupt);
      }
    } finally {
      await catalog.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof AppError) {
      return writeAppError(error, dependencies.stderr);
    }
    dependencies.stderr.write(
      "Status: MCP_UNAVAILABLE\nThe MCP integration could not be initialized.\n",
    );
    return 3;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2));
}
