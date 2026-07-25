import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "prettier";
import { describe, expect, test } from "vitest";
import {
  captureDataHubFixtures,
  fixtureFileNames,
} from "../../scripts/capture-datahub-fixtures.js";
import { loadRuntimeConfig } from "../../src/config/runtime-config.js";
import { DataHubMcpCatalog } from "../../src/datahub/mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "../../src/datahub/mcp/mcp-client.js";
import type { RecordDeadlineEvent } from "../../src/runtime/deadline-events.js";
import {
  createDeadline,
  createRequestAbortScope,
  type ClassifiedAbortScope,
} from "../../src/runtime/deadlines.js";

const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";
const DATASET_HINT = "order+details";

const integrationTest = test.runIf(Boolean(process.env.DATAHUB_GMS_TOKEN));
const ignoreDeadlineEvent: RecordDeadlineEvent = () => undefined;

async function withConnectionScope<T>(
  run: (scope: ClassifiedAbortScope) => Promise<T>,
  signal: AbortSignal = new AbortController().signal,
): Promise<T> {
  const request = createRequestAbortScope(signal);
  try {
    return await run(request);
  } finally {
    request.dispose();
  }
}

describe("DataHub MCP live integration", () => {
  integrationTest(
    "reads the official showcase-ecommerce target through the read-only MCP tools",
    async () => {
      const config = loadRuntimeConfig({
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? "http://localhost:8080",
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN,
        DATAHUB_MCP_UVX_PATH: process.env.DATAHUB_MCP_UVX_PATH,
        LINEAGEGUARD_RUNS_DIR: process.env.LINEAGEGUARD_RUNS_DIR ?? tmpdir(),
      });
      const catalog = new DataHubMcpCatalog(
        await withConnectionScope((scope) => connectDataHubMcp(config, scope, ignoreDeadlineEvent)),
        [config.datahubGmsToken],
      );

      try {
        const candidates = await catalog.searchDatasets(DATASET_HINT);
        const fields = await catalog.listSchemaFields(DATASET_URN);
        const tableLineage = await catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 });
        const columnLineage = await catalog.getDownstreamLineage(DATASET_URN, {
          column: "customer_id",
          maxHops: 2,
        });
        const entityContext = await catalog.getEntityContext([
          DATASET_URN,
          ...tableLineage.items.map(({ urn }) => urn),
        ]);

        expect(candidates.completeness.complete).toBe(true);
        expect(fields.completeness.complete).toBe(true);
        expect(tableLineage.completeness.complete).toBe(true);
        expect(columnLineage.completeness.complete).toBe(true);
        expect(candidates.items).toContainEqual(expect.objectContaining({ urn: DATASET_URN }));
        expect(fields.items).toContainEqual(
          expect.objectContaining({
            fieldPath: "customer_id",
            nativeDataType: "NUMBER(38,0)",
          }),
        );
        expect(tableLineage.items).toHaveLength(24);
        expect(columnLineage.items).toContainEqual(
          expect.objectContaining({
            lineageColumns: expect.arrayContaining(["customer_id"]),
          }),
        );
        expect(entityContext.items.length).toBeGreaterThan(0);
        const serverInfo = catalog.getServerInfo();
        if (serverInfo.reportedServerName !== undefined) {
          expect(serverInfo.reportedServerName.length).toBeLessThanOrEqual(100);
          expect(serverInfo.reportedServerName).not.toContain(config.datahubGmsToken);
        }
        if (serverInfo.reportedServerVersion !== undefined) {
          expect(serverInfo.reportedServerVersion.length).toBeLessThanOrEqual(100);
          expect(serverInfo.reportedServerVersion).not.toContain(config.datahubGmsToken);
        }
        expect(catalog.getTrace().map(({ tool }) => tool)).toEqual([
          "search",
          "list_schema_fields",
          "get_lineage",
          "get_lineage",
          "get_entities",
          "get_entities",
          "get_entities",
        ]);
      } finally {
        await catalog.close();
      }
    },
    120_000,
  );

  integrationTest(
    "captures only the five sanitized normalized fixture payloads",
    async () => {
      const config = loadRuntimeConfig({
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? "http://localhost:8080",
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN,
        DATAHUB_MCP_UVX_PATH: process.env.DATAHUB_MCP_UVX_PATH,
        LINEAGEGUARD_RUNS_DIR: process.env.LINEAGEGUARD_RUNS_DIR ?? tmpdir(),
      });
      const destination = await mkdtemp(join(tmpdir(), "lineageguard-datahub-fixtures-"));

      try {
        const written = await captureDataHubFixtures(config, destination);

        expect(written.map(({ basename }) => basename)).toEqual(fixtureFileNames);
        expect((await readdir(destination)).sort()).toEqual([...fixtureFileNames].sort());
        for (const filename of fixtureFileNames) {
          const content = await readFile(join(destination, filename), "utf8");
          expect(content).not.toContain(config.datahubGmsToken);
          expect(await check(content, { parser: "json", printWidth: 100 })).toBe(true);
        }
      } finally {
        await rm(destination, { recursive: true, force: true });
      }
    },
    120_000,
  );

  integrationTest(
    "honors a real one-millisecond cancellation deadline on a fresh connection",
    async () => {
      const config = loadRuntimeConfig({
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? "http://localhost:8080",
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN,
        DATAHUB_MCP_UVX_PATH: process.env.DATAHUB_MCP_UVX_PATH,
        LINEAGEGUARD_RUNS_DIR: process.env.LINEAGEGUARD_RUNS_DIR ?? tmpdir(),
      });
      const request = createRequestAbortScope(AbortSignal.timeout(1));
      const deadline = createDeadline(request, 1, "MCP_CONNECT_TIMEOUT");
      try {
        await expect(
          connectDataHubMcp(config, deadline, ignoreDeadlineEvent),
        ).rejects.toMatchObject({
          code: "MCP_UNAVAILABLE",
        });
      } finally {
        deadline.dispose();
        request.dispose();
      }
    },
    120_000,
  );

  test.runIf(
    Boolean(
      process.env.DATAHUB_GMS_TOKEN &&
      process.env.RUN_LARGE_LINEAGE_CONTRACT === "1" &&
      process.env.DATAHUB_LARGE_LINEAGE_URN,
    ),
  )(
    "marks the optional large-lineage probe incomplete at the pinned ceiling",
    async () => {
      const config = loadRuntimeConfig({
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? "http://localhost:8080",
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN,
        DATAHUB_MCP_UVX_PATH: process.env.DATAHUB_MCP_UVX_PATH,
        LINEAGEGUARD_RUNS_DIR: process.env.LINEAGEGUARD_RUNS_DIR ?? tmpdir(),
      });
      const catalog = new DataHubMcpCatalog(
        await withConnectionScope((scope) => connectDataHubMcp(config, scope, ignoreDeadlineEvent)),
      );
      try {
        const result = await catalog.getDownstreamLineage(process.env.DATAHUB_LARGE_LINEAGE_URN!, {
          maxHops: 2,
        });
        expect(result.items).toHaveLength(100);
        expect(result.completeness).toMatchObject({
          complete: false,
          reasonCodes: expect.arrayContaining(["ITEM_LIMIT_REACHED"]),
        });
      } finally {
        await catalog.close();
      }
    },
    120_000,
  );
});
