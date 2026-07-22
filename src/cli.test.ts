import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { RunImpactAnalysisDependencies } from "./app/run-impact-analysis.js";
import type { RuntimeConfig } from "./config/runtime-config.js";
import type { DataHubCatalog } from "./datahub/catalog.js";
import type { LineageAsset, SchemaField, ToolTraceEntry } from "./domain/evidence.js";
import type { DatasetCandidate } from "./domain/resolve-dataset.js";
import { AppError, type AppErrorCode } from "./errors/app-error.js";
import { createRunId, runCli, type CliDependencies } from "./cli.js";

const REQUEST = "Rename column customer_id to customer_key in dataset snowflake:orders";
const ENVIRONMENT = {
  DATAHUB_GMS_URL: "http://localhost:8080",
  DATAHUB_GMS_TOKEN: "secret-test-token",
};

class TestCatalog implements DataHubCatalog {
  closeCount = 0;

  async searchDatasets(): Promise<readonly DatasetCandidate[]> {
    return [];
  }

  async listSchemaFields(): Promise<readonly SchemaField[]> {
    return [];
  }

  async getDownstreamLineage(): Promise<readonly LineageAsset[]> {
    return [];
  }

  getTrace(): readonly ToolTraceEntry[] {
    return [];
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

interface CliHarness {
  readonly catalog: TestCatalog;
  readonly dependencies: CliDependencies;
  readonly signal: EventEmitter;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly received: {
    config?: RuntimeConfig;
    analysis?: RunImpactAnalysisDependencies;
  };
}

function harness(
  analyze: CliDependencies["runImpactAnalysis"] = async (input) => ({
    status: "COMPLETED",
    runId: input.runId,
    artifactPath: `${input.runsRoot}/${input.runId}/impact-report.md`,
  }),
): CliHarness {
  const catalog = new TestCatalog();
  const signal = new EventEmitter();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const received: CliHarness["received"] = {};

  return {
    catalog,
    signal,
    stdout,
    stderr,
    received,
    dependencies: {
      clock: () => new Date("2026-07-22T12:34:56.789Z"),
      environment: ENVIRONMENT,
      signal,
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
      createCatalog: async (config) => {
        received.config = config;
        return catalog;
      },
      runImpactAnalysis: async (input) => {
        received.analysis = input;
        return analyze(input);
      },
    },
  };
}

describe("runCli", () => {
  it("prints help without loading runtime dependencies", async () => {
    const test = harness();

    const exitCode = await runCli(["--help"], test.dependencies);

    expect(exitCode).toBe(0);
    expect(test.stdout.join("")).toBe(
      [
        "Usage: lineageguard --request <text> [--runs-dir <path>]",
        "",
        "Options:",
        "  -r, --request <text>  Column rename request to analyze.",
        "      --runs-dir <path> Directory beneath which reports are written.",
        "  -h, --help            Show this help.",
        "",
      ].join("\n"),
    );
    expect(test.stderr).toEqual([]);
    expect(test.received.config).toBeUndefined();
  });

  it("rejects a missing request before connecting to MCP", async () => {
    const test = harness();

    const exitCode = await runCli([], test.dependencies);

    expect(exitCode).toBe(2);
    expect(test.stdout).toEqual([]);
    expect(test.stderr.join("")).toBe(
      "Status: INVALID_REQUEST\nA --request value is required. Run with --help for usage.\n",
    );
    expect(test.received.config).toBeUndefined();
  });

  it("rejects unsupported command-line options without exposing parser errors", async () => {
    const test = harness();

    const exitCode = await runCli(["--run-id", "unsafe"], test.dependencies);

    expect(exitCode).toBe(2);
    expect(test.stderr.join("")).toBe(
      "Status: INVALID_REQUEST\nInvalid command-line arguments. Run with --help for usage.\n",
    );
    expect(test.stderr.join("")).not.toContain("ERR_PARSE_ARGS");
  });

  it.each(["COMPLETED", "COMPLETED_WITH_LIMITATIONS", "INSUFFICIENT_METADATA"] as const)(
    "prints the report and exits zero for %s",
    async (status) => {
      const test = harness(async (input) => ({
        status,
        runId: input.runId,
        artifactPath: `reports/${input.runId}/impact-report.md`,
      }));

      const exitCode = await runCli(
        ["--request", REQUEST, "--runs-dir", "reports"],
        test.dependencies,
      );

      expect(exitCode).toBe(0);
      expect(test.stdout.join("")).toMatch(
        new RegExp(
          `^Status: ${status}\\nRun ID: 20260722T123456Z-[0-9a-f]{8}\\nReport: reports/20260722T123456Z-[0-9a-f]{8}/impact-report\\.md\\n$`,
        ),
      );
      expect(test.stderr).toEqual([]);
      expect(test.received.analysis).toMatchObject({ request: REQUEST, runsRoot: "reports" });
      expect(test.received.config).toMatchObject({ runsRoot: "runs" });
    },
  );

  it("uses the validated runs-directory default when no override is supplied", async () => {
    const test = harness();

    await runCli(["--request", REQUEST], test.dependencies);

    expect(test.received.analysis?.runsRoot).toBe("runs");
  });

  const failureCases: readonly {
    code: AppErrorCode;
    details?: Readonly<Record<string, unknown>>;
    exitCode: number;
    diagnostic?: string;
    recovery?: string;
  }[] = [
    { code: "INVALID_REQUEST", exitCode: 2 },
    {
      code: "TARGET_NOT_FOUND",
      details: { searchHint: "snowflake:orders" },
      exitCode: 2,
      diagnostic: "Search hint: snowflake:orders\n",
      recovery: "Use a more specific platform-qualified dataset identifier.",
    },
    {
      code: "NEEDS_USER_CLARIFICATION",
      details: { candidates: ["urn:li:dataset:b", "urn:li:dataset:a"] },
      exitCode: 2,
      diagnostic: "Dataset candidates:\n- urn:li:dataset:b\n- urn:li:dataset:a\n",
      recovery: "Choose one of the listed dataset URNs and retry with that exact URN.",
    },
    {
      code: "COLUMN_NOT_FOUND",
      details: { knownFields: ["customer_key", "order_id"] },
      exitCode: 2,
      diagnostic: "Known schema fields:\n- customer_key\n- order_id\n",
      recovery: "Choose one of the actual schema fields listed above.",
    },
    {
      code: "DATAHUB_UNAVAILABLE",
      exitCode: 3,
      recovery:
        "Verify Docker containers with `docker ps` and confirm http://localhost:8080/health responds.",
    },
    {
      code: "MCP_UNAVAILABLE",
      exitCode: 3,
      recovery:
        "Verify `uvx mcp-server-datahub@0.6.0 --version` and the DATAHUB_GMS_URL configuration.",
    },
    {
      code: "ARTIFACT_WRITE_FAILED",
      exitCode: 4,
      recovery:
        "Verify that the configured runs directory is writable and remains inside the project workspace.",
    },
  ];

  it.each(failureCases)(
    "maps $code to exit code $exitCode with safe diagnostics",
    async ({ code, details = {}, exitCode, diagnostic = "", recovery }) => {
      const rawSecret = ENVIRONMENT.DATAHUB_GMS_TOKEN;
      const test = harness(async () => {
        throw new AppError(code, `Safe ${code} message.`, {
          ...details,
          cause: `raw dependency stderr containing ${rawSecret}`,
        });
      });

      const actualExitCode = await runCli(["--request", REQUEST], test.dependencies);

      const expectedRecovery = recovery === undefined ? "" : `Recovery: ${recovery}\n`;
      expect(actualExitCode).toBe(exitCode);
      expect(test.stdout).toEqual([]);
      expect(test.stderr.join("")).toBe(
        `Status: ${code}\nSafe ${code} message.\n${diagnostic}${expectedRecovery}`,
      );
      expect(test.stderr.join("")).not.toContain(rawSecret);
      expect(test.stderr.join("")).not.toContain("raw dependency stderr");
    },
  );

  it("returns stable configuration guidance without exposing validation details", async () => {
    const test = harness();
    const dependencies = { ...test.dependencies, environment: { DATAHUB_GMS_TOKEN: "secret" } };

    const exitCode = await runCli(["--request", REQUEST], dependencies);

    expect(exitCode).toBe(3);
    expect(test.stderr.join("")).toBe(
      "Status: MCP_UNAVAILABLE\nConfiguration is invalid. Verify DATAHUB_GMS_URL and DATAHUB_GMS_TOKEN.\n",
    );
    expect(test.received.config).toBeUndefined();
  });

  it("closes the active catalog and exits 130 after SIGINT", async () => {
    let analysisStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      analysisStarted = resolve;
    });
    const test = harness(
      () =>
        new Promise(() => {
          analysisStarted();
        }),
    );

    const exitCodePromise = runCli(["--request", REQUEST], test.dependencies);
    await started;
    test.signal.emit("SIGINT");

    await expect(exitCodePromise).resolves.toBe(130);
    expect(test.catalog.closeCount).toBe(1);
    expect(test.stderr.join("")).toBe("Interrupted by the user.\n");
    expect(test.signal.listenerCount("SIGINT")).toBe(0);
  });
});

describe("createRunId", () => {
  it("uses compact UTC time and exactly four cryptographic random bytes", () => {
    expect(createRunId(new Date("2026-07-22T12:34:56.789Z"))).toMatch(
      /^20260722T123456Z-[0-9a-f]{8}$/,
    );
  });
});
