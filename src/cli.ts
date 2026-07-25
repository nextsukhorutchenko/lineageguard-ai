import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  runImpactAnalysis,
  type RunImpactAnalysisDependencies,
} from "./app/run-impact-analysis.js";
import { assertTrustedRunsRoot } from "./artifacts/run-envelope-files.js";
import {
  loadRuntimeConfig,
  type EnvironmentMap,
  type RuntimeConfig,
} from "./config/runtime-config.js";
import type { DataHubCatalog } from "./datahub/catalog.js";
import { createDataHubCatalog } from "./datahub/create-catalog.js";
import { parseChangeIntent } from "./domain/change-intent.js";
import type { RunStatus } from "./domain/run-result.js";
import { AppError, type AppErrorCode } from "./errors/app-error.js";
import type { RecordDeadlineEvent } from "./runtime/deadline-events.js";
import { createRequestAbortScope, type ClassifiedAbortScope } from "./runtime/deadlines.js";
import { sanitizeTerminalText } from "./security/sanitize-output.js";

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
    "Verify that the configured runs root is a pre-created writable real directory with no symbolic-link or junction path components.",
  GENERATION_FAILED: "Retry migration generation without changing the validated DataHub context.",
  CANCELLED: "The operation was cancelled. Retry when ready.",
} as const satisfies Readonly<Record<Exclude<AppErrorCode, "INVALID_REQUEST">, string>>;

const exitCodes = {
  INVALID_REQUEST: 2,
  TARGET_NOT_FOUND: 2,
  NEEDS_USER_CLARIFICATION: 2,
  COLUMN_NOT_FOUND: 2,
  DATAHUB_UNAVAILABLE: 3,
  MCP_UNAVAILABLE: 3,
  ARTIFACT_WRITE_FAILED: 4,
  GENERATION_FAILED: 5,
  CANCELLED: 130,
} as const satisfies Readonly<Record<AppErrorCode, number>>;

type SuccessfulStatus = Extract<
  RunStatus,
  "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "INSUFFICIENT_METADATA" | "INCOMPLETE_EVIDENCE"
>;

interface CliAnalysisResult {
  readonly status: SuccessfulStatus;
  readonly runId: string;
  readonly artifactFilename: "impact-report.md";
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
  readonly environment: EnvironmentMap;
  readonly stdout: TextWriter;
  readonly stderr: TextWriter;
  readonly signal: InterruptSignal;
  readonly shutdownTimeoutMs: number;
  readonly createCatalog: (
    config: RuntimeConfig,
    scope: ClassifiedAbortScope,
    recordDeadlineEvent: RecordDeadlineEvent,
  ) => Promise<DataHubCatalog>;
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
    searchDatasets: (hint, options) => catalog.searchDatasets(hint, options),
    listSchemaFields: (datasetUrn, options) => catalog.listSchemaFields(datasetUrn, options),
    getDownstreamLineage: (datasetUrn, options) =>
      catalog.getDownstreamLineage(datasetUrn, options),
    getEntityContext: (urns, options) => catalog.getEntityContext(urns, options),
    getServerInfo: () => catalog.getServerInfo(),
    getTrace: () => catalog.getTrace(),
    close: () => (closing ??= catalog.close()),
  };
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function diagnosticDetails(error: AppError, secrets: readonly string[]): string {
  if (error.code === "TARGET_NOT_FOUND" && typeof error.details.searchHint === "string") {
    return `Search hint: ${sanitizeTerminalText(error.details.searchHint, secrets)}\n`;
  }

  const candidates = stringList(error.details.candidates);
  if (error.code === "NEEDS_USER_CLARIFICATION" && candidates !== undefined) {
    return `Dataset candidates:\n${candidates
      .map((candidate) => `- ${sanitizeTerminalText(candidate, secrets)}\n`)
      .join("")}`;
  }

  const knownFields = stringList(error.details.knownFields);
  if (error.code === "COLUMN_NOT_FOUND" && knownFields !== undefined) {
    return `Known schema fields:\n${knownFields
      .map((field) => `- ${sanitizeTerminalText(field, secrets)}\n`)
      .join("")}`;
  }

  return "";
}

function writeAppError(
  error: AppError,
  stderr: TextWriter,
  secrets: readonly string[] = [],
): number {
  const recovery = error.code === "INVALID_REQUEST" ? undefined : guidance[error.code];
  const message =
    error.code === "ARTIFACT_WRITE_FAILED" ? "The artifact operation failed." : error.message;
  stderr.write(
    `Status: ${error.code}\n${sanitizeTerminalText(message, secrets)}\n${diagnosticDetails(error, secrets)}${
      recovery === undefined ? "" : `Recovery: ${recovery}\n`
    }`,
  );
  return exitCodes[error.code];
}

async function waitForSettlementWithin(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const bounded = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    bounded,
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
}

const defaultDependencies: CliDependencies = {
  clock: () => new Date(),
  environment: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  signal: process,
  shutdownTimeoutMs: 5_000,
  createCatalog: createDataHubCatalog,
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

  try {
    parseChangeIntent(arguments_.request);
  } catch (error) {
    if (error instanceof AppError) return writeAppError(error, dependencies.stderr);
    dependencies.stderr.write(
      "Status: INVALID_REQUEST\nThe request does not match the supported rename format.\n",
    );
    return 2;
  }

  let config: RuntimeConfig;
  try {
    config = loadRuntimeConfig(dependencies.environment, arguments_.runsRoot);
  } catch (error) {
    if (error instanceof AppError) return writeAppError(error, dependencies.stderr);
    dependencies.stderr.write(
      "Status: MCP_UNAVAILABLE\nConfiguration is invalid. Verify DATAHUB_GMS_URL and DATAHUB_GMS_TOKEN.\n",
    );
    return 3;
  }
  const outputSecrets = [config.datahubGmsToken];
  let trustedRunsRoot: string;
  try {
    trustedRunsRoot = await assertTrustedRunsRoot(config.runsRoot);
  } catch (error) {
    const storageError =
      error instanceof AppError
        ? error
        : new AppError("ARTIFACT_WRITE_FAILED", "Unable to persist the run.");
    return writeAppError(storageError, dependencies.stderr, outputSecrets);
  }

  try {
    const abortController = new AbortController();
    const requestScope = createRequestAbortScope(abortController.signal);
    const ignoreDeadlineEvent: RecordDeadlineEvent = () => undefined;
    let catalog: DataHubCatalog | undefined;
    let interruptedByUser = false;
    let resolveInterrupted!: (outcome: { readonly kind: "interrupted" }) => void;
    const interrupted = new Promise<{ readonly kind: "interrupted" }>((resolve) => {
      resolveInterrupted = resolve;
    });
    const onInterrupt = (): void => {
      if (interruptedByUser) return;
      interruptedByUser = true;
      abortController.abort();
      resolveInterrupted({ kind: "interrupted" });
      void catalog?.close().catch(() => undefined);
    };
    dependencies.signal.once("SIGINT", onInterrupt);

    try {
      const catalogCreation = dependencies
        .createCatalog(config, requestScope, ignoreDeadlineEvent)
        .then(
          async (created) => {
            const ownedCatalog = closeOnce(created);
            if (abortController.signal.aborted) {
              await ownedCatalog.close().catch(() => undefined);
            }
            return { kind: "created" as const, catalog: ownedCatalog };
          },
          (error: unknown) => ({ kind: "failed" as const, error }),
        );
      const creationOutcome = await Promise.race([catalogCreation, interrupted]);

      if (interruptedByUser || creationOutcome.kind === "interrupted") {
        await waitForSettlementWithin(
          catalogCreation.then(async (outcome) => {
            if (outcome.kind === "created") await outcome.catalog.close().catch(() => undefined);
          }),
          dependencies.shutdownTimeoutMs,
        );
        dependencies.stderr.write("Interrupted by the user.\n");
        return 130;
      }
      if (creationOutcome.kind === "failed") throw creationOutcome.error;
      catalog = creationOutcome.catalog;

      const analysis = dependencies
        .runImpactAnalysis({
          request: arguments_.request,
          catalog,
          clock: dependencies.clock,
          runId: createRunId(dependencies.clock()),
          runsRoot: trustedRunsRoot,
          signal: abortController.signal,
          secrets: outputSecrets,
        })
        .then(
          (run) => ({ kind: "completed" as const, run }),
          (error: unknown) => ({ kind: "failed" as const, error }),
        );
      const outcome = await Promise.race([analysis, interrupted]);

      if (interruptedByUser || outcome.kind === "interrupted") {
        await waitForSettlementWithin(
          Promise.allSettled([analysis, catalog.close()]),
          dependencies.shutdownTimeoutMs,
        );
        dependencies.stderr.write("Interrupted by the user.\n");
        return 130;
      }
      if (outcome.kind === "failed") {
        if (outcome.error instanceof AppError) {
          return writeAppError(outcome.error, dependencies.stderr, outputSecrets);
        }
        dependencies.stderr.write(
          "Status: MCP_UNAVAILABLE\nThe analysis failed at an external integration boundary.\n",
        );
        return 3;
      }

      dependencies.stdout.write(
        `Status: ${outcome.run.status}\nRun ID: ${sanitizeTerminalText(outcome.run.runId, outputSecrets)}\nReport: ${outcome.run.artifactFilename}\n`,
      );
      return 0;
    } finally {
      requestScope.dispose();
      dependencies.signal.off("SIGINT", onInterrupt);
      if (catalog !== undefined && !interruptedByUser) {
        await catalog.close().catch(() => undefined);
      }
    }
  } catch (error) {
    if (error instanceof AppError) {
      return writeAppError(error, dependencies.stderr, outputSecrets);
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
